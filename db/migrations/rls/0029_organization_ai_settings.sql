-- Fase 2 — chave de IA por organização, teto e alerta.
--
-- Reverte duas decisões que estavam no CLAUDE.md ("custo de IA é interno, sem
-- BYO API key" e "não expor tokens ao cliente"). O motivo é operacional: havia
-- clientes usando o app sem supervisão e consumindo os créditos da Lure, sem
-- teto, sem alerta e sem atribuição.
--
-- TABELA PRÓPRIA, e não `organizations.settings`. O JSONB de settings é lido e
-- devolvido inteiro em vários caminhos do app; guardar segredo ali é convidar o
-- vazamento por um `SELECT *` distraído. Aqui a coluna cifrada mora sozinha, e
-- quem quiser lê-la precisa dizer o nome dela.
--
-- Rodar no Supabase Studio > SQL Editor.

CREATE TABLE IF NOT EXISTS organization_ai_settings (
  organization_id   uuid          PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

  -- 'own'      → a organização traz a própria chave (o padrão a partir daqui)
  -- 'platform' → usa a chave da Lure, por exceção explícita: organizações de
  --              teste e, se houver, período de trial. É esta coluna que faz a
  --              visibilidade do consumo ter dois níveis — quem paga vê tokens
  --              e reais, quem está na chave da plataforma vê unidades de valor.
  key_source        text          NOT NULL DEFAULT 'own',

  -- AES-256-GCM, formato "v1.<iv>.<tag>.<dados>" (ver src/lib/crypto.ts).
  -- NUNCA base64 puro: a chave precisa voltar ao texto claro para ser usada, o
  -- que é diferente de token de acesso, onde hash bastaria.
  api_key_encrypted text,

  -- Os 4 últimos caracteres, para a tela identificar a chave sem exibi-la.
  -- É o único fragmento que pode aparecer em tela, log ou resposta.
  api_key_last4     text,

  -- Quando a chave foi testada contra a API pela última vez. Nulo = nunca
  -- validada, e a tela avisa em vez de deixar o cliente descobrir num upload.
  api_key_validated_at timestamptz,
  api_key_error     text,

  -- Teto mensal em dólar. Nulo = sem teto.
  monthly_limit_usd numeric(10,2),

  -- Em que percentual avisar antes de cortar.
  alert_threshold   numeric(5,2)  NOT NULL DEFAULT 80,
  -- Mês em que o aviso de 80% já foi enviado, para não repetir a cada job.
  alerted_month     text,

  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT org_ai_key_source_chk CHECK (key_source IN ('own', 'platform')),
  CONSTRAINT org_ai_limit_chk      CHECK (monthly_limit_usd IS NULL OR monthly_limit_usd >= 0),
  CONSTRAINT org_ai_threshold_chk  CHECK (alert_threshold > 0 AND alert_threshold <= 100),
  CONSTRAINT org_ai_alerted_chk    CHECK (alerted_month IS NULL OR alerted_month ~ '^\d{4}-\d{2}$'),

  -- Coerência: com `key_source = 'own'` ou existe chave, ou a organização ainda
  -- não configurou (e a IA fica desligada). O que NÃO pode existir é chave
  -- cifrada sem os 4 últimos, que deixaria a tela sem como identificá-la.
  CONSTRAINT org_ai_key_pair_chk CHECK (
    (api_key_encrypted IS NULL AND api_key_last4 IS NULL) OR
    (api_key_encrypted IS NOT NULL AND api_key_last4 IS NOT NULL)
  )
);

DROP TRIGGER IF EXISTS trg_organization_ai_settings_updated_at ON organization_ai_settings;
CREATE TRIGGER trg_organization_ai_settings_updated_at
  BEFORE UPDATE ON organization_ai_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE organization_ai_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organization_ai_settings: leitura pela org" ON organization_ai_settings;
CREATE POLICY "organization_ai_settings: leitura pela org"
  ON organization_ai_settings FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "organization_ai_settings: insert pela org" ON organization_ai_settings;
CREATE POLICY "organization_ai_settings: insert pela org"
  ON organization_ai_settings FOR INSERT
  WITH CHECK (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "organization_ai_settings: update pela org" ON organization_ai_settings;
CREATE POLICY "organization_ai_settings: update pela org"
  ON organization_ai_settings FOR UPDATE
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "organization_ai_settings: delete pela org" ON organization_ai_settings;
CREATE POLICY "organization_ai_settings: delete pela org"
  ON organization_ai_settings FOR DELETE
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

-- ─────────────────────────────────────────
-- Organizações existentes continuam na chave da plataforma.
-- ─────────────────────────────────────────
-- Sem isto, aplicar a migration desligaria a IA de todo mundo no mesmo instante
-- — inclusive dos clientes que estão importando hoje. A troca para chave própria
-- passa a ser uma decisão por organização, tomada na tela.
INSERT INTO organization_ai_settings (organization_id, key_source)
SELECT id, 'platform' FROM organizations
ON CONFLICT (organization_id) DO NOTHING;
