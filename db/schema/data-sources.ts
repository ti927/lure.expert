import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'

const tz = { withTimezone: true }

export const dataSources = pgTable('data_sources', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  name: text('name').notNull(),
  // externalItemId: chave do recurso no provedor (ex: itemId do Pluggy). Único por provider.
  externalItemId: text('external_item_id'),
  // credentialsEncrypted: bytea cifrado, armazenado como base64 — nunca expor ao cliente
  credentialsEncrypted: text('credentials_encrypted'),
  lastSyncAt: timestamp('last_sync_at', tz),
  lastSyncStatus: text('last_sync_status'),
  lastSyncError: text('last_sync_error'),
  status: text('status').notNull().default('active'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
})

export type DataSource = typeof dataSources.$inferSelect
export type NewDataSource = typeof dataSources.$inferInsert
