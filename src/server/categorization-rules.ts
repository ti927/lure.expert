'use server'

import { getAuthContext } from '@/lib/auth-context'

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import {
  categorizationRules,
  categories,
  costCenters,
  businessUnits,
  legalEntities,
  contacts,
} from '@/db/schema'
import { eq, and, count, sql, inArray, desc } from 'drizzle-orm'
// A validação de alvo e a gravação vivem em `@/lib/rules-write` — o servidor MCP
// não pode importar daqui, e duas cópias da regra é como as duas superfícies
// passam a aceitar coisas diferentes. Aqui ficam a sessão e o `revalidatePath`.
import { criarRegra, atualizarRegra, type RuleInput } from '@/lib/rules-write'

export type { RuleInput }

const PAGE_SIZE = 100

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface RuleRow {
  id: string
  description: string
  accountId: string | null
  targetCategoryId: string | null
  targetCategoryCode: string | null
  targetCategoryName: string | null
  targetCategoryType: string | null
  targetCostCenterId: string | null
  targetCostCenterName: string | null
  targetBusinessUnitId: string | null
  targetBusinessUnitName: string | null
  targetLegalEntityId: string | null
  targetLegalEntityName: string | null
  targetContactId: string | null
  targetContactName: string | null
  matchCount: number
  createdAt: Date
  updatedAt: Date
}

export interface RulesListResult {
  rows: RuleRow[]
  total: number
  pages: number
  page: number
}

export interface RulesListFilters {
  page?: number
  q?: string                // busca em conditions.description
  accounts?: string         // "accountId1,accountId2,__none__" (__none__ = regras globais sem accountId)
  categories?: string       // "categoryId1,categoryId2,__none__" (__none__ = sem target_category_id)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseMulti(param: string | undefined): { ids: string[]; includeNone: boolean } {
  if (!param) return { ids: [], includeNone: false }
  const parts = param.split(',').map(p => p.trim()).filter(Boolean)
  return {
    includeNone: parts.includes('__none__'),
    ids: parts.filter(p => p !== '__none__'),
  }
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listRules(filters: RulesListFilters = {}): Promise<RulesListResult> {
  const { organizationId } = await getAuthContext()
  const page = Math.max(1, filters.page ?? 1)
  const offset = (page - 1) * PAGE_SIZE

  const conds = [
    eq(categorizationRules.organizationId, organizationId),
    // Apenas regras no formato novo. Antigas { field, op, value } ficam invisíveis na tela.
    sql`${categorizationRules.conditions} ? 'description'`,
  ]

  if (filters.q?.trim()) {
    const q = `%${filters.q.trim()}%`
    conds.push(sql`${categorizationRules.conditions}->>'description' ILIKE ${q}`)
  }

  const accountsFilter = parseMulti(filters.accounts)
  if (accountsFilter.ids.length > 0 || accountsFilter.includeNone) {
    const clauses: ReturnType<typeof sql>[] = []
    if (accountsFilter.ids.length > 0) {
      clauses.push(sql`${categorizationRules.conditions}->>'accountId' = ANY(${accountsFilter.ids})`)
    }
    if (accountsFilter.includeNone) {
      clauses.push(sql`(${categorizationRules.conditions} ->> 'accountId') IS NULL`)
    }
    conds.push(sql`(${sql.join(clauses, sql` OR `)})`)
  }

  const categoriesFilter = parseMulti(filters.categories)
  if (categoriesFilter.ids.length > 0 || categoriesFilter.includeNone) {
    const clauses: ReturnType<typeof sql>[] = []
    if (categoriesFilter.ids.length > 0) {
      clauses.push(sql`${categorizationRules.targetCategoryId} = ANY(${categoriesFilter.ids}::uuid[])`)
    }
    if (categoriesFilter.includeNone) {
      clauses.push(sql`${categorizationRules.targetCategoryId} IS NULL`)
    }
    conds.push(sql`(${sql.join(clauses, sql` OR `)})`)
  }

  const whereClause = and(...conds)

  const [{ total }] = await db
    .select({ total: count() })
    .from(categorizationRules)
    .where(whereClause)

  const rows = await db
    .select({
      id: categorizationRules.id,
      conditions: categorizationRules.conditions,
      targetCategoryId: categorizationRules.targetCategoryId,
      targetCategoryCode: categories.code,
      targetCategoryName: categories.name,
      targetCategoryType: categories.type,
      targetCostCenterId: categorizationRules.targetCostCenterId,
      targetCostCenterName: costCenters.name,
      targetBusinessUnitId: categorizationRules.targetBusinessUnitId,
      targetBusinessUnitName: businessUnits.name,
      targetLegalEntityId: categorizationRules.targetLegalEntityId,
      targetLegalEntityName: legalEntities.name,
      targetContactId: categorizationRules.targetContactId,
      targetContactName: contacts.name,
      matchCount: categorizationRules.matchCount,
      createdAt: categorizationRules.createdAt,
      updatedAt: categorizationRules.updatedAt,
    })
    .from(categorizationRules)
    .leftJoin(categories, eq(categorizationRules.targetCategoryId, categories.id))
    .leftJoin(costCenters, eq(categorizationRules.targetCostCenterId, costCenters.id))
    .leftJoin(businessUnits, eq(categorizationRules.targetBusinessUnitId, businessUnits.id))
    .leftJoin(legalEntities, eq(categorizationRules.targetLegalEntityId, legalEntities.id))
    .leftJoin(contacts, eq(categorizationRules.targetContactId, contacts.id))
    .where(whereClause)
    .orderBy(desc(categorizationRules.updatedAt))
    .limit(PAGE_SIZE)
    .offset(offset)

  const enriched: RuleRow[] = rows.map(r => {
    const c = (r.conditions ?? {}) as { description?: string; accountId?: string }
    return {
      id: r.id,
      description: c.description ?? '',
      accountId: c.accountId ?? null,
      targetCategoryId: r.targetCategoryId,
      targetCategoryCode: r.targetCategoryCode,
      targetCategoryName: r.targetCategoryName,
      targetCategoryType: r.targetCategoryType,
      targetCostCenterId: r.targetCostCenterId,
      targetCostCenterName: r.targetCostCenterName,
      targetBusinessUnitId: r.targetBusinessUnitId,
      targetBusinessUnitName: r.targetBusinessUnitName,
      targetLegalEntityId: r.targetLegalEntityId,
      targetLegalEntityName: r.targetLegalEntityName,
      targetContactId: r.targetContactId,
      targetContactName: r.targetContactName,
      matchCount: r.matchCount,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }
  })

  return {
    rows: enriched,
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    page,
  }
}

// ─── Create / Update / Delete ────────────────────────────────────────────────

export async function createRule(input: RuleInput) {
  const { organizationId } = await getAuthContext()
  const r = await criarRegra(organizationId, input)
  if ('error' in r) return { error: r.error }
  revalidatePath('/configuracoes/regras')
  return { success: true }
}

export async function updateRule(id: string, input: RuleInput) {
  const { organizationId } = await getAuthContext()
  const r = await atualizarRegra(organizationId, id, input)
  if ('error' in r) return { error: r.error }
  revalidatePath('/configuracoes/regras')
  return { success: true }
}

export async function deleteRule(id: string) {
  const { organizationId } = await getAuthContext()
  await db
    .delete(categorizationRules)
    .where(and(
      eq(categorizationRules.id, id),
      eq(categorizationRules.organizationId, organizationId),
    ))
  revalidatePath('/configuracoes/regras')
  return { success: true }
}

export async function deleteRules(ids: string[]) {
  const { organizationId } = await getAuthContext()
  if (ids.length === 0) return { error: 'Nenhuma regra selecionada.' }
  if (ids.length > 500) return { error: 'Máximo de 500 por operação.' }
  await db
    .delete(categorizationRules)
    .where(and(
      eq(categorizationRules.organizationId, organizationId),
      inArray(categorizationRules.id, ids),
    ))
  revalidatePath('/configuracoes/regras')
  return { success: true, deleted: ids.length }
}
