'use server'

import { getAuthContext } from '@/lib/auth-context'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { transactions, categories, documents, costCenters, businessUnits, legalEntities, contacts, dataSources } from '@/db/schema'
import { eq, and, isNotNull, desc, asc, count, inArray, or, sql, ilike, gte, lte, isNull, ne, SQL, getTableColumns } from 'drizzle-orm'
import { sendCategorizationEvents } from '@/lib/inngest'
import { sanitizePageSize } from '@/lib/transactions-page-size'
import { dimensionExistsFilter } from '@/lib/sql-dimensions'
import { estimarCustoCategorizacao } from '@/lib/ai-pricing'
import {
  dimensionSchema, assertLeafCategory, classificarPorIds, type DimensionData,
} from '@/lib/transactions-write'
import { recusaDePapel } from '@/lib/members-types'

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
  pageSize?: number
  q?: string
  from?: string
  to?: string
  direction?: string
  category?: string
  costCenter?: string
  businessUnit?: string
  legalEntity?: string
  contact?: string
  documentId?: string
  accountId?: string
  sort?: string
  reportType?: string
  amountMin?: string
  amountMax?: string
}

export async function getTransactions(params: GetTransactionsParams = {}) {
  const { organizationId } = await getAuthContext()
  const { page = 1, pageSize, q, from, to, direction, category, costCenter, businessUnit, legalEntity, contact, documentId, accountId, sort, reportType, amountMin, amountMax } = params
  const size = sanitizePageSize(pageSize)
  const offset = (page - 1) * size

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

  // As quatro dimensões filtram pelas LINHAS do lançamento, não pela coluna
  // dele: com rateio a coluna do pai é nula e a classificação vive nas partes.
  // A listagem segue sendo uma linha por lançamento — só a pergunta mudou.
  const ccFilter = dimensionExistsFilter(transactions.id, 'cost_center_id', parseMultiFilter(costCenter))
  if (ccFilter) conditions.push(ccFilter)

  const buFilter = dimensionExistsFilter(transactions.id, 'business_unit_id', parseMultiFilter(businessUnit))
  if (buFilter) conditions.push(buFilter)

  const leFilter = dimensionExistsFilter(transactions.id, 'legal_entity_id', parseMultiFilter(legalEntity))
  if (leFilter) conditions.push(leFilter)

  const ctFilter = dimensionExistsFilter(transactions.id, 'contact_id', parseMultiFilter(contact))
  if (ctFilter) conditions.push(ctFilter)

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
      case 'contact_asc':      return [asc(contacts.name)]
      case 'contact_desc':     return [desc(contacts.name)]
      default:                 return [desc(transactions.date), desc(transactions.createdAt)]
    }
  })()

  const baseQuery = db
    .select({
      ...getTableColumns(transactions),
      documentReportType: documents.reportType,
      dataSourceMetadata: dataSources.metadata,
      // A tela precisa saber para não oferecer edição direta de dimensão: num
      // lançamento rateado o banco recusa gravar dimensão no pai.
      isAllocated: sql<boolean>`EXISTS (
        SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = ${transactions.id}
      )`,
    })
    .from(transactions)
    .leftJoin(documents, eq(transactions.documentId, documents.id))
    .leftJoin(dataSources, eq(transactions.dataSourceId, dataSources.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(costCenters, eq(transactions.costCenterId, costCenters.id))
    .leftJoin(businessUnits, eq(transactions.businessUnitId, businessUnits.id))
    .leftJoin(legalEntities, eq(transactions.legalEntityId, legalEntities.id))
    .leftJoin(contacts, eq(transactions.contactId, contacts.id))

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
    baseQuery.where(whereClause).orderBy(...orderBy).limit(size).offset(offset),
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
    pages: Math.ceil(total / size),
    pageSize: size,
    page,
    totals: { inflow: totals.inflow, outflow: totals.outflow },
  }
}


// `dimensionSchema`, `upsertRule`, `assertLeafCategory` e o miolo da
// classificação MUDARAM DE CASA para `@/lib/transactions-write` — o servidor MCP
// não pode importar de `src/server/**`, e duas cópias da regra é como a tela e o
// MCP passam a classificar diferente sem ninguém notar.

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
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.organizationId, organizationId)))
    .limit(1)
  if (!tx) return { error: 'Transação não encontrada.' }

  await classificarPorIds(organizationId, [id], parsed.data)

  revalidatePath('/transacoes')
  revalidatePath('/dre')
  return { success: true }
}

export async function deleteTransactions(ids: string[]) {
  const { organizationId, papel } = await getAuthContext()

  // Ponto v1 da matriz (4.B): apagar em lote é destrutivo — admin para cima.
  const recusa = recusaDePapel(papel, 'admin', 'apagar lançamentos')
  if (recusa) return { error: recusa }

  if (ids.length === 0) return { error: 'Nenhuma transação selecionada.' }
  if (ids.length > 1000) return { error: 'Máximo de 1000 transações por operação.' }

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

  const atualizados = await classificarPorIds(organizationId, ids, parsed.data)

  revalidatePath('/transacoes')
  revalidatePath('/dre')
  return { success: true, updated: atualizados }
}

async function idsNaoCategorizados(organizationId: string) {
  return db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, organizationId),
      ne(transactions.status, 'pending'),
      isNull(transactions.categoryId),
    ))
}

/**
 * Quantos lançamentos o botão "Categorizar agora" vai classificar, e quanto
 * isso deve custar — sem disparar nada.
 *
 * Existe porque `triggerCategorization` dispara com `forceRun = true`, que
 * **ignora o toggle `autoCategorize`**: era o único caminho do app capaz de
 * gerar milhares de chamadas de IA com um clique e sem aviso. Numa organização
 * com 7.762 lançamentos sem natureza, é isso que o clique custa.
 */
export async function previewCategorization(): Promise<{ count: number; custoEstimadoUsd: number }> {
  const { organizationId } = await getAuthContext()
  const pendentes = await idsNaoCategorizados(organizationId)
  return {
    count: pendentes.length,
    custoEstimadoUsd: estimarCustoCategorizacao(pendentes.length),
  }
}

export async function triggerCategorization(): Promise<{ triggered: boolean; count: number } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const uncategorized = await idsNaoCategorizados(organizationId)

  if (uncategorized.length === 0) return { triggered: false, count: 0 }

  try {
    await sendCategorizationEvents(uncategorized.map(t => t.id), organizationId, true)
  } catch (err) {
    console.error('[triggerCategorization] sendCategorizationEvents falhou:', err)
    const detail = err instanceof Error ? err.message : String(err)
    return { error: `Não foi possível iniciar a categorização: ${detail}` }
  }

  return { triggered: true, count: uncategorized.length }
}
