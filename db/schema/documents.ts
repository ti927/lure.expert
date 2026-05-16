import { pgTable, uuid, text, bigint, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { dataSources } from './data-sources'
import { templates } from './templates'

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
  templateId: uuid('template_id').references(() => templates.id),
  uploadedByUserId: uuid('uploaded_by_user_id'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  // sem updated_at por design: documentos não são alterados após upload
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
})

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
