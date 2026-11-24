import { pgTable, uuid, text, integer, numeric, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { categories } from './categories'
import { contacts } from './contacts'

const tz = { withTimezone: true }

// Análise de fornecedores (migration 0037). O fornecedor NÃO é FK: é uma chave de
// texto calculada na leitura por lib/fornecedores.ts ('C:<contato>', 'G:<grupo>',
// 'J:<cnpj>', 'D:<descrição normalizada>'), porque metade do valor de uma base
// importada não tem contato e a mesa precisa negociar com esses também.

/** A mesa de negociação: um fornecedor marcado, com a redução combinada. */
export const supplierNegotiations = pgTable(
  'supplier_negotiations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    chave: text('chave').notNull(),
    /** O nome como estava ao marcar. */
    rotulo: text('rotulo').notNull(),
    /** 'pct' (percentual sobre o gasto mensal) | 'valor' (reais a menos por mês). */
    tipo: text('tipo').notNull().default('pct'),
    reducao: numeric('reducao', { precision: 15, scale: 2 }).notNull().default('0'),
    nota: text('nota').notNull().default(''),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    orgChave: uniqueIndex('supplier_negotiations_org_chave_unq').on(t.organizationId, t.chave),
  }),
)

/** "Descrição contém X" (e, opcionalmente, natureza pai / contato) → um fornecedor só. */
export const supplierGroupings = pgTable(
  'supplier_groupings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    /** Trecho procurado na descrição normalizada (minúsculas, sem acento, só letras). */
    padrao: text('padrao').notNull(),
    naturezaPaiId: uuid('natureza_pai_id').references(() => categories.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    /** Casa mesmo quando o lançamento já tem contato. */
    sobrepoeContato: boolean('sobrepoe_contato').notNull().default(false),
    ordem: integer('ordem').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    orgOrdem: index('idx_supplier_groupings_org').on(t.organizationId, t.ordem),
  }),
)

export type SupplierNegotiation = typeof supplierNegotiations.$inferSelect
export type SupplierGrouping = typeof supplierGroupings.$inferSelect
