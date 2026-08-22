import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
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
    // Derivado de is_customer/is_supplier na escrita — mantido porque
    // `docs/SCHEMA_INICIAL.md` o define assim. O papel de verdade são os
    // booleanos abaixo: um contato pode ser cliente E fornecedor.
    type: text('type').notNull().default('other'),
    isCustomer: boolean('is_customer').notNull().default(false),
    isSupplier: boolean('is_supplier').notNull().default(false),
    name: text('name').notNull(),
    // Código curto opcional, como nas outras três dimensões (o import de CSV
    // casa por código antes de cair para documento e nome).
    code: text('code'),
    isActive: boolean('is_active').notNull().default(true),
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
    orgActiveIdx: index('idx_contacts_org_active').on(t.organizationId, t.isActive),
  })
)

export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
