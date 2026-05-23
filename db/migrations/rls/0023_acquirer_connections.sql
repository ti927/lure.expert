-- 0023 — Fase 8: Connectors de Adquirentes
--
-- Contexto:
--   Adquirentes (Stone, Cielo, Rede, PagBank) são fontes separadas de dados
--   transacionais. Cada conexão representa um merchantId (código de
--   estabelecimento) registrado num provedor de adquirência.
--
--   Tabela `acquirer_connections` segue o mesmo padrão de `sefaz_connections`:
--   uma conexão por merchantId por organização, com credenciais cifradas,
--   status de sync e metadata jsonb para extensibilidade.

-- ─────────────────────────────────────────
-- 1. ACQUIRER_CONNECTIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS acquirer_connections (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id      uuid          REFERENCES legal_entities(id) ON DELETE SET NULL,

  -- Provedor de adquirência
  provider             text          NOT NULL DEFAULT 'abstract',
  -- 'stone' | 'cielo' | 'rede' | 'pagbank' | 'abstract'

  -- Código/ID do estabelecimento no provedor
  merchant_id          text          NOT NULL,

  -- Credenciais cifradas (mesmo padrão de sefaz_connections.api_key_encrypted)
  api_key_encrypted    text,
  api_secret_encrypted text,

  -- Ambiente
  environment          text          NOT NULL DEFAULT 'producao',
  -- 'producao' | 'sandbox'

  -- Nome amigável exibido na UI
  display_name         text,

  -- Taxa MDR média (para reconciliação lote × vendas)
  mdr_rate             numeric(5,4),

  -- 'pending' | 'active' | 'error' | 'inactive'
  status               text          NOT NULL DEFAULT 'pending',

  last_sync_at         timestamptz,
  last_sync_status     text,
  last_sync_error      text,

  -- { awaitingFirstSync?: true, fromDate?: string, lastFetchedAt?: string }
  metadata             jsonb         NOT NULL DEFAULT '{}',

  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS acquirer_connections_org_provider_merchant_uniq
  ON acquirer_connections (organization_id, provider, merchant_id);

CREATE INDEX IF NOT EXISTS idx_acquirer_connections_org
  ON acquirer_connections (organization_id);

CREATE INDEX IF NOT EXISTS idx_acquirer_connections_legal_entity
  ON acquirer_connections (legal_entity_id)
  WHERE legal_entity_id IS NOT NULL;

-- ─────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ─────────────────────────────────────────
ALTER TABLE acquirer_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acquirer_connections: leitura pela org"
  ON acquirer_connections FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "acquirer_connections: insert pela org"
  ON acquirer_connections FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "acquirer_connections: update pela org"
  ON acquirer_connections FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "acquirer_connections: delete pela org"
  ON acquirer_connections FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );
