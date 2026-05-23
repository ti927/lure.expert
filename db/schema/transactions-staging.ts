import { pgTable, uuid, text, numeric, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { documents } from './documents'

const tz = { withTimezone: true }

export const transactionsStaging = pgTable(
  'transactions_staging',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    rowIndex: integer('row_index').notNull(),
    rawData: jsonb('raw_data').notNull().default(sql`'{}'::jsonb`),
    // campos mapeados pela heurística de colunas (nullable — mapeamento pode ser parcial)
    date: text('date'),
    effectiveDate: text('effective_date'),
    amount: numeric('amount', { precision: 15, scale: 2 }),
    // inflow | outflow
    direction: text('direction'),
    description: text('description'),
    // pending | approved | rejected
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    orgDocIdx: index('idx_staging_org_doc').on(t.organizationId, t.documentId),
  }),
)

export type TransactionStaging = typeof transactionsStaging.$inferSelect
export type NewTransactionStaging = typeof transactionsStaging.$inferInsert
