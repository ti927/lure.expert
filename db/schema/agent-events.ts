import { pgTable, uuid, text, integer, numeric, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'

const tz = { withTimezone: true }

export const agentEvents = pgTable(
  'agent_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // categorization | anomaly_detection | narrative_generation | recategorization_proposal |
    // recategorization_confirmed | recategorization_applied | fact_suggested | fact_confirmed | etc.
    type: text('type').notNull(),
    // transaction | document | conversation | organization_fact | etc.
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    // detalhes do evento: input, output, decisão, proposed_change, confirmed_at, applied_at
    payload: jsonb('payload').notNull(),
    modelUsed: text('model_used'),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    // custo calculado em USD — base para análise interna de custo por cliente
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    durationMs: integer('duration_ms'),
    success: boolean('success').notNull().default(true),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    orgTimeIdx: index('idx_agent_events_org_time').on(t.organizationId, t.createdAt),
    entityIdx: index('idx_agent_events_entity').on(t.entityType, t.entityId),
    typeIdx: index('idx_agent_events_type').on(t.organizationId, t.type, t.createdAt),
  })
)

export type AgentEvent = typeof agentEvents.$inferSelect
export type NewAgentEvent = typeof agentEvents.$inferInsert
