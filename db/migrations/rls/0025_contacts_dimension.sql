-- Fase 10.0 — `contacts` deixa de ser tabela-fantasma e vira a 4a dimensão.
--
-- A tabela existe desde a Fase 1 com FK em `transactions`, `invoices`,
-- `categorization_rules`, `budget_series` e `budget_entries` — e nunca teve uma
-- linha escrita por ninguém. Falta o que as outras três dimensões têm:
-- arquivamento, código, e (novo) o papel cliente/fornecedor.
--
-- Rodar no Supabase Studio > SQL Editor.

-- ─────────────────────────────────────────
-- 1. COLUNAS NOVAS
-- ─────────────────────────────────────────

-- `is_active` e `code` alinham contacts com cost_centers/business_units/
-- legal_entities: o DimensionManager e o import de CSV dependem dos dois.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_active   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS code        text,
  ADD COLUMN IF NOT EXISTS is_customer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_supplier boolean NOT NULL DEFAULT false;

-- Papel duplo: o mesmo CNPJ pode ser cliente E fornecedor (a transportadora que
-- a empresa contrata também compra dela). Um único `type` textual não expressa
-- isso — por isso o par de booleanos.
UPDATE contacts SET is_customer = true WHERE type IN ('customer', 'both');
UPDATE contacts SET is_supplier = true WHERE type IN ('supplier', 'both');

-- `type` continua NOT NULL (é assim que `docs/SCHEMA_INICIAL.md` o define) mas
-- passa a ser DERIVADO dos booleanos na escrita. O DEFAULT existe para que um
-- INSERT que só informe os papéis não quebre.
ALTER TABLE contacts ALTER COLUMN type SET DEFAULT 'other';

-- Um contato arquivado sai dos seletores mas continua explicando o histórico.
CREATE INDEX IF NOT EXISTS idx_contacts_org_active
  ON contacts (organization_id, is_active);

-- ─────────────────────────────────────────
-- 2. POLICY DE DELETE (não existia)
-- ─────────────────────────────────────────
-- A migration 0002 criou SELECT, INSERT e UPDATE para contacts e esqueceu o
-- DELETE — com RLS ativa, isso torna a exclusão impossível pela sessão do
-- usuário. As outras três dimensões (migration 0008) têm as quatro.
DROP POLICY IF EXISTS "Controllers+ deletam contatos" ON contacts;
CREATE POLICY "Controllers+ deletam contatos"
  ON contacts FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

-- ─────────────────────────────────────────
-- 3. ON DELETE SET NULL nas FKs que apontam para contacts
-- ─────────────────────────────────────────
-- Hoje `transactions.contact_id` e `categorization_rules.target_contact_id`
-- usam `no action`: apagar um contato ficaria bloqueado pelo banco. As outras
-- três dimensões usam SET NULL desde a 0008, pelo motivo registrado na Decisão
-- 6 — histórico não deve quebrar, só perder aquela classificação.
-- (`budget_series`, `budget_entries` e `invoices` já nasceram com SET NULL.)

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_contact_id_contacts_id_fk;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_contact_id_contacts_id_fk
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;

ALTER TABLE categorization_rules
  DROP CONSTRAINT IF EXISTS categorization_rules_target_contact_id_contacts_id_fk;
ALTER TABLE categorization_rules
  ADD CONSTRAINT categorization_rules_target_contact_id_contacts_id_fk
  FOREIGN KEY (target_contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
