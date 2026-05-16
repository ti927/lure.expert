import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const tz = { withTimezone: true }

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  cnpj: text('cnpj').unique(),
  slug: text('slug').notNull().unique(),
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  subscriptionStatus: text('subscription_status').notNull().default('trial'),
  trialEndsAt: timestamp('trial_ends_at', tz),
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
})

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
