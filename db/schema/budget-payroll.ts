import { pgTable, uuid, text, integer, numeric, boolean, jsonb, timestamp, index, primaryKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { budgetVersions } from './budget-versions'
import { categories } from './categories'
import { costCenters } from './cost-centers'
import { businessUnits } from './business-units'
import { legalEntities } from './legal-entities'
import { contacts } from './contacts'

const tz = { withTimezone: true }

// Folha de pagamento no orçamento (migration 0036). O QUADRO de pessoal gera
// `budget_series` com source = 'folha'; estas tabelas são a entrada, não o
// resultado — o orçado continua lido de `budget_entries`.
//
// Alíquotas e percentuais de reajuste são FRAÇÃO (0.05 = 5%). Só
// `budget_people_allocations.percentual` é 0–100, e a soma = 100 é validada na
// escrita, não no banco.

/** Uma por versão de orçamento. */
export const budgetPayrollSettings = pgTable(
  'budget_payroll_settings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .unique()
      .references(() => budgetVersions.id, { onDelete: 'cascade' }),
    /** 'provisao' (13º/férias rateados mês a mês) | 'pagamento' (no mês em que saem). */
    modoProvisao: text('modo_provisao').notNull().default('provisao'),
    dissidioMes: integer('dissidio_mes'),
    /** Fração: 0.05 = 5%. */
    dissidioPct: numeric('dissidio_pct', { precision: 7, scale: 4 }),
    /** Comparado a `geradoEm` diz se a folha gerada está desatualizada. */
    quadroAlteradoEm: timestamp('quadro_alterado_em', tz).notNull().default(sql`now()`),
    geradoEm: timestamp('gerado_em', tz),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    orgIdx: index('idx_budget_payroll_settings_org').on(t.organizationId),
  })
)

/** O quadro: uma linha por pessoa (ou vaga). */
export const budgetPeople = pgTable(
  'budget_people',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => budgetVersions.id, { onDelete: 'cascade' }),
    nome: text('nome'),
    isVaga: boolean('is_vaga').notNull().default(false),
    /** 'clt' | 'pj' | 'pro_labore' | 'estagio' */
    vinculo: text('vinculo').notNull(),
    cargo: text('cargo'),
    /** Obrigatória para CLT e pró-labore (de onde vêm as alíquotas). */
    legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id, { onDelete: 'restrict' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    valorBase: numeric('valor_base', { precision: 15, scale: 2 }).notNull(),
    outrosProventos: numeric('outros_proventos', { precision: 15, scale: 2 }).notNull().default('0'),
    mesEntrada: integer('mes_entrada').notNull().default(1),
    mesSaida: integer('mes_saida').notNull().default(12),
    /** Só PJ: meses com pagamento (nulo = todos entre entrada e saída). */
    mesesPj: integer('meses_pj').array(),
    mesFerias: integer('mes_ferias'),
    diaPagamentoPj: integer('dia_pagamento_pj').notNull().default(10),
    aplicaDissidio: boolean('aplica_dissidio').notNull().default(true),
    reajusteMes: integer('reajuste_mes'),
    /** Fração: 0.05 = 5%. */
    reajustePct: numeric('reajuste_pct', { precision: 7, scale: 4 }),
    /** componente da folha → category_id; sobrepõe o mapa da organização. */
    naturezas: jsonb('naturezas').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    observacao: text('observacao'),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    versionIdx: index('idx_budget_people_version').on(t.versionId),
    orgIdx: index('idx_budget_people_org').on(t.organizationId),
  })
)

/** Rateio da pessoa por centro de custo / unidade de negócio (0–100). */
export const budgetPeopleAllocations = pgTable(
  'budget_people_allocations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => budgetPeople.id, { onDelete: 'cascade' }),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id, { onDelete: 'set null' }),
    businessUnitId: uuid('business_unit_id').references(() => businessUnits.id, { onDelete: 'set null' }),
    percentual: numeric('percentual', { precision: 5, scale: 2 }).notNull(),
    ordem: integer('ordem').notNull(),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    personIdx: index('idx_budget_people_allocations_person').on(t.personId),
    orgIdx: index('idx_budget_people_allocations_org').on(t.organizationId),
  })
)

/** Benefícios mensais da pessoa (VR, plano de saúde...). */
export const budgetPeopleBenefits = pgTable(
  'budget_people_benefits',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => budgetPeople.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    valorMensal: numeric('valor_mensal', { precision: 15, scale: 2 }).notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    ordem: integer('ordem'),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    personIdx: index('idx_budget_people_benefits_person').on(t.personId),
    orgIdx: index('idx_budget_people_benefits_org').on(t.organizationId),
  })
)

/** componente da folha → natureza, por organização. */
export const payrollCategoryMap = pgTable(
  'payroll_category_map',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    componente: text('componente').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.organizationId, t.componente] }),
  })
)

export type BudgetPayrollSettings = typeof budgetPayrollSettings.$inferSelect
export type BudgetPerson = typeof budgetPeople.$inferSelect
export type NewBudgetPerson = typeof budgetPeople.$inferInsert
export type BudgetPersonAllocation = typeof budgetPeopleAllocations.$inferSelect
export type BudgetPersonBenefit = typeof budgetPeopleBenefits.$inferSelect
export type PayrollCategoryMapRow = typeof payrollCategoryMap.$inferSelect
