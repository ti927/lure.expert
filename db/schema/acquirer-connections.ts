import { pgTable, uuid, text, numeric, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { legalEntities } from './legal-entities'

const tz = { withTimezone: true }

export const acquirerConnections = pgTable(
  'acquirer_connections',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    legalEntityId: uuid('legal_entity_id')
      .references(() => legalEntities.id, { onDelete: 'set null' }),

    // Provedor: 'stone' | 'cielo' | 'rede' | 'pagbank' | 'abstract' (stub de dev)
    provider: text('provider').notNull().default('abstract'),

    // Identificador do estabelecimento no provedor (Stone: stone_code, Cielo: merchant_id, etc.)
    merchantId: text('merchant_id').notNull(),

    // Credenciais cifradas em repouso (mesmo padrão de sefaz_connections.api_key_encrypted)
    apiKeyEncrypted: text('api_key_encrypted'),
    apiSecretEncrypted: text('api_secret_encrypted'),

    // Ambiente do provedor
    environment: text('environment').notNull().default('producao'), // 'producao' | 'sandbox'

    // Nome amigável exibido na UI (ex: "Stone Loja Centro")
    displayName: text('display_name'),

    // Taxa MDR média configurada — para cálculo de reconciliação lote × vendas
    mdrRate: numeric('mdr_rate', { precision: 5, scale: 4 }),

    // 'pending' = aguardando primeiro sync | 'active' = ok | 'error' = falha | 'inactive' = desativado
    status: text('status').notNull().default('pending'),

    lastSyncAt: timestamp('last_sync_at', tz),
    lastSyncStatus: text('last_sync_status'),
    lastSyncError: text('last_sync_error'),

    // { awaitingFirstSync?: true, fromDate?: string, lastFetchedAt?: string, monthlyVolume?: number }
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    // Um merchantId por provedor por organização
    orgProviderMerchantUniq: uniqueIndex('acquirer_connections_org_provider_merchant_uniq').on(
      t.organizationId,
      t.provider,
      t.merchantId,
    ),
  })
)

export type AcquirerConnection = typeof acquirerConnections.$inferSelect
export type NewAcquirerConnection = typeof acquirerConnections.$inferInsert
