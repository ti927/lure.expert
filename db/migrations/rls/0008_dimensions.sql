-- Sessão 3.0 — Dimensões analíticas
-- Cria as 3 tabelas de dimensão (centros de custo, unidades de negócio, entidades jurídicas)
-- e adiciona FKs em transactions e categorization_rules.

-- ─────────────────────────────────────────
-- 1. CENTROS DE CUSTO
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_centers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  code            text,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_centers_org ON cost_centers (organization_id);

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cost_centers: leitura pela org"
  ON cost_centers FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "cost_centers: insert pela org"
  ON cost_centers FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "cost_centers: update pela org"
  ON cost_centers FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "cost_centers: delete pela org"
  ON cost_centers FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- ─────────────────────────────────────────
-- 2. UNIDADES DE NEGÓCIO
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_units (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  code            text,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_units_org ON business_units (organization_id);

ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_units: leitura pela org"
  ON business_units FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "business_units: insert pela org"
  ON business_units FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "business_units: update pela org"
  ON business_units FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "business_units: delete pela org"
  ON business_units FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- ─────────────────────────────────────────
-- 3. ENTIDADES JURÍDICAS (matrizes/filiais)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_entities (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  cnpj            text,
  code            text,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_entities_org ON legal_entities (organization_id);

ALTER TABLE legal_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "legal_entities: leitura pela org"
  ON legal_entities FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "legal_entities: insert pela org"
  ON legal_entities FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "legal_entities: update pela org"
  ON legal_entities FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "legal_entities: delete pela org"
  ON legal_entities FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- ─────────────────────────────────────────
-- 4. ALTER TABLE transactions — 3 FKs novas
-- ─────────────────────────────────────────
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS cost_center_id   uuid REFERENCES cost_centers(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_unit_id uuid REFERENCES business_units(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legal_entity_id  uuid REFERENCES legal_entities(id)  ON DELETE SET NULL;

-- ─────────────────────────────────────────
-- 5. ALTER TABLE categorization_rules — targetCategoryId nullable + 3 FKs novas
-- ─────────────────────────────────────────

-- targetCategoryId torna-se nullable: uma regra pode focar só em dimensões sem alterar categoria
ALTER TABLE categorization_rules
  ALTER COLUMN target_category_id DROP NOT NULL;

ALTER TABLE categorization_rules
  ADD COLUMN IF NOT EXISTS target_cost_center_id   uuid REFERENCES cost_centers(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_business_unit_id uuid REFERENCES business_units(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_legal_entity_id  uuid REFERENCES legal_entities(id)  ON DELETE SET NULL;
