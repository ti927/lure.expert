-- RLS: credit_card_invoices, documents, transactions, templates,
--      conversations, messages, organization_facts, agent_events
-- Sessões 1.4 + 1.5 — policies que estavam faltando no 0004
-- Rodar no Supabase Studio > SQL Editor

-- ============================================================
-- credit_card_invoices
-- ============================================================
ALTER TABLE credit_card_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem faturas CC da organização"
  ON credit_card_invoices FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ inserem faturas CC"
  ON credit_card_invoices FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ atualizam faturas CC"
  ON credit_card_invoices FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE TRIGGER trg_credit_card_invoices_updated_at
  BEFORE UPDATE ON credit_card_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- documents
-- ============================================================
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem documentos da organização"
  ON documents FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ inserem documentos"
  ON documents FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ atualizam documentos"
  ON documents FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

-- ============================================================
-- transactions
-- ============================================================
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem transações da organização"
  ON transactions FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ inserem transações"
  ON transactions FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ atualizam transações"
  ON transactions FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- templates
-- organization_id nullable: NULL = global (todas as orgs veem,
-- só service_role insere). Não-null = específico da org.
-- ============================================================
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem templates da org ou globais"
  ON templates FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ criam templates na org"
  ON templates FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ atualizam templates na org"
  ON templates FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE TRIGGER trg_templates_updated_at
  BEFORE UPDATE ON templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- conversations
-- ============================================================
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem conversas da organização"
  ON conversations FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Membros inserem conversas na organização"
  ON conversations FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Usuários atualizam suas próprias conversas"
  ON conversations FOR UPDATE
  USING (
    user_id = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- messages
-- Sem organization_id direto — acessa via conversations
-- ============================================================
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem mensagens de suas conversas"
  ON messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE organization_id IN (
        SELECT organization_id FROM memberships
        WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
      )
    )
  );

CREATE POLICY "Membros inserem em suas conversas"
  ON messages FOR INSERT
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE organization_id IN (
        SELECT organization_id FROM memberships
        WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
      )
    )
  );

-- ============================================================
-- organization_facts
-- ============================================================
ALTER TABLE organization_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem fatos da organização"
  ON organization_facts FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ inserem fatos"
  ON organization_facts FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ atualizam fatos"
  ON organization_facts FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE TRIGGER trg_organization_facts_updated_at
  BEFORE UPDATE ON organization_facts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- agent_events
-- Tabela de auditoria. INSERT via service_role apenas (sem policy
-- para o role authenticated — service_role bypassa RLS).
-- Membros podem ler seus próprios eventos.
-- ============================================================
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem eventos da organização"
  ON agent_events FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );
