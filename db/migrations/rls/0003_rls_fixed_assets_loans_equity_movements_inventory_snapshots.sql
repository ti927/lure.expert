-- RLS: fixed_assets, loans, equity_movements, inventory_snapshots
-- Rodar no Supabase Studio > SQL Editor

-- ============================================================
-- fixed_assets
-- ============================================================
ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem imobilizado da organização"
  ON fixed_assets FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ inserem imobilizado"
  ON fixed_assets FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ atualizam imobilizado"
  ON fixed_assets FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE TRIGGER trg_fixed_assets_updated_at
  BEFORE UPDATE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_fixed_assets_org ON fixed_assets (organization_id, status);

-- ============================================================
-- loans
-- ============================================================
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem empréstimos da organização"
  ON loans FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ inserem empréstimos"
  ON loans FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ atualizam empréstimos"
  ON loans FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE TRIGGER trg_loans_updated_at
  BEFORE UPDATE ON loans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_loans_org_status ON loans (organization_id, status);

-- ============================================================
-- equity_movements
-- ============================================================
ALTER TABLE equity_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem movimentos de PL da organização"
  ON equity_movements FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Owners e admins inserem movimentos de PL"
  ON equity_movements FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Owners e admins atualizam movimentos de PL"
  ON equity_movements FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin')
        AND accepted_at IS NOT NULL
    )
  );

CREATE TRIGGER trg_equity_movements_updated_at
  BEFORE UPDATE ON equity_movements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_equity_movements_org_date ON equity_movements (organization_id, date DESC);

-- ============================================================
-- inventory_snapshots
-- ============================================================
ALTER TABLE inventory_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem snapshots de estoque da organização"
  ON inventory_snapshots FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Controllers+ inserem snapshots de estoque"
  ON inventory_snapshots FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'controller')
        AND accepted_at IS NOT NULL
    )
  );

CREATE INDEX idx_inventory_org_date ON inventory_snapshots (organization_id, snapshot_date DESC);
