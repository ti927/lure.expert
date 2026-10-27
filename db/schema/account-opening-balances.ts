import { pgTable, uuid, text, numeric, date, timestamp, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'

const tz = { withTimezone: true }

/**
 * O saldo inicial de cada conta, para a conferência de saldo (migration 0034,
 * Decisão 29). Uma linha por conta.
 *
 * `accountId` é `transactions.account_id` — texto e sem FK, como as colunas de
 * conta do lançamento. `balanceDate` é o saldo no INÍCIO do dia (a linha "saldo
 * anterior" do extrato).
 */
export const accountOpeningBalances = pgTable(
  'account_opening_balances',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    balanceDate: date('balance_date').notNull(),
    /** Pode ser negativo (cheque especial). */
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    informedByUserId: uuid('informed_by_user_id'),
    note: text('note'),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    porConta: unique('account_opening_balances_unq').on(t.organizationId, t.accountId),
  }),
)

export type AccountOpeningBalance = typeof accountOpeningBalances.$inferSelect
