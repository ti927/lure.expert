-- Fase 1.4 — painéis configuráveis.
--
-- Antecipada da Fase 5 de propósito. O grupo de ferramentas de dashboard é a
-- maior parte do valor do MCP, e sem estas tabelas o servidor MCP teria de ser
-- lançado duas vezes: uma sem elas, outra depois. Aqui entram só schema e Zod;
-- o renderizador continua na Fase 5.
--
-- MODELO: o painel é de um USUÁRIO (`owner_user_id`), e o compartilhamento é
-- uma tabela à parte. Poderia ser uma coluna `visibilidade` no painel — mas
-- "decidido na criação" é restrição de tela, não de armazenamento, e a linha
-- separada é o que permite compartilhar com três pessoas específicas sem
-- reescrever o schema.
--
-- Rodar no Supabase Studio > SQL Editor.

-- ─────────────────────────────────────────
-- 1. TABELAS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboards (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Sem FK: `auth.users` vive noutro schema, e o resto do projeto também
  -- guarda `user_id` solto (ver `memberships`).
  owner_user_id     uuid        NOT NULL,

  name              text        NOT NULL,
  slug              text        NOT NULL,
  description       text,

  -- O painel que abre quando ninguém escolheu outro. Um por (org, usuário),
  -- garantido pelo índice parcial mais abaixo.
  is_default        boolean     NOT NULL DEFAULT false,

  -- Disposição dos blocos na grade (colunas, ordem, tamanho). Fica aqui e não
  -- no bloco porque é propriedade do conjunto: mover um bloco mexe na posição
  -- dos outros.
  layout            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dashboards_name_chk CHECK (length(trim(name)) > 0),
  CONSTRAINT dashboards_slug_chk CHECK (slug ~ '^[a-z0-9-]+$')
);

CREATE TABLE IF NOT EXISTS dashboard_blocks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id      uuid        NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,

  -- Desnormalizada de propósito: o motor de consulta filtra por organização em
  -- toda leitura, e sem esta coluna cada bloco exigiria um join de volta no
  -- painel só para saber de quem ele é.
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  position          integer     NOT NULL DEFAULT 0,
  title             text,

  -- A especificação do bloco: apresentação + a consulta, no MESMO schema Zod
  -- que o motor e a ferramenta MCP usam. O banco guarda jsonb, mas nada entra
  -- sem passar pelo `blockSpecSchema` — inclusive na LEITURA, porque spec
  -- gravada por versão antiga tem de falhar alto em vez de renderizar lixo.
  spec              jsonb       NOT NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dashboard_blocks_position_chk CHECK (position >= 0),
  -- Barato e pega o erro mais provável: gravar um array ou um escalar.
  CONSTRAINT dashboard_blocks_spec_chk CHECK (jsonb_typeof(spec) = 'object')
);

CREATE TABLE IF NOT EXISTS dashboard_shares (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id      uuid        NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  scope             text        NOT NULL,
  -- Preenchido só quando o escopo é 'usuarios'.
  user_id           uuid,
  permission        text        NOT NULL DEFAULT 'ler',

  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dashboard_shares_scope_chk      CHECK (scope      IN ('organizacao', 'usuarios')),
  CONSTRAINT dashboard_shares_permission_chk CHECK (permission IN ('ler', 'editar')),
  -- Coerência: compartilhar com a organização não nomeia ninguém; compartilhar
  -- com pessoas exige a pessoa. Sem isto, uma linha com scope='organizacao' e
  -- user_id preenchido teria dois significados possíveis.
  CONSTRAINT dashboard_shares_alvo_chk CHECK (
    (scope = 'organizacao' AND user_id IS NULL) OR
    (scope = 'usuarios'    AND user_id IS NOT NULL)
  )
);

-- ─────────────────────────────────────────
-- 2. ÍNDICES
-- ─────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboards_owner_slug
  ON dashboards (organization_id, owner_user_id, slug);

-- No máximo um painel padrão por usuário em cada organização.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboards_um_padrao
  ON dashboards (organization_id, owner_user_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_dashboards_org
  ON dashboards (organization_id, owner_user_id);

CREATE INDEX IF NOT EXISTS idx_dashboard_blocks_painel
  ON dashboard_blocks (dashboard_id, position);

CREATE INDEX IF NOT EXISTS idx_dashboard_blocks_org
  ON dashboard_blocks (organization_id);

CREATE INDEX IF NOT EXISTS idx_dashboard_shares_painel
  ON dashboard_shares (dashboard_id);

-- "Quais painéis foram compartilhados comigo?" é a consulta que abre a tela.
CREATE INDEX IF NOT EXISTS idx_dashboard_shares_usuario
  ON dashboard_shares (organization_id, user_id)
  WHERE user_id IS NOT NULL;

-- Um alvo não pode ser compartilhado duas vezes com o mesmo painel.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_shares_unico
  ON dashboard_shares (dashboard_id, scope, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ─────────────────────────────────────────
-- 3. TRIGGERS updated_at
-- ─────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_dashboards_updated_at ON dashboards;
CREATE TRIGGER trg_dashboards_updated_at
  BEFORE UPDATE ON dashboards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_dashboard_blocks_updated_at ON dashboard_blocks;
CREATE TRIGGER trg_dashboard_blocks_updated_at
  BEFORE UPDATE ON dashboard_blocks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────
ALTER TABLE dashboards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dashboards: leitura pela org" ON dashboards;
CREATE POLICY "dashboards: leitura pela org"
  ON dashboards FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "dashboards: insert pela org" ON dashboards;
CREATE POLICY "dashboards: insert pela org"
  ON dashboards FOR INSERT
  WITH CHECK (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "dashboards: update pela org" ON dashboards;
CREATE POLICY "dashboards: update pela org"
  ON dashboards FOR UPDATE
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "dashboards: delete pela org" ON dashboards;
CREATE POLICY "dashboards: delete pela org"
  ON dashboards FOR DELETE
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "dashboard_blocks: leitura pela org" ON dashboard_blocks;
CREATE POLICY "dashboard_blocks: leitura pela org"
  ON dashboard_blocks FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "dashboard_blocks: insert pela org" ON dashboard_blocks;
CREATE POLICY "dashboard_blocks: insert pela org"
  ON dashboard_blocks FOR INSERT
  WITH CHECK (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "dashboard_blocks: update pela org" ON dashboard_blocks;
CREATE POLICY "dashboard_blocks: update pela org"
  ON dashboard_blocks FOR UPDATE
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "dashboard_blocks: delete pela org" ON dashboard_blocks;
CREATE POLICY "dashboard_blocks: delete pela org"
  ON dashboard_blocks FOR DELETE
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "dashboard_shares: leitura pela org" ON dashboard_shares;
CREATE POLICY "dashboard_shares: leitura pela org"
  ON dashboard_shares FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "dashboard_shares: insert pela org" ON dashboard_shares;
CREATE POLICY "dashboard_shares: insert pela org"
  ON dashboard_shares FOR INSERT
  WITH CHECK (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "dashboard_shares: update pela org" ON dashboard_shares;
CREATE POLICY "dashboard_shares: update pela org"
  ON dashboard_shares FOR UPDATE
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "dashboard_shares: delete pela org" ON dashboard_shares;
CREATE POLICY "dashboard_shares: delete pela org"
  ON dashboard_shares FOR DELETE
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));
