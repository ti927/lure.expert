import { pgTable, uuid, text, integer, numeric, date, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { budgetVersions } from './budget-versions'
import { categories } from './categories'
import { costCenters } from './cost-centers'
import { businessUnits } from './business-units'
import { legalEntities } from './legal-entities'
import { contacts } from './contacts'

const tz = { withTimezone: true }

// A REGRA geradora do lançamento orçado — o "lote".
//
// ATENÇÃO: esta tabela é gerador + defaults. A fonte da verdade de qualquer
// número exibido é `budget_entries`. Nenhuma leitura consolidada recomputa
// a série; depois de "excluir somente este mês", `occurrences` passa a
// significar "o que a regra geraria", não "o que existe".
export const budgetSeries = pgTable(
  'budget_series',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => budgetVersions.id, { onDelete: 'cascade' }),

    description: text('description').notNull(),
    direction: text('direction').notNull(), // 'inflow' | 'outflow'

    // Categoria-folha obrigatória: a comparação faz INNER JOIN em categories
    // (igual à DRE), então orçado sem categoria sumiria em silêncio.
    // RESTRICT para que apagar categoria com orçado falhe de forma visível.
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id, { onDelete: 'set null' }),
    businessUnitId: uuid('business_unit_id').references(() => businessUnits.id, { onDelete: 'set null' }),
    legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),

    // ── Repetição ──
    // `date` (sempre dia 1), não texto 'YYYY-MM': duplicação de versão e
    // copiar-do-realizado fazem aritmética SQL de data.
    startMonth: date('start_month').notNull(),
    occurrences: integer('occurrences').notNull(),
    intervalMonths: integer('interval_months').notNull().default(1), // 1=mensal, 3=trimestral, 12=anual
    dayOfMonth: integer('day_of_month').notNull().default(1),        // clampado ao último dia do mês
    cashLagDays: integer('cash_lag_days').notNull().default(0),      // cashDate = competenceDate + lag

    // ── Valor ──
    // 'fixo' | 'reajuste' | 'sazonal' | 'parcelado'
    amountMode: text('amount_mode').notNull().default('fixo'),

    baseAmount: numeric('base_amount', { precision: 15, scale: 2 }),
    // Só 'parcelado'. Separado de baseAmount de propósito: depois de expandir,
    // não daria para saber se 1.200 era a parcela ou o total.
    totalAmount: numeric('total_amount', { precision: 15, scale: 2 }),

    // FRAÇÃO DECIMAL, não percentual: 0.05 = 5%. Negativo = redução programada.
    adjustmentRate: numeric('adjustment_rate', { precision: 7, scale: 4 }),
    // Conta OCORRÊNCIAS, não meses (com intervalMonths variável, meses seria ambíguo).
    adjustmentEvery: integer('adjustment_every').notNull().default(1),

    // Array de `occurrences` números EM ORDEM DE SEQUÊNCIA — não indexado por
    // mês do calendário (com intervalMonths > 1 não existem 12 slots).
    seasonalAmounts: jsonb('seasonal_amounts'),

    // 'manual' | 'copia_realizado' | 'csv' | 'recorrencia_detectada' | 'duplicacao'
    source: text('source').notNull().default('manual'),

    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    versionIdx: index('idx_budget_series_version').on(t.versionId),
    orgIdx: index('idx_budget_series_org').on(t.organizationId),
    categoryIdx: index('idx_budget_series_category').on(t.categoryId),
  })
)

export type BudgetSeries = typeof budgetSeries.$inferSelect
export type NewBudgetSeries = typeof budgetSeries.$inferInsert
