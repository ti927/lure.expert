import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { conversations } from './conversations'

const tz = { withTimezone: true }

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    // user | assistant | tool
    role: text('role').notNull(),
    content: text('content').notNull(),
    // tools chamadas pelo expert nesta mensagem
    toolCalls: jsonb('tool_calls'),
    // resultados das tools (quando role = 'tool')
    toolResults: jsonb('tool_results'),
    modelUsed: text('model_used'),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    conversationIdx: index('idx_messages_conversation').on(t.conversationId, t.createdAt),
  })
)

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
