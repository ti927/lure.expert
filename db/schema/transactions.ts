import {
  pgTable, uuid, text, numeric, boolean, jsonb,
  timestamp, date, index, uniqueIndex, customType,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { dataSources } from './data-sources'
import { contacts } from './contacts'
import { categories } from './categories'
import { documents } from './documents'
import { costCenters } from './cost-centers'
import { businessUnits } from './business-units'
import { legalEntities } from './legal-entities'
// FK para creditCardInvoices omitida aqui para evitar referência circular
// A constraint real existe no banco via SQL migration (0004)

const tz = { withTimezone: true }

// tipo customizado para pgvector — embedding(1536)
const vector = customType<{ data: number[] }>({
  dataType() {
    return 'vector(1536)'
  },
  toDriver(value: number[]) {
    return `[${value.join(',')}]`
  },
  fromDriver(value: unknown) {
    return (value as string).slice(1, -1).split(',').map(Number)
  },
})

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    dataSourceId: uuid('data_source_id')
      .notNull()
      .references(() => dataSources.id),
    // ID da origem para deduplicação (quando a fonte fornece)
    externalId: text('external_id'),
    // data de competência (quando aconteceu economicamente)
    date: date('date').notNull(),
    // data caixa (quando entrou/saiu de fato)
    effectiveDate: date('effective_date'),
    // amount SEMPRE positivo — o sinal vem de direction
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('BRL'),
    // inflow | outflow
    direction: text('direction').notNull(),
    description: text('description').notNull(),
    cleanedDescription: text('cleaned_description'),
    contactId: uuid('contact_id').references(() => contacts.id),
    categoryId: uuid('category_id').references(() => categories.id),
    // 0.00 a 1.00
    categorizationConfidence: numeric('categorization_confidence', { precision: 3, scale: 2 }),
    // rule | recurrence | embedding | llm | manual
    categorizationMethod: text('categorization_method'),
    needsReview: boolean('needs_review').notNull().default(false),
    // confirmed | pending | ignored | duplicate
    status: text('status').notNull().default('confirmed'),
    documentId: uuid('document_id').references(() => documents.id),
    creditCardInvoiceId: uuid('credit_card_invoice_id'),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id, { onDelete: 'set null' }),
    businessUnitId: uuid('business_unit_id').references(() => businessUnits.id, { onDelete: 'set null' }),
    legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id, { onDelete: 'set null' }),
    // Conta bancária / cartão de origem (Pluggy) — colunas próprias para indexação e filtragem
    accountId:     text('account_id'),
    accountNumber: text('account_number'),
    accountType:   text('account_type'),   // subtipo: CHECKING_ACCOUNT | CREDIT_CARD | SAVINGS_ACCOUNT
    accountName:   text('account_name'),
    // FK para a transação canônica (Pluggy) quando esta é marcada como duplicata de upload
    duplicateOf: uuid('duplicate_of').references((): AnyPgColumn => transactions.id, { onDelete: 'set null' }),
    rawData: jsonb('raw_data').notNull().default(sql`'{}'::jsonb`),
    // populado assincronamente após insert, não bloqueia a operação
    embedding: vector('embedding'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    // query principal: transações por organização e período
    orgDateIdx: index('idx_tx_org_date').on(t.organizationId, t.date),
    // DRE: agregações por categoria
    orgCategoryIdx: index('idx_tx_org_category').on(t.organizationId, t.categoryId),
    // relatório de fornecedor/cliente
    orgContactIdx: index('idx_tx_org_contact').on(t.organizationId, t.contactId),
    // fila de revisão: partial index — só linhas que precisam de atenção
    needsReviewIdx: index('idx_tx_org_needs_review')
      .on(t.organizationId, t.needsReview)
      .where(sql`${t.needsReview} = true`),
    // deduplicação: mesmo external_id na mesma fonte
    dedupIdx: uniqueIndex('idx_tx_dedup')
      .on(t.dataSourceId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    // HNSW para busca por embedding — criado via SQL (não suportado no Drizzle ainda)
  })
)

export type Transaction = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert
