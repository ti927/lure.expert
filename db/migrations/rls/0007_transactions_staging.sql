-- Tabela de staging para linhas extraídas antes da revisão humana
CREATE TABLE IF NOT EXISTS transactions_staging (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id     uuid        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  row_index       integer     NOT NULL,
  raw_data        jsonb       NOT NULL DEFAULT '{}',
  date            text,
  amount          numeric(15,2),
  direction       text,       -- inflow | outflow
  description     text,
  status          text        NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staging_org_doc ON transactions_staging (organization_id, document_id);

-- RLS
ALTER TABLE transactions_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staging: leitura pela org"
  ON transactions_staging FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "staging: insert via service role"
  ON transactions_staging FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "staging: update pela org"
  ON transactions_staging FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "staging: delete pela org"
  ON transactions_staging FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );
