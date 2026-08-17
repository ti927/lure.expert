-- 0024 — Fase 9: Módulo de Orçamento e Previsão
--
-- Aplicar manualmente no Supabase Studio > SQL Editor
--
-- Contexto:
--   Orçamento vive em tabelas COMPLETAMENTE separadas de `transactions`.
--   Nunca uma flag em transactions — a separação é o que garante que orçado
--   jamais vaze num relatório de realizado.
--
--   Três tabelas:
--     budget_versions — o exercício orçado (ano civil), com versões nomeadas.
--                       Duplicar versão serve para revisão E para cenário.
--     budget_series   — a REGRA geradora (o "lote"): descrição, valor, categoria,
--                       dimensões + repetição (N ocorrências a cada M meses).
--     budget_entries  — as OCORRÊNCIAS materializadas (uma linha por mês).
--
--   INVARIANTE: `budget_entries` é a única fonte de verdade para qualquer número
--   exibido. `budget_series` é gerador + defaults. Nenhuma leitura consolidada
--   recomputa a série.
--
--   Convenção de sinal: `amount` é SEMPRE positivo; o sinal vem de `direction`,
--   idêntico a `transactions`. Convenção de data: `competence_date` (competência,
--   alimenta DRE Orçado) e `cash_date` (caixa, alimenta Fluxo Projetado) —
--   espelha `transactions.date` vs `transactions.effective_date`. Diferença:
--   aqui `cash_date` é NOT NULL, logo nenhuma query de caixa precisa de COALESCE.

-- ─────────────────────────────────────────
-- 1. BUDGET_VERSIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_versions (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name                 text          NOT NULL,
  fiscal_year          integer       NOT NULL,

  -- 'rascunho' | 'aprovado' | 'arquivado'
  -- Versão arquivada é read-only na server action, não no banco (reversível).
  status               text          NOT NULL DEFAULT 'rascunho',

  -- A versão vigente do exercício — no máximo uma por (org, ano).
  is_active            boolean       NOT NULL DEFAULT false,

  description          text,

  -- Preenchido quando a versão nasceu de uma duplicação.
  source_version_id    uuid          REFERENCES budget_versions(id) ON DELETE SET NULL,

  -- Auditoria mínima (aponta para auth.users, sem FK — mesmo padrão de memberships.user_id)
  created_by_user_id   uuid,
  approved_by_user_id  uuid,
  approved_at          timestamptz,
  archived_at          timestamptz,

  metadata             jsonb         NOT NULL DEFAULT '{}',

  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT budget_versions_status_chk
    CHECK (status IN ('rascunho', 'aprovado', 'arquivado')),
  CONSTRAINT budget_versions_fiscal_year_chk
    CHECK (fiscal_year BETWEEN 2000 AND 2100),
  -- Uma versão arquivada nunca é a vigente.
  CONSTRAINT budget_versions_active_not_archived_chk
    CHECK (NOT is_active OR status <> 'arquivado')
);

-- Nome único por exercício, case-insensitive e sem depender de espaços nas pontas.
CREATE UNIQUE INDEX IF NOT EXISTS budget_versions_org_year_name_uniq
  ON budget_versions (organization_id, fiscal_year, lower(btrim(name)));

-- No máximo uma versão vigente por exercício.
CREATE UNIQUE INDEX IF NOT EXISTS budget_versions_org_year_active_uniq
  ON budget_versions (organization_id, fiscal_year)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_budget_versions_org_year
  ON budget_versions (organization_id, fiscal_year);

-- ─────────────────────────────────────────
-- 2. BUDGET_SERIES  (a regra geradora)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_series (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_id           uuid          NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,

  description          text          NOT NULL,
  direction            text          NOT NULL,   -- 'inflow' | 'outflow'

  -- Categoria-folha é obrigatória: orçado sem categoria não aparece em relatório
  -- nenhum (a comparação faz INNER JOIN em categories, igual à DRE).
  -- RESTRICT, não SET NULL — apagar categoria com orçado deve falhar de forma
  -- visível (deleteCategory já trata FK violation).
  category_id          uuid          NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  cost_center_id       uuid          REFERENCES cost_centers(id)   ON DELETE SET NULL,
  business_unit_id     uuid          REFERENCES business_units(id) ON DELETE SET NULL,
  legal_entity_id      uuid          REFERENCES legal_entities(id) ON DELETE SET NULL,
  contact_id           uuid          REFERENCES contacts(id)       ON DELETE SET NULL,

  -- ── Repetição ──
  -- `date`, não texto 'YYYY-MM': a duplicação de versão e o copiar-do-realizado
  -- fazem aritmética SQL de data (make_interval), que texto quebraria.
  start_month          date          NOT NULL,
  occurrences          integer       NOT NULL,
  interval_months      integer       NOT NULL DEFAULT 1,   -- 1=mensal, 3=trimestral, 12=anual
  day_of_month         integer       NOT NULL DEFAULT 1,   -- clampado ao último dia do mês na expansão
  cash_lag_days        integer       NOT NULL DEFAULT 0,   -- cash_date = competence_date + lag

  -- ── Valor ──
  -- 'fixo'      → base_amount em todas as ocorrências
  -- 'reajuste'  → base_amount * (1 + adjustment_rate)^floor((i-1)/adjustment_every)
  -- 'sazonal'   → seasonal_amounts[i]
  -- 'parcelado' → total_amount dividido em `occurrences` parcelas
  amount_mode          text          NOT NULL DEFAULT 'fixo',

  base_amount          numeric(15,2),
  total_amount         numeric(15,2),   -- só 'parcelado'; separado de base_amount de propósito:
                                        -- depois de expandir não dá para saber se 1.200 era parcela ou total

  -- FRAÇÃO DECIMAL, não percentual: 0.05 = 5%. Negativo permitido (redução programada).
  adjustment_rate      numeric(7,4),
  -- Conta OCORRÊNCIAS, não meses (com interval_months variável, meses seria ambíguo).
  adjustment_every     integer       NOT NULL DEFAULT 1,

  -- Array de `occurrences` números EM ORDEM DE SEQUÊNCIA — não indexado por mês
  -- do calendário (com interval_months > 1 não existem 12 slots).
  seasonal_amounts     jsonb,

  -- 'manual' | 'copia_realizado' | 'csv' | 'recorrencia_detectada' | 'duplicacao'
  source               text          NOT NULL DEFAULT 'manual',

  notes                text,
  created_by_user_id   uuid,
  metadata             jsonb         NOT NULL DEFAULT '{}',

  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT budget_series_direction_chk
    CHECK (direction IN ('inflow', 'outflow')),
  CONSTRAINT budget_series_start_month_chk
    CHECK (start_month = date_trunc('month', start_month)::date),
  CONSTRAINT budget_series_occurrences_chk
    CHECK (occurrences BETWEEN 1 AND 12),
  CONSTRAINT budget_series_interval_chk
    CHECK (interval_months BETWEEN 1 AND 12),
  CONSTRAINT budget_series_day_chk
    CHECK (day_of_month BETWEEN 1 AND 31),
  CONSTRAINT budget_series_cash_lag_chk
    CHECK (cash_lag_days BETWEEN 0 AND 365),
  CONSTRAINT budget_series_amount_mode_chk
    CHECK (amount_mode IN ('fixo', 'reajuste', 'sazonal', 'parcelado')),
  CONSTRAINT budget_series_adjustment_every_chk
    CHECK (adjustment_every >= 1),
  CONSTRAINT budget_series_adjustment_rate_chk
    CHECK (adjustment_rate IS NULL OR adjustment_rate > -1),
  CONSTRAINT budget_series_source_chk
    CHECK (source IN ('manual', 'copia_realizado', 'csv', 'recorrencia_detectada', 'duplicacao')),

  -- Coerência entre o modo e os campos que ele exige
  CONSTRAINT budget_series_fixo_chk
    CHECK (amount_mode <> 'fixo' OR (base_amount IS NOT NULL AND base_amount >= 0)),
  CONSTRAINT budget_series_reajuste_chk
    CHECK (amount_mode <> 'reajuste' OR (base_amount IS NOT NULL AND base_amount >= 0
                                         AND adjustment_rate IS NOT NULL)),
  CONSTRAINT budget_series_parcelado_chk
    CHECK (amount_mode <> 'parcelado' OR (total_amount IS NOT NULL AND total_amount >= 0)),
  CONSTRAINT budget_series_sazonal_chk
    CHECK (amount_mode <> 'sazonal' OR (seasonal_amounts IS NOT NULL
                                        AND jsonb_typeof(seasonal_amounts) = 'array'
                                        AND jsonb_array_length(seasonal_amounts) = occurrences))
);

CREATE INDEX IF NOT EXISTS idx_budget_series_version
  ON budget_series (version_id);

CREATE INDEX IF NOT EXISTS idx_budget_series_org
  ON budget_series (organization_id);

CREATE INDEX IF NOT EXISTS idx_budget_series_category
  ON budget_series (category_id);

-- ─────────────────────────────────────────
-- 3. BUDGET_ENTRIES  (ocorrências materializadas)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_entries (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_id           uuid          NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,

  -- NOT NULL por decisão: lançamento avulso = série com occurrences = 1.
  -- Um caminho de código só para editar/excluir/expandir.
  series_id            uuid          NOT NULL REFERENCES budget_series(id) ON DELETE CASCADE,

  -- Índice da ocorrência dentro da série (1..N). NUNCA renumerado: após
  -- "excluir somente este mês" ficam buracos, e buracos são válidos.
  sequence             integer       NOT NULL,

  -- Copiados da série na expansão, mas EDITÁVEIS na ocorrência: a entry é o fato
  -- agregado (a query de comparação não faz join de volta na série) e o override
  -- por ocorrência precisa de um lugar de onde divergir.
  description          text          NOT NULL,
  direction            text          NOT NULL,
  category_id          uuid          NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  cost_center_id       uuid          REFERENCES cost_centers(id)   ON DELETE SET NULL,
  business_unit_id     uuid          REFERENCES business_units(id) ON DELETE SET NULL,
  legal_entity_id      uuid          REFERENCES legal_entities(id) ON DELETE SET NULL,
  contact_id           uuid          REFERENCES contacts(id)       ON DELETE SET NULL,

  -- Competência alimenta a DRE Orçada; caixa alimenta o Fluxo Projetado.
  competence_date      date          NOT NULL,
  cash_date            date          NOT NULL,

  -- SEMPRE positivo — o sinal vem de `direction`, igual a transactions.
  amount               numeric(15,2) NOT NULL,

  -- Campos editados à mão nesta ocorrência (ex: {'amount','cost_center_id'}).
  -- Substitui um booleano `is_adjusted`: com granularidade de campo, uma alteração
  -- em lote de centro de custo não precisa pular uma ocorrência cujo único ajuste
  -- foi de valor. Auto-cura: se o valor volta a coincidir com o que a série geraria,
  -- o campo sai do array.
  adjusted_fields      text[]        NOT NULL DEFAULT '{}',

  notes                text,
  metadata             jsonb         NOT NULL DEFAULT '{}',

  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT budget_entries_direction_chk
    CHECK (direction IN ('inflow', 'outflow')),
  CONSTRAINT budget_entries_sequence_chk
    CHECK (sequence >= 1),
  CONSTRAINT budget_entries_amount_chk
    CHECK (amount >= 0)
);

-- Rede de segurança contra duplo clique / regeneração concorrente.
CREATE UNIQUE INDEX IF NOT EXISTS budget_entries_series_sequence_uniq
  ON budget_entries (series_id, sequence);

CREATE INDEX IF NOT EXISTS idx_budget_entries_version_competence
  ON budget_entries (version_id, competence_date);

CREATE INDEX IF NOT EXISTS idx_budget_entries_version_cash
  ON budget_entries (version_id, cash_date);

CREATE INDEX IF NOT EXISTS idx_budget_entries_version_category
  ON budget_entries (version_id, category_id);

CREATE INDEX IF NOT EXISTS idx_budget_entries_org
  ON budget_entries (organization_id);

-- Só as ajustadas à mão — usado pelo preview de "vai sobrescrever N ajustes".
CREATE INDEX IF NOT EXISTS idx_budget_entries_adjusted
  ON budget_entries (version_id)
  WHERE cardinality(adjusted_fields) > 0;

-- ─────────────────────────────────────────
-- 4. TRIGGERS updated_at
-- (as migrations 0022 e 0023 esqueceram — não repetir a lacuna)
-- ─────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_budget_versions_updated_at ON budget_versions;
CREATE TRIGGER trg_budget_versions_updated_at
  BEFORE UPDATE ON budget_versions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_budget_series_updated_at ON budget_series;
CREATE TRIGGER trg_budget_series_updated_at
  BEFORE UPDATE ON budget_series
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_budget_entries_updated_at ON budget_entries;
CREATE TRIGGER trg_budget_entries_updated_at
  BEFORE UPDATE ON budget_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────
-- 5. ROW LEVEL SECURITY
-- ─────────────────────────────────────────
ALTER TABLE budget_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_series   ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_entries  ENABLE ROW LEVEL SECURITY;

-- ── budget_versions ──
DROP POLICY IF EXISTS "budget_versions: leitura pela org" ON budget_versions;
CREATE POLICY "budget_versions: leitura pela org"
  ON budget_versions FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "budget_versions: insert pela org" ON budget_versions;
CREATE POLICY "budget_versions: insert pela org"
  ON budget_versions FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "budget_versions: update pela org" ON budget_versions;
CREATE POLICY "budget_versions: update pela org"
  ON budget_versions FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "budget_versions: delete pela org" ON budget_versions;
CREATE POLICY "budget_versions: delete pela org"
  ON budget_versions FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- ── budget_series ──
DROP POLICY IF EXISTS "budget_series: leitura pela org" ON budget_series;
CREATE POLICY "budget_series: leitura pela org"
  ON budget_series FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "budget_series: insert pela org" ON budget_series;
CREATE POLICY "budget_series: insert pela org"
  ON budget_series FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "budget_series: update pela org" ON budget_series;
CREATE POLICY "budget_series: update pela org"
  ON budget_series FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "budget_series: delete pela org" ON budget_series;
CREATE POLICY "budget_series: delete pela org"
  ON budget_series FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- ── budget_entries ──
DROP POLICY IF EXISTS "budget_entries: leitura pela org" ON budget_entries;
CREATE POLICY "budget_entries: leitura pela org"
  ON budget_entries FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "budget_entries: insert pela org" ON budget_entries;
CREATE POLICY "budget_entries: insert pela org"
  ON budget_entries FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "budget_entries: update pela org" ON budget_entries;
CREATE POLICY "budget_entries: update pela org"
  ON budget_entries FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "budget_entries: delete pela org" ON budget_entries;
CREATE POLICY "budget_entries: delete pela org"
  ON budget_entries FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );
