import { pgTable, uuid, text, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { conversations } from './conversations'
import { messages } from './messages'

const tz = { withTimezone: true }

export const organizationFacts = pgTable(
  'organization_facts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // person | process | preference | context | other
    type: text('type').notNull(),
    // rótulo curto: "responsável pelo comercial"
    key: text('key').notNull(),
    // conteúdo: "Pedro Silva cuida de toda a área comercial"
    value: text('value').notNull(),
    sourceConversationId: uuid('source_conversation_id').references(() => conversations.id),
    sourceMessageId: uuid('source_message_id').references(() => messages.id),
    // false = inserido diretamente pelo usuário; true = detectado pelo expert
    suggestedByExpert: boolean('suggested_by_expert').notNull().default(true),
    confirmedByUserId: uuid('confirmed_by_user_id'),
    // fatos sem confirmed_at são propostas pendentes — não entram no system prompt
    confirmedAt: timestamp('confirmed_at', tz),
    // soft delete
    archivedAt: timestamp('archived_at', tz),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    activeFacts: index('idx_org_facts_active')
      .on(t.organizationId, t.archivedAt)
      .where(sql`${t.archivedAt} IS NULL`),
    typeIdx: index('idx_org_facts_type').on(t.organizationId, t.type),
  })
)

export type OrganizationFact = typeof organizationFacts.$inferSelect
export type NewOrganizationFact = typeof organizationFacts.$inferInsert
