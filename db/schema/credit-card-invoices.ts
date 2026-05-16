import { pgTable, uuid, text, numeric, date, jsonb, timestamp, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { dataSources } from './data-sources'
import { documents } from './documents'
import { transactions } from './transactions'

const tz = { withTimezone: true }

export const creditCardInvoices = pgTable(
  'credit_card_invoices',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    dataSourceId: uuid('data_source_id')
      .notNull()
      .references(() => dataSources.id),
    // formato "YYYY-MM": uma fatura por cartão por mês
    referenceMonth: text('reference_month').notNull(),
    closingDate: date('closing_date'),
    dueDate: date('due_date'),
    totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull(),
    // open | paid | overdue | disputed
    status: text('status').notNull().default('open'),
    paidByTransactionId: uuid('paid_by_transaction_id').references(() => transactions.id),
    paidAt: date('paid_at'),
    documentId: uuid('document_id').references(() => documents.id),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    uniqueSourceMonth: unique('cc_invoices_source_month_unique').on(t.dataSourceId, t.referenceMonth),
  })
)

export type CreditCardInvoice = typeof creditCardInvoices.$inferSelect
export type NewCreditCardInvoice = typeof creditCardInvoices.$inferInsert
