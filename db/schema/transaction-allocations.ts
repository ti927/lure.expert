import { pgTable, uuid, text, integer, numeric, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { transactions } from './transactions'
import { costCenters } from './cost-centers'
import { businessUnits } from './business-units'
import { legalEntities } from './legal-entities'
import { contacts } from './contacts'
import { allocationTemplates } from './allocation-templates'

const tz = { withTimezone: true }

/**
 * Rateio de um lançamento entre dimensões, no modelo de sub-lançamentos: cada
 * linha tem valor próprio e carrega o conjunto completo de dimensões.
 *
 * A soma das partes é EXATAMENTE `transactions.amount` — garantido por
 * `CONSTRAINT TRIGGER ... DEFERRABLE` na migration 0026, não por CHECK: a soma
 * é propriedade do conjunto, e o diferimento até o commit é o que permite
 * inserir as partes uma a uma. Quando há partes, as colunas de dimensão do
 * lançamento pai ficam nulas, e o mesmo gatilho recusa o contrário.
 *
 * Sem `categoryId` de propósito: a natureza não se parte (ver Decisão 16).
 */
export const transactionAllocations = pgTable(
  'transaction_allocations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    // Ordem de exibição dentro do lançamento.
    sequence: integer('sequence').notNull().default(1),
    // SEMPRE positivo — o sinal vem da direction do lançamento pai.
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id, { onDelete: 'set null' }),
    businessUnitId: uuid('business_unit_id').references(() => businessUnits.id, { onDelete: 'set null' }),
    legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    // De qual modelo esta parte nasceu (migration 0027). Só é gravado quando o
    // rateio veio de um modelo E não foi editado depois — a contagem de uso
    // precisa contar a menos, nunca a mais. `set null`: apagar o modelo não
    // desfaz rateio nenhum, só remove a etiqueta.
    allocationTemplateId: uuid('allocation_template_id')
      .references(() => allocationTemplates.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    // Acesso dominante: todas as partes de um lançamento.
    transactionIdx: index('idx_alloc_transaction').on(t.transactionId),
    orgIdx: index('idx_alloc_org').on(t.organizationId),
    // Um por dimensão — é por eles que a 10.3 filtra e agrupa pela view.
    orgCostCenterIdx: index('idx_alloc_org_cost_center').on(t.organizationId, t.costCenterId),
    orgBusinessUnitIdx: index('idx_alloc_org_business_unit').on(t.organizationId, t.businessUnitId),
    orgLegalEntityIdx: index('idx_alloc_org_legal_entity').on(t.organizationId, t.legalEntityId),
    orgContactIdx: index('idx_alloc_org_contact').on(t.organizationId, t.contactId),
  })
)

export type TransactionAllocation = typeof transactionAllocations.$inferSelect
export type NewTransactionAllocation = typeof transactionAllocations.$inferInsert
