import { pgTable, uuid, text, numeric, integer, date, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { categories } from './categories'
import { transactions } from './transactions'

const tz = { withTimezone: true }

export const fixedAssets = pgTable('fixed_assets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  categoryId: uuid('category_id').references(() => categories.id),
  acquisitionDate: date('acquisition_date').notNull(),
  acquisitionValue: numeric('acquisition_value', { precision: 15, scale: 2 }).notNull(),
  currentValue: numeric('current_value', { precision: 15, scale: 2 }).notNull(),
  depreciationMethod: text('depreciation_method'),
  usefulLifeMonths: integer('useful_life_months'),
  monthlyDepreciation: numeric('monthly_depreciation', { precision: 15, scale: 2 }),
  // active | sold | written_off | disposed
  status: text('status').notNull().default('active'),
  disposedAt: date('disposed_at'),
  disposalValue: numeric('disposal_value', { precision: 15, scale: 2 }),
  transactionId: uuid('transaction_id').references(() => transactions.id),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
})

export type FixedAsset = typeof fixedAssets.$inferSelect
export type NewFixedAsset = typeof fixedAssets.$inferInsert
