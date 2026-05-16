import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'

const tz = { withTimezone: true }

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    tradeName: text('trade_name'),
    document: text('document'),
    documentType: text('document_type'),
    email: text('email'),
    phone: text('phone'),
    cnaeCode: text('cnae_code'),
    cnaeDescription: text('cnae_description'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    // índice único no par (org, document) — apenas quando document não é nulo
    uniqueOrgDocument: uniqueIndex('contacts_org_document_unique')
      .on(t.organizationId, t.document)
      .where(sql`${t.document} IS NOT NULL`),
  })
)

export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
