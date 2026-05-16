import { pgTable, uuid, text, numeric, date, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { categories } from './categories'

const tz = { withTimezone: true }

export const equityMovements = pgTable('equity_movements', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  // capital_contribution | capital_withdrawal | profit_distribution | reserve_transfer | other
  type: text('type').notNull(),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  // inflow (aumento de PL) | outflow (redução de PL)
  direction: text('direction').notNull(),
  date: date('date').notNull(),
  description: text('description').notNull(),
  categoryId: uuid('category_id').references(() => categories.id),
  // FK pra transactions adicionada na sessão 1.4
  transactionId: uuid('transaction_id'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
})

export type EquityMovement = typeof equityMovements.$inferSelect
export type NewEquityMovement = typeof equityMovements.$inferInsert
