import { pgTable, uuid, text, numeric, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'

const tz = { withTimezone: true }

/**
 * Chave de IA, teto e alerta por organização (migration 0029).
 *
 * Tabela própria e não `organizations.settings`: aquele JSONB é lido e devolvido
 * inteiro em vários caminhos, e guardar segredo ali é convidar o vazamento por
 * um `SELECT *` distraído.
 *
 * `apiKeyEncrypted` é AES-256-GCM (`src/lib/crypto.ts`), não base64 — a chave
 * precisa VOLTAR ao texto claro para ser usada, o que é diferente de token de
 * acesso, onde hash bastaria.
 */
export const organizationAiSettings = pgTable('organization_ai_settings', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),

  /** 'own' = chave da organização · 'platform' = chave da Lure, por exceção. */
  keySource: text('key_source').notNull().default('own'),

  apiKeyEncrypted: text('api_key_encrypted'),
  /** Único fragmento que pode aparecer em tela, log ou resposta. */
  apiKeyLast4: text('api_key_last4'),
  apiKeyValidatedAt: timestamp('api_key_validated_at', tz),
  apiKeyError: text('api_key_error'),

  /** Teto mensal em dólar. Nulo = sem teto. */
  monthlyLimitUsd: numeric('monthly_limit_usd', { precision: 10, scale: 2 }),
  alertThreshold: numeric('alert_threshold', { precision: 5, scale: 2 }).notNull().default('80'),
  /** Mês em que o aviso já foi enviado, para não repetir a cada job. */
  alertedMonth: text('alerted_month'),

  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
})

export type OrganizationAiSettings = typeof organizationAiSettings.$inferSelect
export type NewOrganizationAiSettings = typeof organizationAiSettings.$inferInsert
