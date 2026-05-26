'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  memberships,
  transactionsStaging,
  documents,
  transactions,
  dataSources,
} from '@/db/schema'
import { eq, and, isNotNull, inArray, isNull, sql } from 'drizzle-orm'
import { sendCategorizationEvents } from '@/lib/inngest'
import {
  loadOrgContext,
  findCategoryByCsvMapping,
  domainFromReportType,
  type CsvCategoryMapping,
} from '@/lib/categorizer'
import { BP_TYPES } from '@/lib/bp-types'

const SOURCE_LABELS: Record<string, string> = {
  bank: 'Extrato bancário',
  erp: 'Relatório ERP',
  acquirer: 'Adquirente',
  credit_card: 'Fatura de cartão',
  sefaz: 'Nota fiscal',
  other: 'Upload manual',
}

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

// ─── Fetch document + all staging rows ──────────────────────────────────────
export async function getDocumentStagingRows(documentId: string) {
  const { organizationId } = await getAuthContext()

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(
      eq(documents.id, documentId),
      eq(documents.organizationId, organizationId),
    ))
    .limit(1)

  if (!doc) throw new Error('Documento não encontrado')

  const [rows, txResult] = await Promise.all([
    db
      .select()
      .from(transactionsStaging)
      .where(and(
        eq(transactionsStaging.documentId, documentId),
        eq(transactionsStaging.organizationId, organizationId),
      ))
      .orderBy(transactionsStaging.rowIndex),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.documentId, documentId)),
  ])

  const importedCount = Number(txResult[0]?.count ?? 0)

  return { document: doc, rows, importedCount }
}

// ─── Update single staging row (inline edit) ─────────────────────────────────
export async function updateStagingRow(
  rowId: string,
  fields: {
    date?: string | null
    amount?: string | null
    direction?: string | null
    description?: string | null
  },
) {
  const { organizationId } = await getAuthContext()

  await db
    .update(transactionsStaging)
    .set(fields)
    .where(and(
      eq(transactionsStaging.id, rowId),
      eq(transactionsStaging.organizationId, organizationId),
    ))

  return { success: true }
}

// ─── Batch update: approve | reject | flip direction ─────────────────────────
export async function batchUpdateStaging(
  documentId: string,
  rowIds: string[],
  action: 'approve' | 'reject' | 'flip',
) {
  if (rowIds.length === 0) return { success: true }

  const { organizationId } = await getAuthContext()

  const where = and(
    eq(transactionsStaging.organizationId, organizationId),
    eq(transactionsStaging.documentId, documentId),
    inArray(transactionsStaging.id, rowIds),
  )

  if (action === 'flip') {
    await db
      .update(transactionsStaging)
      .set({
        direction: sql`CASE
          WHEN direction = 'inflow' THEN 'outflow'
          WHEN direction = 'outflow' THEN 'inflow'
          ELSE direction
        END`,
      })
      .where(where)
  } else {
    await db
      .update(transactionsStaging)
      .set({ status: action === 'approve' ? 'approved' : 'rejected' })
      .where(where)
  }

  return { success: true }
}

// ─── Bulk: define direção em TODAS as linhas sem direção do documento ────────
// Usado quando o parser não conseguiu inferir direção (ex: ERP de vendas, onde
// todas as linhas são entradas mas não há coluna explícita de tipo).
export async function setAllPendingDirection(
  documentId: string,
  direction: 'inflow' | 'outflow',
) {
  const { organizationId } = await getAuthContext()

  const result = await db
    .update(transactionsStaging)
    .set({ direction })
    .where(and(
      eq(transactionsStaging.documentId, documentId),
      eq(transactionsStaging.organizationId, organizationId),
      isNull(transactionsStaging.direction),
    ))
    .returning({ id: transactionsStaging.id })

  return { updated: result.length }
}

// ─── Approve pending + insert approved rows into transactions ─────────────────
export async function approveAndInsert(documentId: string) {
  const { organizationId } = await getAuthContext()

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(
      eq(documents.id, documentId),
      eq(documents.organizationId, organizationId),
    ))
    .limit(1)
  if (!doc) throw new Error('Documento não encontrado')

  // Approve all still-pending rows before inserting
  await db
    .update(transactionsStaging)
    .set({ status: 'approved' })
    .where(and(
      eq(transactionsStaging.documentId, documentId),
      eq(transactionsStaging.organizationId, organizationId),
      eq(transactionsStaging.status, 'pending'),
    ))

  // Get or create upload data source for this org+sourceType
  const sourceType = ((doc.metadata as Record<string, unknown>)?.source_type as string) ?? 'other'

  let [dataSource] = await db
    .select()
    .from(dataSources)
    .where(and(
      eq(dataSources.organizationId, organizationId),
      eq(dataSources.provider, 'upload'),
      eq(dataSources.type, sourceType),
    ))
    .limit(1)

  if (!dataSource) {
    ;[dataSource] = await db
      .insert(dataSources)
      .values({
        organizationId,
        type: sourceType,
        provider: 'upload',
        name: `Upload — ${SOURCE_LABELS[sourceType] ?? 'Manual'}`,
      })
      .returning()
  }

  if (!dataSource) throw new Error('Não foi possível criar a fonte de dados. Tente novamente.')

  // Fetch all approved rows
  const approved = await db
    .select()
    .from(transactionsStaging)
    .where(and(
      eq(transactionsStaging.documentId, documentId),
      eq(transactionsStaging.organizationId, organizationId),
      eq(transactionsStaging.status, 'approved'),
    ))

  // Only insert rows with the minimum required fields
  const valid = approved.filter(r => r.date && r.amount && r.direction)
  const skipped = approved.length - valid.length

  if (valid.length === 0) return { inserted: 0, skipped, total: approved.length, csvMatched: 0, categorizationDispatched: true }

  // Carrega contexto da org UMA vez (folhas com parentName) pra tentar match
  // determinístico contra Categoria/Natureza Pai/Filho que vieram do CSV.
  // Determina o domínio (DRE vs BP) pelo report_type do documento, igual
  // o categorizer faz.
  const orgCtx = await loadOrgContext(organizationId)
  const documentDomain = domainFromReportType(doc.reportType)
  const bpTypeSet = new Set<string>(BP_TYPES)
  const domainLeaves = orgCtx.categories.filter(c =>
    documentDomain === 'bp' ? bpTypeSet.has(c.type) : !bpTypeSet.has(c.type),
  )

  // Insert in batches of 100 and collect IDs for categorization.
  // csvMatchedIds NÃO entra no batch-inserted event (já classificado, não
  // precisa passar pelo categorizer LLM).
  const BATCH = 100
  const insertedIds: string[] = []
  const csvMatchedIds: string[] = []

  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH)
    const rows = await db.insert(transactions).values(
      batch.map(r => {
        const raw = (r.rawData ?? {}) as Record<string, unknown>
        const hints = raw.__categoryHints && typeof raw.__categoryHints === 'object'
          ? (raw.__categoryHints as Record<string, string>)
          : null
        const mapping = raw.__categoryMapping && typeof raw.__categoryMapping === 'object'
          ? (raw.__categoryMapping as CsvCategoryMapping)
          : null

        const metadata: Record<string, unknown> = { stagingId: r.id, sourceType }
        if (hints && Object.keys(hints).length > 0) metadata.categoryHints = hints
        if (mapping && (mapping.categoriaFilho || mapping.categoriaPai || mapping.tipoNatureza)) metadata.categoryMapping = mapping

        // Layer 0: tenta lookup determinístico pelo plano de contas
        const csvMatchId = findCategoryByCsvMapping(mapping, domainLeaves)

        return {
          organizationId,
          dataSourceId: dataSource.id,
          date: r.date!,
          effectiveDate: r.effectiveDate ?? r.date,
          amount: String(Math.abs(Number(r.amount))),
          currency: 'BRL',
          direction: r.direction!,
          description: r.description ?? '',
          documentId,
          rawData: r.rawData ?? {},
          metadata,
          categoryId: csvMatchId,
          categorizationMethod: csvMatchId ? 'csv_match' : null,
          categorizationConfidence: csvMatchId ? '1.0' : null,
          needsReview: false,
          status: 'confirmed' as const,
        }
      }),
    ).returning({ id: transactions.id, categoryId: transactions.categoryId })

    for (const row of rows) {
      if (row.categoryId) csvMatchedIds.push(row.id)
      else insertedIds.push(row.id)
    }
  }

  // Dispara categorização assíncrona via Inngest SÓ pros que não casaram via
  // CSV. Se o send falhar, NÃO desfazemos os inserts — sinalizamos pro
  // frontend pra usuário poder rodar "Categorizar agora" depois.
  let categorizationDispatched = true
  if (insertedIds.length > 0) {
    try {
      await sendCategorizationEvents(insertedIds, organizationId)
    } catch (err) {
      console.error('[approveAndInsert] sendCategorizationEvents falhou:', err)
      categorizationDispatched = false
    }
  }

  revalidatePath(`/upload/${documentId}/review`)
  return {
    inserted: valid.length,
    skipped,
    total: approved.length,
    csvMatched: csvMatchedIds.length,
    categorizationDispatched,
  }
}
