import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'

const tz = { withTimezone: true }

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    // gerado automaticamente a partir da primeira mensagem
    title: text('title'),
    // soft delete
    archivedAt: timestamp('archived_at', tz),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    // atualizado a cada mensagem nova
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    orgUserIdx: index('idx_conversations_org_user').on(
      t.organizationId,
      t.userId,
      t.updatedAt
    ),
  })
)

export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
