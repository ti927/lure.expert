import { pgTable, uuid, text, integer, numeric, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { documents } from './documents'

const tz = { withTimezone: true }

export const templates = pgTable('templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  // NULL = template global compartilhado (curado pela Lure)
  organizationId: uuid('organization_id').references(() => organizations.id, {
    onDelete: 'cascade',
  }),
  // "erp_omie_ap", "bank_itau_statement", etc.
  sourceType: text('source_type').notNull(),
  name: text('name').notNull(),
  // definição do parser: colunas, regex, formato de data, separador decimal
  structure: jsonb('structure').notNull(),
  sampleDocumentId: uuid('sample_document_id').references(() => documents.id),
  createdByUserId: uuid('created_by_user_id'),
  successCount: integer('success_count').notNull().default(0),
  failureCount: integer('failure_count').notNull().default(0),
  // confiança calculada: success / (success + failure)
  confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull().default('1.00'),
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
})

export type Template = typeof templates.$inferSelect
export type NewTemplate = typeof templates.$inferInsert
