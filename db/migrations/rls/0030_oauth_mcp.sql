-- Fase 3 — OAuth 2.1 para o servidor MCP remoto.
--
-- Conferido contra o spec de autorização do MCP (revisão 2025-06-18), que
-- exige: OAuth 2.1, PKCE, metadata de recurso protegido (RFC 9728), metadata do
-- authorization server (RFC 8414), validação de AUDIÊNCIA do token (RFC 8707) e
-- rotação de refresh token para cliente público. Registro dinâmico (RFC 7591) é
-- SHOULD, mas sem ele o claude.ai precisaria de client id fixo — então entra.
--
-- HASH, NÃO CIFRA. Ao contrário da chave de IA da Fase 2, aqui nada precisa
-- voltar ao texto claro: o servidor recebe o token e compara o hash. Guardar
-- cifrado seria dar a si mesmo um poder que não é necessário.
--
-- E nada de `Buffer.toString('base64')`, como em `sefaz.ts` — aquilo é
-- codificação com nome de criptografia, e replicá-lo aqui seria o pior lugar
-- possível.
--
-- PREFIXO `mcp_`: o Supabase ja tem `auth.oauth_clients`, `auth.oauth_consents`
-- e companhia -- ele tem servidor OAuth proprio. As nossas coexistiriam noutro
-- schema, mas nome igual e convite a confusao e a um `search_path` pegar a
-- tabela errada.
--
-- Rodar no Supabase Studio > SQL Editor.

-- ─────────────────────────────────────────
-- 1. CLIENTES (registro dinâmico)
-- ─────────────────────────────────────────
-- Global, sem organização: o claude.ai é um cliente OAuth, não pertence a
-- ninguém. Quem pertence a alguém é o GRANT, mais abaixo.
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id         text        PRIMARY KEY,
  -- Nulo para cliente público (o caso do claude.ai, que usa PKCE em vez de
  -- segredo). Quando existe, é hash, nunca o segredo.
  client_secret_hash text,
  client_name       text        NOT NULL,
  redirect_uris     text[]      NOT NULL,
  grant_types       text[]      NOT NULL DEFAULT ARRAY['authorization_code','refresh_token'],
  token_endpoint_auth_method text NOT NULL DEFAULT 'none',
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz,

  -- `cardinality` e NAO `array_length`: para array vazio o segundo devolve
  -- NULL, e um CHECK que avalia para NULL PASSA. O guarda nao guardava nada --
  -- descoberto pelo teste, que inseriu ARRAY[]::text[] e foi aceito.
  CONSTRAINT mcp_oauth_clients_redirects_chk CHECK (cardinality(redirect_uris) >= 1),
  CONSTRAINT mcp_oauth_clients_auth_method_chk
    CHECK (token_endpoint_auth_method IN ('none', 'client_secret_post', 'client_secret_basic'))
);

-- ─────────────────────────────────────────
-- 2. CONSENTIMENTO DURÁVEL
-- ─────────────────────────────────────────
-- O que o humano autorizou na tela: quais organizações e com que escopo.
--
-- `organization_ids` é o coração do desenho multi-organização. A ferramenta MCP
-- recebe `organizationId` no corpo da chamada, mas o corpo só PROPÕE — quem
-- DISPÕE é este array mais a membership viva. É a inversão do anti-padrão do
-- webhook SEFAZ, que resolve a organização pelo CNPJ que vem na requisição.
CREATE TABLE IF NOT EXISTS mcp_oauth_access_grants (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL,
  client_id         text        NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  organization_ids  uuid[]      NOT NULL,
  scopes            text[]      NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz,
  revoked_at        timestamptz,

  CONSTRAINT mcp_oauth_grants_orgs_chk   CHECK (cardinality(organization_ids) >= 1),
  CONSTRAINT mcp_oauth_grants_scopes_chk CHECK (cardinality(scopes) >= 1)
);

-- ─────────────────────────────────────────
-- 3. CÓDIGOS DE AUTORIZAÇÃO
-- ─────────────────────────────────────────
-- Vida curta e uso único. O `code_challenge` é o PKCE: sem ele, um atacante que
-- interceptasse o código o trocaria por token.
CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_codes (
  code_hash         text        PRIMARY KEY,
  client_id         text        NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL,
  redirect_uri      text        NOT NULL,
  code_challenge    text        NOT NULL,
  code_challenge_method text    NOT NULL,
  scopes            text[]      NOT NULL,
  organization_ids  uuid[]      NOT NULL,
  -- RFC 8707: para qual servidor o token será emitido. Guardado para o token
  -- nascer com a audiência certa.
  resource          text,
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- O spec do MCP manda implementar PKCE; `plain` é o método que o OAuth 2.1
  -- removeu, e aceitá-lo seria oferecer a porta que o PKCE existe para fechar.
  CONSTRAINT mcp_oauth_codes_method_chk CHECK (code_challenge_method = 'S256')
);

-- ─────────────────────────────────────────
-- 4. TOKENS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id          uuid        NOT NULL REFERENCES mcp_oauth_access_grants(id) ON DELETE CASCADE,
  kind              text        NOT NULL,
  -- SHA-256 em hex do token. O texto claro existe uma vez só, na resposta.
  token_hash        text        NOT NULL UNIQUE,
  -- Audiência (RFC 8707). O servidor MCP recusa token emitido para outro
  -- recurso — é o que impede token de outro serviço de valer aqui.
  resource          text,
  expires_at        timestamptz NOT NULL,
  last_used_at      timestamptz,
  revoked_at        timestamptz,
  -- Rotação de refresh: o token novo aponta para o que substituiu. Reuso de um
  -- refresh já rotacionado é sinal de roubo, e a cadeia inteira cai.
  replaced_by       uuid        REFERENCES mcp_oauth_tokens(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mcp_oauth_tokens_kind_chk CHECK (kind IN ('access', 'refresh'))
);

-- ─────────────────────────────────────────
-- 5. ÍNDICES
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_user
  ON mcp_oauth_access_grants (user_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_client
  ON mcp_oauth_access_grants (client_id);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_grant
  ON mcp_oauth_tokens (grant_id, kind);

-- A consulta de todo request autenticado: achar o token vivo pelo hash.
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_vivos
  ON mcp_oauth_tokens (token_hash) WHERE revoked_at IS NULL;

-- Limpeza de códigos expirados.
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_expira
  ON mcp_oauth_authorization_codes (expires_at);

-- ─────────────────────────────────────────
-- 6. RLS
-- ─────────────────────────────────────────
-- Estas tabelas não são por organização, são por USUÁRIO e por cliente OAuth.
-- Habilitar RLS sem policy nenhuma em `mcp_oauth_clients`, códigos e tokens é
-- deliberado: nada além do servidor deve lê-los, e o servidor conecta pelo
-- papel que ignora RLS. O usuário só precisa enxergar os PRÓPRIOS
-- consentimentos, para poder revogá-los.
ALTER TABLE mcp_oauth_clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_tokens              ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_access_grants       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mcp_oauth_access_grants: o dono le os proprios" ON mcp_oauth_access_grants;
CREATE POLICY "mcp_oauth_access_grants: o dono le os proprios"
  ON mcp_oauth_access_grants FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "mcp_oauth_access_grants: o dono revoga os proprios" ON mcp_oauth_access_grants;
CREATE POLICY "mcp_oauth_access_grants: o dono revoga os proprios"
  ON mcp_oauth_access_grants FOR UPDATE
  USING (user_id = auth.uid());
