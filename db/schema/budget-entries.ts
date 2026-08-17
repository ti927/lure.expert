import { pgTable, uuid, text, integer, numeric, date, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { budgetVersions } from './budget-versions'
import { budgetSeries } from './budget-series'
import { categories } from './categories'
import { costCenters } from './cost-centers'
import { businessUnits } from './business-units'
import { legalEntities } from './legal-entities'
import { contacts } from './contacts'

const tz = { withTimezone: true }

// As OCORRÊNCIAS materializadas — uma linha por mês.
//
// INVARIANTE: esta é a única fonte de verdade para qualquer número exibido.
// `budgetSeries` é gerador + defaults.
//
// Convenção de sinal: `amount` é SEMPRE positivo; o sinal vem de `direction`
// (idêntico a `transactions`). Convenção de data: `competenceDate` alimenta a
// DRE Orçada, `cashDate` alimenta o Fluxo Projetado — espelha date vs
// effective_date, com a diferença de que aqui `cashDate` é NOT NULL, logo
// nenhuma query de caixa do orçado precisa de COALESCE.
export const budgetEntries = pgTable(
  'budget_entries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => budgetVersions.id, { onDelete: 'cascade' }),

    // NOT NULL por decisão: lançamento avulso = série com occurrences = 1.
    // Um caminho de código só para editar/excluir/expandir.
    seriesId: uuid('series_id')
      .notNull()
      .references(() => budgetSeries.id, { onDelete: 'cascade' }),

    // Índice da ocorrência dentro da série (1..N). NUNCA renumerado: após
    // "excluir somente este mês" ficam buracos, e buracos são válidos.
    sequence: integer('sequence').notNull(),

    // Copiados da série na expansão, mas EDITÁVEIS aqui: a entry é o fato
    // agregado (a comparação não faz join de volta na série) e o override por
    // ocorrência precisa de um lugar de onde divergir.
    description: text('description').notNull(),
    direction: text('direction').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id, { onDelete: 'set null' }),
    businessUnitId: uuid('business_unit_id').references(() => businessUnits.id, { onDelete: 'set null' }),
    legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),

    competenceDate: date('competence_date').notNull(),
    cashDate: date('cash_date').notNull(),

    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),

    // Campos editados à mão nesta ocorrência (ex: ['amount', 'cost_center_id']).
    // Substitui um booleano `is_adjusted`: com granularidade de campo, alterar
    // centro de custo em lote não precisa pular uma ocorrência cujo único ajuste
    // foi de valor. Auto-cura: se o valor volta a coincidir com o que a série
    // geraria, o campo sai do array.
    adjustedFields: text('adjusted_fields').array().notNull().default(sql`'{}'::text[]`),

    notes: text('notes'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    // Rede de segurança contra duplo clique / regeneração concorrente
    seriesSequenceUniq: uniqueIndex('budget_entries_series_sequence_uniq').on(t.seriesId, t.sequence),
    versionCompetenceIdx: index('idx_budget_entries_version_competence').on(t.versionId, t.competenceDate),
    versionCashIdx: index('idx_budget_entries_version_cash').on(t.versionId, t.cashDate),
    versionCategoryIdx: index('idx_budget_entries_version_category').on(t.versionId, t.categoryId),
    orgIdx: index('idx_budget_entries_org').on(t.organizationId),
    adjustedIdx: index('idx_budget_entries_adjusted')
      .on(t.versionId)
      .where(sql`cardinality(${t.adjustedFields}) > 0`),
  })
)

export type BudgetEntry = typeof budgetEntries.$inferSelect
export type NewBudgetEntry = typeof budgetEntries.$inferInsert
