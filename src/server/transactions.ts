'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, transactions, categorizationRules, categories, documents, costCenters, businessUnits, legalEntities, dataSources } from '@/db/schema'
import { eq, and, isNotNull, desc, asc, count, inArray, or, sql, ilike, gte, lte, isNull, ne, SQL, getTableColumns } from 'drizzle-orm'
import { inngest } from '@/lib/inngest'

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

// Parseia filtros multi-select: "id1,id2,__none__,__classified__" → { ids, includeNone, includeClassified }
function parseMultiFilter(param: string | undefined): { ids: string[]; includeNone: boolean; includeClassified: boolean } {
  if (!param) return { ids: [], includeNone: false, includeClassified: false }
  const parts = param.split(',').map(p => p.trim()).filter(Boolean)
  return {
    includeNone: parts.includes('__none__'),
    includeClassified: parts.includes('__classified__'),
    ids: parts.filter(p => p !== '__none__' && p !== '__classified__'),
  }
}

// Constrói condição SQL para filtro multi-select numa coluna nullable
function buildMultiFilterCondition(
  column: Parameters<typeof isNull>[0],
  filter: { ids: string[]; includeNone: boolean; includeClassified: boolean },
): SQL | null {
  const { ids, includeNone, includeClassified } = filter
  if (!includeNone && !includeClassified && ids.length === 0) return null

  const clauses: (SQL | undefined)[] = []
  if (includeNone) clauses.push(isNull(column) as SQL)
  if (includeClassified) clauses.push(isNotNull(column) as SQL)
  if (ids.length > 0) clauses.push(inArray(column, ids) as SQL)

  if (clauses.length === 1) return clauses[0]!
  return or(...clauses as SQL[]) as SQL
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
  accountId?: string
  sort?: string
  reportType?: string
  amountMin?: string
  amountMax?: string
}

export async function getTransactions(params: GetTransactionsParams = {}) {
  const { organizationId } = await getAuthContext()
  const { page = 1, q, from, to, direction, category, costCenter, businessUnit, legalEntity, documentId, accountId, sort, reportType, amountMin, amountMax } = params
  const offset = (page - 1) * PAGE_SIZE

  const conditions: SQL[] = [
    eq(transactions.organizationId, organizationId),
    ne(transactions.status, 'pending'),
  ]

  if (q?.trim()) conditions.push(ilike(transactions.description, `%${q.trim()}%`))
  if (from) conditions.push(gte(transactions.date, from))
  if (to) conditions.push(lte(transactions.date, to))
  if (direction === 'inflow' || direction === 'outflow') conditions.push(eq(transactions.direction, direction))
  if (amountMin) conditions.push(gte(sql`${transactions.amount}::numeric`, sql`${amountMin}::numeric`))
  if (amountMax) conditions.push(lte(sql`${transactions.amount}::numeric`, sql`${amountMax}::numeric`))

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

  const acctFilter = parseMultiFilter(accountId)
  if (acctFilter.ids.length > 0) conditions.push(inArray(transactions.accountId, acctFilter.ids))

  if (reportType === 'balance_sheet') {
    conditions.push(eq(documents.reportType, 'balance_sheet'))
  } else if (reportType === 'other') {
    conditions.push(ne(documents.reportType, 'balance_sheet'))
  }

  const whereClause = and(...conditions)

  // Ordenação
  const orderBy = (() => {
    switch (sort) {
      case 'date_asc':         return [asc(transactions.date), asc(transactions.createdAt)]
      case 'amount_desc':      return [desc(sql`${transactions.amount}::numeric`), desc(transactions.date)]
      case 'amount_asc':       return [asc(sql`${transactions.amount}::numeric`), desc(transactions.date)]
      case 'desc_asc':         return [asc(transactions.description), desc(transactions.date)]
      case 'desc_desc':        return [desc(transactions.description), desc(transactions.date)]
      case 'account_asc':      return [asc(transactions.accountName), desc(transactions.date)]
      case 'account_desc':     return [desc(transactions.accountName), desc(transactions.date)]
      case 'direction_asc':    return [asc(transactions.direction), desc(transactions.date)]
      case 'direction_desc':   return [desc(transactions.direction), desc(transactions.date)]
      case 'reporttype_asc':   return [asc(documents.reportType), desc(transactions.date)]
      case 'reporttype_desc':  return [desc(documents.reportType), desc(transactions.date)]
      case 'category_asc':     return [asc(categories.code), asc(categories.name)]
      case 'category_desc':    return [desc(categories.code), desc(categories.name)]
      case 'costcenter_asc':   return [asc(costCenters.code), asc(costCenters.name)]
      case 'costcenter_desc':  return [desc(costCenters.code), desc(costCenters.name)]
      case 'businessunit_asc': return [asc(businessUnits.code), asc(businessUnits.name)]
      case 'businessunit_desc':return [desc(businessUnits.code), desc(businessUnits.name)]
      case 'legalentity_asc':  return [asc(legalEntities.name)]
      case 'legalentity_desc': return [desc(legalEntities.name)]
      default:                 return [desc(transactions.date), desc(transactions.createdAt)]
    }
  })()

  const baseQuery = db
    .select({
      ...getTableColumns(transactions),
      documentReportType: documents.reportType,
      dataSourceMetadata: dataSources.metadata,
    })
    .from(transactions)
    .leftJoin(documents, eq(transactions.documentId, documents.id))
    .leftJoin(dataSources, eq(transactions.dataSourceId, dataSources.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(costCenters, eq(transactions.costCenterId, costCenters.id))
    .leftJoin(businessUnits, eq(transactions.businessUnitId, businessUnits.id))
    .leftJoin(legalEntities, eq(transactions.legalEntityId, legalEntities.id))

  const countQuery = db
    .select({ total: count() })
    .from(transactions)
    .leftJoin(documents, eq(transactions.documentId, documents.id))

  const totalsQuery = db
    .select({
      inflow: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'inflow' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
      outflow: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'outflow' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
    })
    .from(transactions)
    .leftJoin(documents, eq(transactions.documentId, documents.id))

  const [rows, [{ total }], [totals]] = await Promise.all([
    baseQuery.where(whereClause).orderBy(...orderBy).limit(PAGE_SIZE).offset(offset),
    countQuery.where(whereClause),
    totalsQuery.where(whereClause),
  ])

  // Gera signed URLs para customLogoPath em batch (uma por data_source único)
  const customLogoByDs = new Map<string, string>()
  for (const r of rows) {
    const meta = (r.dataSourceMetadata ?? {}) as Record<string, unknown>
    const path = typeof meta.customLogoPath === 'string' ? meta.customLogoPath : null
    if (path && r.dataSourceId && !customLogoByDs.has(r.dataSourceId)) {
      customLogoByDs.set(r.dataSourceId, path)
    }
  }
  const supabase = createClient()
  const signedEntries = await Promise.all(
    Array.from(customLogoByDs.entries()).map(async ([dsId, path]) => {
      const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
      return [dsId, data?.signedUrl ?? null] as const
    })
  )
  const signedMap = new Map(signedEntries)

  const enrichedRows = rows.map(r => {
    const meta = (r.dataSourceMetadata ?? {}) as Record<string, unknown>
    const autoLogo = typeof meta.institutionImageUrl === 'string' ? meta.institutionImageUrl : null
    const customLogo = r.dataSourceId ? signedMap.get(r.dataSourceId) ?? null : null
    const badge = (meta.customBadge as { text?: string } | undefined)?.text || null
    // dataSourceMetadata é só usado para derivar logo/badge — não vaza no payload
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { dataSourceMetadata: _meta, ...rest } = r
    return {
      ...rest,
      connectionLogoUrl: customLogo ?? autoLogo,
      connectionBadge: badge,
    }
  })

  return {
    rows: enrichedRows,
    total,
    pages: Math.ceil(total / PAGE_SIZE),
    page,
    totals: { inflow: totals.inflow, outflow: totals.outflow },
  }
}

async function assertLeafCategory(categoryId: string, organizationId: string): Promise<string | null> {
  const [cat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.organizationId, organizationId)))
    .limit(1)
  if (!cat) return 'Categoria não encontrada.'

  const [child] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, categoryId), eq(categories.organizationId, organizationId)))
    .limit(1)
  if (child) return 'Categorias com subcategorias não podem ser atribuídas diretamente a transações.'
  return null
}

const dimensionSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  costCenterId: z.string().uuid().nullable().optional(),
  businessUnitId: z.string().uuid().nullable().optional(),
  legalEntityId: z.string().uuid().nullable().optional(),
})

type DimensionData = z.infer<typeof dimensionSchema>

async function upsertRule(
  organizationId: string,
  description: string,
  accountId: string | null,
  data: DimensionData,
) {
  const trimmed = description.slice(0, 200)

  // Chave de identidade composta: (description, accountId)
  // Quando accountId é null, busca regras sem accountId (fallback global para uploads sem conta).
  const [existing] = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(
      eq(categorizationRules.organizationId, organizationId),
      sql`${categorizationRules.conditions}->>'description' = ${trimmed}`,
      accountId
        ? sql`${categorizationRules.conditions}->>'accountId' = ${accountId}`
        : sql`${categorizationRules.conditions}->>'accountId' IS NULL`,
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
    const conditions: Record<string, string> = { description: trimmed }
    if (accountId) conditions.accountId = accountId

    await db.insert(categorizationRules).values({
      organizationId,
      name: `Auto: ${trimmed.slice(0, 80)}`,
      conditions,
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
    .select({
      description: transactions.description,
      cleanedDescription: transactions.cleanedDescription,
      accountId: transactions.accountId,
    })
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
  await upsertRule(organizationId, description, tx.accountId, parsed.data)

  revalidatePath('/transacoes')
  revalidatePath('/dre')
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
  revalidatePath('/contas')
  revalidatePath('/dre')
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
    .select({
      description: transactions.description,
      cleanedDescription: transactions.cleanedDescription,
      accountId: transactions.accountId,
    })
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

  // Agrupa por (descrição efetiva, accountId) — cada par único vira uma regra
  const pairs = new Map<string, { description: string; accountId: string | null }>()
  for (const tx of txList) {
    const desc = tx.cleanedDescription || tx.description
    const key = `${desc}::${tx.accountId ?? ''}`
    if (!pairs.has(key)) pairs.set(key, { description: desc, accountId: tx.accountId })
  }
  await Promise.all(
    Array.from(pairs.values()).map(p => upsertRule(organizationId, p.description, p.accountId, parsed.data))
  )

  revalidatePath('/transacoes')
  revalidatePath('/dre')
  return { success: true, updated: txList.length }
}

export async function triggerCategorization(): Promise<{ triggered: boolean; count: number } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const uncategorized = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, organizationId),
      ne(transactions.status, 'pending'),
      isNull(transactions.categoryId),
    ))

  if (uncategorized.length === 0) return { triggered: false, count: 0 }

  try {
    await inngest.send({
      name: 'transaction/batch-inserted',
      data: { transactionIds: uncategorized.map(t => t.id), organizationId, forceRun: true },
    })
  } catch {
    return { error: 'Não foi possível iniciar a categorização. Verifique se o Inngest está rodando.' }
  }

  return { triggered: true, count: uncategorized.length }
}
