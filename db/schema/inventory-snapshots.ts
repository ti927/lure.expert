import { pgTable, uuid, text, numeric, date, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'

const tz = { withTimezone: true }

export const inventorySnapshots = pgTable('inventory_snapshots', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  snapshotDate: date('snapshot_date').notNull(),
  totalValue: numeric('total_value', { precision: 15, scale: 2 }).notNull(),
  notes: text('notes'),
  // lista de itens opcionais: [{ name, qty, unit_value }]
  items: jsonb('items'),
  createdByUserId: uuid('created_by_user_id'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  // sem updated_at por design: snapshots são imutáveis; corrija inserindo novo snapshot
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
})

export type InventorySnapshot = typeof inventorySnapshots.$inferSelect
export type NewInventorySnapshot = typeof inventorySnapshots.$inferInsert
