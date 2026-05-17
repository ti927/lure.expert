import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'

const tz = { withTimezone: true }

export const businessUnits = pgTable('business_units', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
})

export type BusinessUnit = typeof businessUnits.$inferSelect
export type NewBusinessUnit = typeof businessUnits.$inferInsert
