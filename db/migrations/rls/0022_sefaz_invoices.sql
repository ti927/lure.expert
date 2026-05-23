-- 0022 — Fase 7: Integração SEFAZ / NF-e
--
-- Contexto:
--   Cada CNPJ monitorado é uma Entidade Jurídica da org (legal_entities).
--   O CNPJ da organization é apenas para billing — não entra neste pipeline.
--
-- Novas tabelas:
--   sefaz_connections — uma por CNPJ monitorado (vinculada a legal_entity)
--   invoices          — NFs puxadas do SEFAZ (separadas de transactions)
--
-- Alteração em transactions:
--   invoice_id nullable → quando NF é reconciliada com a transaction,
--   transactions.date é atualizado para data_emissao da NF (competência real).

-- ─────────────────────────────────────────
-- 1. SEFAZ_CONNECTIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sefaz_connections (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id      uuid        NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  cnpj                 text        NOT NULL,
  provider             text        NOT NULL DEFAULT 'abstract',
  provider_company_id  text,
  api_key_encrypted    text,
  certificate_expiry   date,
  environment          text        NOT NULL DEFAULT 'producao',
  pull_saida           boolean     NOT NULL DEFAULT true,
  pull_entrada         boolean     NOT NULL DEFAULT true,
  auto_manifest        boolean     NOT NULL DEFAULT true,
  status               text        NOT NULL DEFAULT 'pending',
  last_sync_at         timestamptz,
  last_sync_status     text,
  last_sync_error      text,
  metadata             jsonb       NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sefaz_connections_org_cnpj_uniq
  ON sefaz_connections (organization_id, cnpj);

CREATE INDEX IF NOT EXISTS idx_sefaz_connections_org
  ON sefaz_connections (organization_id);

CREATE INDEX IF NOT EXISTS idx_sefaz_connections_legal_entity
  ON sefaz_connections (legal_entity_id);

ALTER TABLE sefaz_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sefaz_connections: leitura pela org"
  ON sefaz_connections FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "sefaz_connections: insert pela org"
  ON sefaz_connections FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "sefaz_connections: update pela org"
  ON sefaz_connections FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "sefaz_connections: delete pela org"
  ON sefaz_connections FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- ─────────────────────────────────────────
-- 2. INVOICES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id       uuid          NOT NULL REFERENCES legal_entities(id),
  sefaz_connection_id   uuid          NOT NULL REFERENCES sefaz_connections(id),
  chave_acesso          text          NOT NULL,
  numero_nf             text,
  serie                 text,
  tipo                  text          NOT NULL,
  emitente_cnpj         text          NOT NULL,
  emitente_nome         text,
  destinatario_cnpj     text,
  destinatario_nome     text,
  contact_id            uuid          REFERENCES contacts(id) ON DELETE SET NULL,
  data_emissao          date          NOT NULL,
  data_saida_entrada    date,
  total_nf              numeric(15,2) NOT NULL,
  total_impostos        numeric(15,2),
  status                text          NOT NULL DEFAULT 'nova',
  -- transaction_id: FK adicionada após o CREATE para evitar referência circular com transactions
  transaction_id        uuid,
  reconciliation_score  numeric(3,2),
  xml_content           text,
  metadata              jsonb         NOT NULL DEFAULT '{}',
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_chave_acesso_uniq
  ON invoices (organization_id, chave_acesso);

CREATE INDEX IF NOT EXISTS idx_invoices_org_tipo_status
  ON invoices (organization_id, tipo, status);

CREATE INDEX IF NOT EXISTS idx_invoices_data_emissao
  ON invoices (organization_id, data_emissao);

CREATE INDEX IF NOT EXISTS idx_invoices_transaction
  ON invoices (transaction_id)
  WHERE transaction_id IS NOT NULL;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices: leitura pela org"
  ON invoices FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "invoices: insert pela org"
  ON invoices FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "invoices: update pela org"
  ON invoices FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "invoices: delete pela org"
  ON invoices FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- ─────────────────────────────────────────
-- 3. FKs CRUZADAS (evitam referência circular no CREATE TABLE)
-- ─────────────────────────────────────────

-- invoices.transaction_id → transactions.id
ALTER TABLE invoices
  ADD CONSTRAINT fk_invoices_transaction
  FOREIGN KEY (transaction_id)
  REFERENCES transactions(id)
  ON DELETE SET NULL;

-- transactions.invoice_id → invoices.id
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS invoice_id uuid;

ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_invoice
  FOREIGN KEY (invoice_id)
  REFERENCES invoices(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tx_invoice
  ON transactions (invoice_id)
  WHERE invoice_id IS NOT NULL;
