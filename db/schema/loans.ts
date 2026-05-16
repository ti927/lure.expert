import { pgTable, uuid, text, numeric, integer, date, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { categories } from './categories'

const tz = { withTimezone: true }

export const loans = pgTable('loans', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  lender: text('lender').notNull(),
  // working_capital | investment | payroll | partner_loan | other
  type: text('type').notNull(),
  originalAmount: numeric('original_amount', { precision: 15, scale: 2 }).notNull(),
  currentBalance: numeric('current_balance', { precision: 15, scale: 2 }).notNull(),
  // taxa anual: 0.1850 = 18,50% a.a.
  interestRateAnnual: numeric('interest_rate_annual', { precision: 8, scale: 4 }),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  installmentAmount: numeric('installment_amount', { precision: 15, scale: 2 }),
  installmentCountTotal: integer('installment_count_total'),
  installmentCountPaid: integer('installment_count_paid').notNull().default(0),
  // active | paid_off | in_default | renegotiated
  status: text('status').notNull().default('active'),
  categoryId: uuid('category_id').references(() => categories.id),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
})

export type Loan = typeof loans.$inferSelect
export type NewLoan = typeof loans.$inferInsert
