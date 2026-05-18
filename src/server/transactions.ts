'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, transactions, categorizationRules, categories } from '@/db/schema'
import { eq, and, isNotNull, desc, asc, count, inArray, or, sql, ilike, gte, lte, isNull, SQL } from 'drizzle-orm'

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

const PAGE_SIZE = 25

// Parseia filtros multi-select: "id1,id2,__none__" → { ids, includeNone }
function parseMultiFilter(param: string | undefined): { ids: string[]; includeNone: boolean } {
  if (!param) return { ids: [], includeNone: false }
  const parts = param.split(',').map(p => p.trim()).filter(Boolean)
  return {
    includeNone: parts.includes('__none__'),
    ids: parts.filter(p => p !== '__none__'),
  }
}

// Constrói condição SQL para filtro multi-select numa coluna nullable
function buildMultiFilterCondition(
  column: Parameters<typeof isNull>[0],
  filter: { ids: string[]; includeNone: boolean },
): SQL | null {
  const { ids, includeNone } = filter
  if (!includeNone && ids.length === 0) return null

  if (includeNone && ids.length > 0) {
    return or(isNull(column), inArray(column, ids)) as SQL
  }
  if (includeNone) return isNull(column)
  return inArray(column, ids) as SQL
}

interface GetTransactionsParams {
  page?: number
  q?: string
  from?: string
  to?: string
  direction?: string
  category?: string
  costCenter?: string
  businessUnit?: string
  legalEntity?: string
  documentId?: string
  sort?: string
}

export async function getTransactions(params: GetTransactionsParams = {}) {
  const { organizationId } = await getAuthContext()
  const { page = 1, q, from, to, direction, category, costCenter, businessUnit, legalEntity, documentId, sort } = params
  const offset = (page - 1) * PAGE_SIZE

  const conditions: SQL[] = [eq(transactions.organizationId, organizationId)]

  if (q?.trim()) conditions.push(ilike(transactions.description, `%${q.trim()}%`))
  if (from) conditions.push(gte(transactions.date, from))
  if (to) conditions.push(lte(transactions.date, to))
  if (direction === 'inflow' || direction === 'outflow') conditions.push(eq(transactions.direction, direction))

  const catFilter = buildMultiFilterCondition(transactions.categoryId, parseMultiFilter(category))
  if (catFilter) conditions.push(catFilter)

  const ccFilter = buildMultiFilterCondition(transactions.costCenterId, parseMultiFilter(costCenter))
  if (ccFilter) conditions.push(ccFilter)

  const buFilter = buildMultiFilterCondition(transactions.businessUnitId, parseMultiFilter(businessUnit))
  if (buFilter) conditions.push(buFilter)

  const leFilter = buildMultiFilterCondition(transactions.legalEntityId, parseMultiFilter(legalEntity))
  if (leFilter) conditions.push(leFilter)

  const docFilter = parseMultiFilter(documentId)
  if (docFilter.ids.length > 0) conditions.push(inArray(transactions.documentId, docFilter.ids))

  const whereClause = and(...conditions)

  // Ordenação
  const orderBy = (() => {
    switch (sort) {
      case 'date_asc': return [asc(transactions.date), asc(transactions.createdAt)]
      case 'amount_desc': return [desc(sql`${transactions.amount}::numeric`), desc(transactions.date)]
      case 'amount_asc': return [asc(sql`${transactions.amount}::numeric`), desc(transactions.date)]
      default: return [desc(transactions.date), desc(transactions.createdAt)]
    }
  })()

  const [rows, [{ total }], [totals]] = await Promise.all([
    db.select().from(transactions).where(whereClause).orderBy(...orderBy).limit(PAGE_SIZE).offset(offset),
    db.select({ total: count() }).from(transactions).where(whereClause),
    db.select({
      inflow: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'inflow' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
      outflow: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'outflow' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
    }).from(transactions).where(whereClause),
  ])

  return {
    rows,
    total,
    pages: Math.ceil(total / PAGE_SIZE),
    page,
    totals: { inflow: totals.inflow, outflow: totals.outflow },
  }
}

async function assertLeafCategory(categoryId: string, organizationId: string): Promise<string | null> {
  const [cat] = await db
    .select({ parentId: categories.parentId })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.organizationId, organizationId)))
    .limit(1)
  if (!cat) return 'Categoria não encontrada.'
  if (!cat.parentId) return 'Apenas Naturezas Filho (subcategorias) podem ser atribuídas a transações.'
  return null
}

const dimensionSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  costCenterId: z.string().uuid().nullable().optional(),
  businessUnitId: z.string().uuid().nullable().optional(),
  legalEntityId: z.string().uuid().nullable().optional(),
})

type DimensionData = z.infer<typeof dimensionSchema>

async function upsertRule(organizationId: string, description: string, data: DimensionData) {
  const trimmed = description.slice(0, 200)

  const [existing] = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(
      eq(categorizationRules.organizationId, organizationId),
      sql`${categorizationRules.conditions}->>'value' = ${trimmed}`,
    ))
    .limit(1)

  if (existing) {
    const updates: Partial<typeof categorizationRules.$inferInsert> = { updatedAt: new Date() }
    if (data.categoryId !== undefined) updates.targetCategoryId = data.categoryId
    if (data.costCenterId !== undefined) updates.targetCostCenterId = data.costCenterId
    if (data.businessUnitId !== undefined) updates.targetBusinessUnitId = data.businessUnitId
    if (data.legalEntityId !== undefined) updates.targetLegalEntityId = data.legalEntityId

    await db.update(categorizationRules).set(updates).where(eq(categorizationRules.id, existing.id))
  } else {
    await db.insert(categorizationRules).values({
      organizationId,
      name: `Auto: ${trimmed.slice(0, 80)}`,
      conditions: { field: 'description', op: 'contains', value: trimmed },
      targetCategoryId: data.categoryId ?? null,
      targetCostCenterId: data.costCenterId ?? null,
      targetBusinessUnitId: data.businessUnitId ?? null,
      targetLegalEntityId: data.legalEntityId ?? null,
      autoGenerated: false,
      confirmedAt: new Date(),
      priority: 0,
    })
  }
}

export async function classifyTransaction(id: string, data: DimensionData) {
  const { organizationId } = await getAuthContext()
  const parsed = dimensionSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (Object.keys(parsed.data).length === 0) return { error: 'Nenhuma dimensão fornecida.' }

  if (parsed.data.categoryId) {
    const catError = await assertLeafCategory(parsed.data.categoryId, organizationId)
    if (catError) return { error: catError }
  }

  const [tx] = await db
    .select({ description: transactions.description, cleanedDescription: transactions.cleanedDescription })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.organizationId, organizationId)))
    .limit(1)
  if (!tx) return { error: 'Transação não encontrada.' }

  const updates: Partial<typeof transactions.$inferInsert> = {
    categorizationMethod: 'manual',
    needsReview: false,
    updatedAt: new Date(),
  }
  if (parsed.data.categoryId !== undefined) updates.categoryId = parsed.data.categoryId
  if (parsed.data.costCenterId !== undefined) updates.costCenterId = parsed.data.costCenterId
  if (parsed.data.businessUnitId !== undefined) updates.businessUnitId = parsed.data.businessUnitId
  if (parsed.data.legalEntityId !== undefined) updates.legalEntityId = parsed.data.legalEntityId

  await db
    .update(transactions)
    .set(updates)
    .where(and(eq(transactions.id, id), eq(transactions.organizationId, organizationId)))

  const description = tx.cleanedDescription || tx.description
  await upsertRule(organizationId, description, parsed.data)

  revalidatePath('/transacoes')
  return { success: true }
}

export async function deleteTransactions(ids: string[]) {
  const { organizationId } = await getAuthContext()
  if (ids.length === 0) return { error: 'Nenhuma transação selecionada.' }
  if (ids.length > 500) return { error: 'Máximo de 500 transações por operação.' }

  await db
    .delete(transactions)
    .where(and(eq(transactions.organizationId, organizationId), inArray(transactions.id, ids)))

  revalidatePath('/transacoes')
  return { success: true, deleted: ids.length }
}

export async function batchClassifyTransactions(ids: string[], data: DimensionData) {
  const { organizationId } = await getAuthContext()
  if (ids.length === 0) return { error: 'Nenhuma transação selecionada.' }
  if (ids.length > 200) return { error: 'Máximo de 200 transações por operação.' }

  const parsed = dimensionSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (Object.values(parsed.data).every(v => v === undefined)) {
    return { error: 'Selecione ao menos uma dimensão para classificar.' }
  }

  if (parsed.data.categoryId) {
    const catError = await assertLeafCategory(parsed.data.categoryId, organizationId)
    if (catError) return { error: catError }
  }

  const txList = await db
    .select({ description: transactions.description, cleanedDescription: transactions.cleanedDescription })
    .from(transactions)
    .where(and(eq(transactions.organizationId, organizationId), inArray(transactions.id, ids)))

  const updates: Partial<typeof transactions.$inferInsert> = {
    categorizationMethod: 'manual',
    needsReview: false,
    updatedAt: new Date(),
  }
  if (parsed.data.categoryId !== undefined) updates.categoryId = parsed.data.categoryId
  if (parsed.data.costCenterId !== undefined) updates.costCenterId = parsed.data.costCenterId
  if (parsed.data.businessUnitId !== undefined) updates.businessUnitId = parsed.data.businessUnitId
  if (parsed.data.legalEntityId !== undefined) updates.legalEntityId = parsed.data.legalEntityId

  await db
    .update(transactions)
    .set(updates)
    .where(and(eq(transactions.organizationId, organizationId), inArray(transactions.id, ids)))

  const uniqueDescriptions = new Set(txList.map(tx => tx.cleanedDescription || tx.description))
  await Promise.all(Array.from(uniqueDescriptions).map(desc => upsertRule(organizationId, desc, parsed.data)))

  revalidatePath('/transacoes')
  return { success: true, updated: txList.length }
}
