-- RLS: contacts, categories, categorization_rules
-- Rodar no Supabase Studio > SQL Editor após aplicar db:push

-- ============================================================
-- contacts
-- ============================================================
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem contatos da organização"
  ON contacts FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ inserem contatos"
  ON contacts FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ atualizam contatos"
  ON contacts FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- índice GIN trigram para busca por nome (requer pg_trgm já ativado)
CREATE INDEX idx_contacts_name_search ON contacts USING gin (name gin_trgm_ops);
CREATE INDEX idx_contacts_org ON contacts (organization_id);

-- ============================================================
-- categories
-- ============================================================
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem categorias da organização"
  ON categories FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ inserem categorias"
  ON categories FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ atualizam categorias"
  ON categories FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_categories_parent ON categories (parent_id);
CREATE INDEX idx_categories_org_type ON categories (organization_id, type);

-- ============================================================
-- categorization_rules
-- ============================================================
ALTER TABLE categorization_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem regras da organização"
  ON categorization_rules FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ inserem regras"
  ON categorization_rules FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ atualizam regras"
  ON categorization_rules FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE TRIGGER trg_categorization_rules_updated_at
  BEFORE UPDATE ON categorization_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
