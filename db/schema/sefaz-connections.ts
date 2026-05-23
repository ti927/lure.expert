import { pgTable, uuid, text, boolean, date, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { legalEntities } from './legal-entities'

const tz = { withTimezone: true }

export const sefazConnections = pgTable(
  'sefaz_connections',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id, { onDelete: 'cascade' }),

    // CNPJ monitorado (14 dígitos, sem máscara)
    cnpj: text('cnpj').notNull(),

    // Provedor SEFAZ: 'focus_nfe' | 'nfeio' | 'tecnospeed' | 'abstract' (stub de desenvolvimento)
    provider: text('provider').notNull().default('abstract'),

    // ID da empresa registrada no dashboard do provedor
    providerCompanyId: text('provider_company_id'),

    // API key do provedor — cifrada em repouso (mesmo padrão de data_sources.credentials_encrypted)
    apiKeyEncrypted: text('api_key_encrypted'),

    // Validade do certificado A1 (para alerta proativo antes de expirar)
    certificateExpiry: date('certificate_expiry'),

    // Ambiente do provedor
    environment: text('environment').notNull().default('producao'), // 'producao' | 'homologacao'

    // O que puxar
    pullSaida: boolean('pull_saida').notNull().default(true),
    pullEntrada: boolean('pull_entrada').notNull().default(true),

    // Manifestação automática "Ciência da Operação" para NF-e de entrada
    autoManifest: boolean('auto_manifest').notNull().default(true),

    // 'pending' = aguardando primeiro sync com data de corte (awaitingFirstSync no metadata)
    // 'active' = sincronizando normalmente
    // 'error' = último sync falhou
    // 'expired' = certificado expirado
    status: text('status').notNull().default('pending'),

    lastSyncAt: timestamp('last_sync_at', tz),
    lastSyncStatus: text('last_sync_status'),
    lastSyncError: text('last_sync_error'),

    // { awaitingFirstSync?: true, fromDate?: string, lastNfeKey?: string }
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    // Uma connection por CNPJ por organização
    orgCnpjUniq: uniqueIndex('sefaz_connections_org_cnpj_uniq').on(t.organizationId, t.cnpj),
  })
)

export type SefazConnection = typeof sefazConnections.$inferSelect
export type NewSefazConnection = typeof sefazConnections.$inferInsert
