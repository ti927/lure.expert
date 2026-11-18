-- Folha de pagamento no orçamento — o quadro de pessoal (18/nov/2026).
--
-- O orçamento de pessoal deixa de ser digitado linha a linha e passa a nascer de
-- um QUADRO: cada pessoa (ou vaga) com vínculo, valor, período e rateio por
-- centro de custo / unidade de negócio. "Gerar folha" materializa o quadro em
-- `budget_series` (source = 'folha'), que segue sendo a fonte do orçado.
-- Ver docs/superpowers/specs/2026-11-18-folha-no-orcamento-design.md.
--
-- Cinco tabelas novas, sete colunas em `legal_entities` e o CHECK de `source`
-- de `budget_series` ganhando 'folha'.
--
-- ALÍQUOTAS E PERCENTUAIS DE REAJUSTE são FRAÇÃO decimal (0.20 = 20%), como
-- `adjustment_rate` do orçamento. Só `budget_people_allocations.percentual` é
-- percentual de 0 a 100 (rateio entre centros de custo), e a soma = 100 é
-- validada NA ESCRITA, não no banco.
--
-- Rodar no Supabase Studio > SQL Editor. Reversa: 0036_down_folha_orcamento.sql
-- (perde o quadro de pessoal inteiro e as séries geradas pela folha).

-- ── legal_entities: parâmetros de encargos ──────────────────────────────────
ALTER TABLE legal_entities
  ADD COLUMN IF NOT EXISTS regime_tributario      text,
  ADD COLUMN IF NOT EXISTS simples_anexo_iv       boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aliquota_inss_patronal numeric(6,4)  NOT NULL DEFAULT 0.20,
  ADD COLUMN IF NOT EXISTS aliquota_rat_fap       numeric(6,4)  NOT NULL DEFAULT 0.02,
  ADD COLUMN IF NOT EXISTS aliquota_terceiros     numeric(6,4)  NOT NULL DEFAULT 0.058,
  ADD COLUMN IF NOT EXISTS aliquota_fgts          numeric(6,4)  NOT NULL DEFAULT 0.08,
  ADD COLUMN IF NOT EXISTS updated_at             timestamptz   NOT NULL DEFAULT now();

ALTER TABLE legal_entities DROP CONSTRAINT IF EXISTS legal_entities_regime_chk;
ALTER TABLE legal_entities ADD CONSTRAINT legal_entities_regime_chk
  CHECK (regime_tributario IS NULL OR regime_tributario IN ('lucro_real', 'lucro_presumido', 'simples'));

ALTER TABLE legal_entities DROP CONSTRAINT IF EXISTS legal_entities_aliquotas_chk;
ALTER TABLE legal_entities ADD CONSTRAINT legal_entities_aliquotas_chk
  CHECK (aliquota_inss_patronal BETWEEN 0 AND 1
     AND aliquota_rat_fap       BETWEEN 0 AND 1
     AND aliquota_terceiros     BETWEEN 0 AND 1
     AND aliquota_fgts          BETWEEN 0 AND 1);

DROP TRIGGER IF EXISTS trg_legal_entities_updated_at ON legal_entities;
CREATE TRIGGER trg_legal_entities_updated_at
  BEFORE UPDATE ON legal_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── budget_payroll_settings: uma por versão de orçamento ────────────────────
CREATE TABLE IF NOT EXISTS budget_payroll_settings (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL REFERENCES organizations(id)    ON DELETE CASCADE,
  version_id          uuid          NOT NULL UNIQUE REFERENCES budget_versions(id) ON DELETE CASCADE,
  -- 'provisao': 13º e férias rateados mês a mês; 'pagamento': no mês em que saem.
  modo_provisao       text          NOT NULL DEFAULT 'provisao',
  dissidio_mes        integer,
  -- FRAÇÃO: 0.05 = 5%.
  dissidio_pct        numeric(7,4),
  -- Quando o quadro foi mexido por último; comparado a `gerado_em` diz se a
  -- folha gerada está desatualizada.
  quadro_alterado_em  timestamptz   NOT NULL DEFAULT now(),
  gerado_em           timestamptz,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT budget_payroll_settings_modo_chk     CHECK (modo_provisao IN ('provisao', 'pagamento')),
  CONSTRAINT budget_payroll_settings_dissidio_mes_chk CHECK (dissidio_mes IS NULL OR dissidio_mes BETWEEN 1 AND 12),
  CONSTRAINT budget_payroll_settings_dissidio_pct_chk CHECK (dissidio_pct IS NULL OR dissidio_pct >= 0)
);

CREATE INDEX IF NOT EXISTS idx_budget_payroll_settings_org ON budget_payroll_settings (organization_id);

-- ── budget_people: o quadro de pessoal ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_people (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL REFERENCES organizations(id)    ON DELETE CASCADE,
  version_id        uuid          NOT NULL REFERENCES budget_versions(id)  ON DELETE CASCADE,
  nome              text,
  is_vaga           boolean       NOT NULL DEFAULT false,
  -- 'clt' | 'pj' | 'pro_labore' | 'estagio'
  vinculo           text          NOT NULL,
  cargo             text,
  -- Entidade que paga: dela vêm o regime e as alíquotas de encargo. Obrigatória
  -- onde há encargo (CLT e pró-labore). RESTRICT: entidade com quadro não some.
  legal_entity_id   uuid          REFERENCES legal_entities(id) ON DELETE RESTRICT,
  contact_id        uuid          REFERENCES contacts(id)       ON DELETE SET NULL,
  valor_base        numeric(15,2) NOT NULL,
  outros_proventos  numeric(15,2) NOT NULL DEFAULT 0,
  mes_entrada       integer       NOT NULL DEFAULT 1,
  mes_saida         integer       NOT NULL DEFAULT 12,
  -- Só PJ: meses em que há pagamento (nulo = todos entre entrada e saída).
  meses_pj          integer[],
  mes_ferias        integer,
  dia_pagamento_pj  integer       NOT NULL DEFAULT 10,
  aplica_dissidio   boolean       NOT NULL DEFAULT true,
  reajuste_mes      integer,
  -- FRAÇÃO: 0.05 = 5%.
  reajuste_pct      numeric(7,4),
  -- componente da folha → category_id (sobrepõe o mapa da organização).
  naturezas         jsonb         NOT NULL DEFAULT '{}',
  observacao        text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT budget_people_vinculo_chk     CHECK (vinculo IN ('clt', 'pj', 'pro_labore', 'estagio')),
  CONSTRAINT budget_people_valor_base_chk  CHECK (valor_base > 0),
  CONSTRAINT budget_people_proventos_chk   CHECK (outros_proventos >= 0),
  CONSTRAINT budget_people_mes_entrada_chk CHECK (mes_entrada BETWEEN 1 AND 12),
  CONSTRAINT budget_people_mes_saida_chk   CHECK (mes_saida BETWEEN 1 AND 12),
  CONSTRAINT budget_people_periodo_chk     CHECK (mes_saida >= mes_entrada),
  CONSTRAINT budget_people_mes_ferias_chk  CHECK (mes_ferias IS NULL OR mes_ferias BETWEEN 1 AND 12),
  CONSTRAINT budget_people_dia_pj_chk      CHECK (dia_pagamento_pj BETWEEN 1 AND 28),
  CONSTRAINT budget_people_reajuste_mes_chk CHECK (reajuste_mes IS NULL OR reajuste_mes BETWEEN 1 AND 12),
  CONSTRAINT budget_people_reajuste_pct_chk CHECK (reajuste_pct IS NULL OR reajuste_pct >= 0),
  CONSTRAINT budget_people_nome_chk        CHECK (is_vaga OR nome IS NOT NULL),
  CONSTRAINT budget_people_entidade_chk    CHECK (vinculo NOT IN ('clt', 'pro_labore') OR legal_entity_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_budget_people_version ON budget_people (version_id);
CREATE INDEX IF NOT EXISTS idx_budget_people_org     ON budget_people (organization_id);

-- ── budget_people_allocations: rateio da pessoa por CC / UEN ────────────────
-- A soma dos percentuais = 100 é validada na escrita (um CHECK enxerga uma
-- linha por vez, e a soma é propriedade do conjunto).
CREATE TABLE IF NOT EXISTS budget_people_allocations (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL REFERENCES organizations(id)   ON DELETE CASCADE,
  person_id         uuid          NOT NULL REFERENCES budget_people(id)   ON DELETE CASCADE,
  cost_center_id    uuid          REFERENCES cost_centers(id)             ON DELETE SET NULL,
  business_unit_id  uuid          REFERENCES business_units(id)           ON DELETE SET NULL,
  percentual        numeric(5,2)  NOT NULL,
  ordem             integer       NOT NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT budget_people_allocations_pct_chk CHECK (percentual > 0 AND percentual <= 100)
);

CREATE INDEX IF NOT EXISTS idx_budget_people_allocations_person ON budget_people_allocations (person_id);
CREATE INDEX IF NOT EXISTS idx_budget_people_allocations_org    ON budget_people_allocations (organization_id);

-- ── budget_people_benefits: benefícios mensais da pessoa ────────────────────
CREATE TABLE IF NOT EXISTS budget_people_benefits (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL REFERENCES organizations(id)   ON DELETE CASCADE,
  person_id         uuid          NOT NULL REFERENCES budget_people(id)   ON DELETE CASCADE,
  nome              text          NOT NULL,
  valor_mensal      numeric(15,2) NOT NULL,
  category_id       uuid          REFERENCES categories(id)               ON DELETE RESTRICT,
  ordem             integer,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT budget_people_benefits_valor_chk CHECK (valor_mensal > 0)
);

CREATE INDEX IF NOT EXISTS idx_budget_people_benefits_person ON budget_people_benefits (person_id);
CREATE INDEX IF NOT EXISTS idx_budget_people_benefits_org    ON budget_people_benefits (organization_id);

-- ── payroll_category_map: componente da folha → natureza, por organização ───
CREATE TABLE IF NOT EXISTS payroll_category_map (
  organization_id   uuid          NOT NULL REFERENCES organizations(id)   ON DELETE CASCADE,
  componente        text          NOT NULL,
  category_id       uuid          NOT NULL REFERENCES categories(id)      ON DELETE RESTRICT,
  updated_at        timestamptz   NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, componente)
);

-- ── gatilhos updated_at ─────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_budget_payroll_settings_updated_at ON budget_payroll_settings;
CREATE TRIGGER trg_budget_payroll_settings_updated_at
  BEFORE UPDATE ON budget_payroll_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_budget_people_updated_at ON budget_people;
CREATE TRIGGER trg_budget_people_updated_at
  BEFORE UPDATE ON budget_people FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_budget_people_allocations_updated_at ON budget_people_allocations;
CREATE TRIGGER trg_budget_people_allocations_updated_at
  BEFORE UPDATE ON budget_people_allocations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_budget_people_benefits_updated_at ON budget_people_benefits;
CREATE TRIGGER trg_budget_people_benefits_updated_at
  BEFORE UPDATE ON budget_people_benefits FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_payroll_category_map_updated_at ON payroll_category_map;
CREATE TRIGGER trg_payroll_category_map_updated_at
  BEFORE UPDATE ON payroll_category_map FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS: 4 policies por tabela, via memberships aceitas ─────────────────────
ALTER TABLE budget_payroll_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_people             ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_people_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_people_benefits    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_category_map      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_payroll_settings', 'budget_people', 'budget_people_allocations',
                           'budget_people_benefits', 'payroll_category_map']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': leitura pela org', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT
      USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL))$p$,
      t || ': leitura pela org', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': insert pela org', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT
      WITH CHECK (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL))$p$,
      t || ': insert pela org', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': update pela org', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR UPDATE
      USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL))$p$,
      t || ': update pela org', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': delete pela org', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR DELETE
      USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL))$p$,
      t || ': delete pela org', t);
  END LOOP;
END $$;

-- ── budget_series: 'folha' passa a ser uma origem válida ────────────────────
ALTER TABLE budget_series DROP CONSTRAINT IF EXISTS budget_series_source_chk;
ALTER TABLE budget_series ADD CONSTRAINT budget_series_source_chk
  CHECK (source IN ('manual', 'copia_realizado', 'csv', 'recorrencia_detectada', 'duplicacao', 'folha'));
