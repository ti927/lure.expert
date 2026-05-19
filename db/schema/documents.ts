import { pgTable, uuid, text, bigint, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { dataSources } from './data-sources'
// FK para templates omitida aqui para evitar referência circular
// A constraint real existe no banco via SQL migration (0004)

const tz = { withTimezone: true }

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  dataSourceId: uuid('data_source_id').references(() => dataSources.id),
  // invoice | statement | report | receipt | contract | other
  type: text('type').notNull(),
  filename: text('filename').notNull(),
  storagePath: text('storage_path').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  // pending | processing | completed | failed
  extractionStatus: text('extraction_status').notNull().default('pending'),
  // template | llm | manual
  extractionMethod: text('extraction_method'),
  extractedData: jsonb('extracted_data'),
  templateId: uuid('template_id'),
  uploadedByUserId: uuid('uploaded_by_user_id'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  // 'income_statement' | 'balance_sheet' | 'other'
  reportType: text('report_type').notNull().default('other'),
  // Data de referência do snapshot de BP (YYYY-MM-DD); null para não-BP
  referenceDate: text('reference_date'),
  // sem updated_at por design: documentos não são alterados após upload
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
})

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
