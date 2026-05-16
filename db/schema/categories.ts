import { pgTable, uuid, text, boolean, jsonb, timestamp, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { organizations } from './organizations'

const tz = { withTimezone: true }

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    // revenue | cost | expense | asset | liability | equity | transfer
    type: text('type').notNull(),
    // self-referência: AnyPgColumn evita erro de referência circular
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'restrict',
    }),
    isActive: boolean('is_active').notNull().default(true),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    uniqueOrgCode: unique('categories_org_code_unique').on(t.organizationId, t.code),
  })
)

export type Category = typeof categories.$inferSelect
export type NewCategory = typeof categories.$inferInsert
