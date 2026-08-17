import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'

const tz = { withTimezone: true }

// Um exercício orçado (ano civil) numa versão nomeada.
// Duplicar versão atende tanto revisão ("Revisão Jul/27") quanto cenário
// ("Cenário Pessimista") — um mecanismo só.
export const budgetVersions = pgTable(
  'budget_versions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),

    // 'rascunho' | 'aprovado' | 'arquivado'
    // Arquivada é read-only na server action, não no banco (reversível).
    status: text('status').notNull().default('rascunho'),

    // A versão vigente do exercício — no máximo uma por (org, ano),
    // garantido por índice único parcial.
    isActive: boolean('is_active').notNull().default(false),

    description: text('description'),

    // Preenchido quando a versão nasceu de uma duplicação.
    sourceVersionId: uuid('source_version_id')
      .references((): AnyPgColumn => budgetVersions.id, { onDelete: 'set null' }),

    // Auditoria mínima — aponta para auth.users, sem FK (padrão de memberships.userId)
    createdByUserId: uuid('created_by_user_id'),
    approvedByUserId: uuid('approved_by_user_id'),
    approvedAt: timestamp('approved_at', tz),
    archivedAt: timestamp('archived_at', tz),

    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    // Nome único por exercício, case-insensitive (índice em lower(btrim(name)) no SQL)
    orgYearNameUniq: uniqueIndex('budget_versions_org_year_name_uniq')
      .on(t.organizationId, t.fiscalYear, sql`lower(btrim(${t.name}))`),
    // No máximo uma vigente por exercício
    orgYearActiveUniq: uniqueIndex('budget_versions_org_year_active_uniq')
      .on(t.organizationId, t.fiscalYear)
      .where(sql`${t.isActive}`),
    orgYearIdx: index('idx_budget_versions_org_year').on(t.organizationId, t.fiscalYear),
  })
)

export type BudgetVersion = typeof budgetVersions.$inferSelect
export type NewBudgetVersion = typeof budgetVersions.$inferInsert
