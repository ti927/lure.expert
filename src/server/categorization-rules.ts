'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  memberships,
  categorizationRules,
  categories,
  costCenters,
  businessUnits,
  legalEntities,
  contacts,
} from '@/db/schema'
import { eq, and, isNotNull, count, sql, inArray, desc } from 'drizzle-orm'

async function getAuthContext() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!membership) redirect('/onboarding')

  return { userId: user.id, organizationId: membership.organizationId }
}

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

const ruleInputSchema = z.object({
  description: z.string().trim().min(1, 'Descrição obrigatória').max(200, 'Máximo 200 caracteres'),
  accountId: z.string().trim().min(1).max(200).nullable(),
  targetCategoryId: z.string().uuid().nullable(),
  targetCostCenterId: z.string().uuid().nullable(),
  targetBusinessUnitId: z.string().uuid().nullable(),
  targetLegalEntityId: z.string().uuid().nullable(),
  targetContactId: z.string().uuid().nullable(),
})

export type RuleInput = z.infer<typeof ruleInputSchema>

function hasAnyTarget(input: RuleInput): boolean {
  return !!(
    input.targetCategoryId ||
    input.targetCostCenterId ||
    input.targetBusinessUnitId ||
    input.targetLegalEntityId ||
    input.targetContactId
  )
}

async function validateTargetsBelongToOrg(input: RuleInput, organizationId: string): Promise<string | null> {
  const checks: Array<Promise<unknown>> = []
  if (input.targetCategoryId) {
    checks.push(
      db.select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, input.targetCategoryId), eq(categories.organizationId, organizationId)))
        .limit(1)
        .then(rows => { if (rows.length === 0) throw new Error('Categoria-alvo não pertence à sua organização.') })
    )
  }
  if (input.targetCostCenterId) {
    checks.push(
      db.select({ id: costCenters.id })
        .from(costCenters)
        .where(and(eq(costCenters.id, input.targetCostCenterId), eq(costCenters.organizationId, organizationId)))
        .limit(1)
        .then(rows => { if (rows.length === 0) throw new Error('Centro de custo não pertence à sua organização.') })
    )
  }
  if (input.targetBusinessUnitId) {
    checks.push(
      db.select({ id: businessUnits.id })
        .from(businessUnits)
        .where(and(eq(businessUnits.id, input.targetBusinessUnitId), eq(businessUnits.organizationId, organizationId)))
        .limit(1)
        .then(rows => { if (rows.length === 0) throw new Error('Unidade de negócio não pertence à sua organização.') })
    )
  }
  if (input.targetLegalEntityId) {
    checks.push(
      db.select({ id: legalEntities.id })
        .from(legalEntities)
        .where(and(eq(legalEntities.id, input.targetLegalEntityId), eq(legalEntities.organizationId, organizationId)))
        .limit(1)
        .then(rows => { if (rows.length === 0) throw new Error('Entidade jurídica não pertence à sua organização.') })
    )
  }
  if (input.targetContactId) {
    checks.push(
      db.select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, input.targetContactId), eq(contacts.organizationId, organizationId)))
        .limit(1)
        .then(rows => { if (rows.length === 0) throw new Error('Contato não pertence à sua organização.') })
    )
  }
  try {
    await Promise.all(checks)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'Falha ao validar alvos.'
  }
}

export async function createRule(input: RuleInput) {
  const { organizationId } = await getAuthContext()
  const parsed = ruleInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (!hasAnyTarget(parsed.data)) {
    return { error: 'Selecione ao menos um alvo (categoria, centro de custo, unidade de negócio, entidade ou contato).' }
  }

  const targetsError = await validateTargetsBelongToOrg(parsed.data, organizationId)
  if (targetsError) return { error: targetsError }

  // Evita duplicação: (description, accountId) já existe na org?
  const existing = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(
      eq(categorizationRules.organizationId, organizationId),
      sql`${categorizationRules.conditions}->>'description' = ${parsed.data.description}`,
      parsed.data.accountId
        ? sql`${categorizationRules.conditions}->>'accountId' = ${parsed.data.accountId}`
        : sql`(${categorizationRules.conditions} ->> 'accountId') IS NULL`,
    ))
    .limit(1)
  if (existing.length > 0) {
    return { error: 'Já existe uma regra com essa descrição e conta. Edite a existente em vez de criar uma nova.' }
  }

  const conditions: Record<string, string> = { description: parsed.data.description }
  if (parsed.data.accountId) conditions.accountId = parsed.data.accountId

  await db.insert(categorizationRules).values({
    organizationId,
    name: `Manual: ${parsed.data.description.slice(0, 80)}`,
    conditions,
    targetCategoryId: parsed.data.targetCategoryId,
    targetCostCenterId: parsed.data.targetCostCenterId,
    targetBusinessUnitId: parsed.data.targetBusinessUnitId,
    targetLegalEntityId: parsed.data.targetLegalEntityId,
    targetContactId: parsed.data.targetContactId,
    autoGenerated: false,
    confirmedAt: new Date(),
    priority: 0,
  })

  revalidatePath('/configuracoes/regras')
  return { success: true }
}

export async function updateRule(id: string, input: RuleInput) {
  const { organizationId } = await getAuthContext()
  const parsed = ruleInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (!hasAnyTarget(parsed.data)) {
    return { error: 'Selecione ao menos um alvo (categoria, centro de custo, unidade de negócio, entidade ou contato).' }
  }

  const targetsError = await validateTargetsBelongToOrg(parsed.data, organizationId)
  if (targetsError) return { error: targetsError }

  // Garante que a regra pertence à org
  const [own] = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(
      eq(categorizationRules.id, id),
      eq(categorizationRules.organizationId, organizationId),
    ))
    .limit(1)
  if (!own) return { error: 'Regra não encontrada.' }

  // Detecta colisão com outra regra (mesma description+accountId) — bloqueia
  const collision = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(
      eq(categorizationRules.organizationId, organizationId),
      sql`${categorizationRules.id} != ${id}`,
      sql`${categorizationRules.conditions}->>'description' = ${parsed.data.description}`,
      parsed.data.accountId
        ? sql`${categorizationRules.conditions}->>'accountId' = ${parsed.data.accountId}`
        : sql`(${categorizationRules.conditions} ->> 'accountId') IS NULL`,
    ))
    .limit(1)
  if (collision.length > 0) {
    return { error: 'Já existe outra regra com essa descrição e conta. Apague a outra primeiro ou ajuste a descrição.' }
  }

  const conditions: Record<string, string> = { description: parsed.data.description }
  if (parsed.data.accountId) conditions.accountId = parsed.data.accountId

  await db
    .update(categorizationRules)
    .set({
      name: `Manual: ${parsed.data.description.slice(0, 80)}`,
      conditions,
      targetCategoryId: parsed.data.targetCategoryId,
      targetCostCenterId: parsed.data.targetCostCenterId,
      targetBusinessUnitId: parsed.data.targetBusinessUnitId,
      targetLegalEntityId: parsed.data.targetLegalEntityId,
    targetContactId: parsed.data.targetContactId,
      autoGenerated: false,
      confirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(categorizationRules.id, id),
      eq(categorizationRules.organizationId, organizationId),
    ))

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
