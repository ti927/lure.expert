import { pgTable, uuid, text, numeric, date, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { legalEntities } from './legal-entities'
import { sefazConnections } from './sefaz-connections'
import { contacts } from './contacts'

const tz = { withTimezone: true }

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    sefazConnectionId: uuid('sefaz_connection_id')
      .notNull()
      .references(() => sefazConnections.id),

    // Identificação SEFAZ
    chaveAcesso: text('chave_acesso').notNull(),  // chNFe, 44 dígitos
    numeroNf: text('numero_nf'),
    serie: text('serie'),

    // Direção da NF em relação à empresa monitorada
    tipo: text('tipo').notNull(),  // 'saida' | 'entrada'

    // Emitente
    emitenteCnpj: text('emitente_cnpj').notNull(),
    emitenteNome: text('emitente_nome'),

    // Destinatário
    destinatarioCnpj: text('destinatario_cnpj'),
    destinatarioNome: text('destinatario_nome'),

    // Contato casado (emitente ou destinatário, dependendo do tipo)
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),

    // Datas
    dataEmissao: date('data_emissao').notNull(),   // competência → alimenta DRE quando casada
    dataSaidaEntrada: date('data_saida_entrada'),

    // Valores
    totalNf: numeric('total_nf', { precision: 15, scale: 2 }).notNull(),
    totalImpostos: numeric('total_impostos', { precision: 15, scale: 2 }),

    // 'nova' → chegou do SEFAZ
    // 'manifestada' → Ciência da Operação emitida
    // 'cancelada' → NF cancelada no SEFAZ
    // 'denegada' → NF denegada
    // 'casada' → reconciliada com uma transaction
    // 'pendente_revisao' → score 0.50–0.84, aguarda confirmação manual
    status: text('status').notNull().default('nova'),

    // Reconciliação com transactions
    // FK para transactions — criado via migration (referência circular entre tabelas)
    transactionId: uuid('transaction_id'),
    reconciliationScore: numeric('reconciliation_score', { precision: 3, scale: 2 }),

    // XML completo da NF (para extração de itens, CFOP, etc.)
    xmlContent: text('xml_content'),

    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    // Deduplicação por chave de acesso dentro da org
    orgChaveUniq: uniqueIndex('invoices_org_chave_acesso_uniq').on(t.organizationId, t.chaveAcesso),
  })
)

export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
