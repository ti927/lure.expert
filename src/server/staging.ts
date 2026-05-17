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
import { eq, and, isNotNull, inArray, sql } from 'drizzle-orm'
import { inngest } from '@/lib/inngest'

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

  if (valid.length === 0) return { inserted: 0, skipped, total: approved.length }

  // Insert in batches of 100 and collect IDs for categorization
  const BATCH = 100
  const insertedIds: string[] = []

  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH)
    const rows = await db.insert(transactions).values(
      batch.map(r => ({
        organizationId,
        dataSourceId: dataSource.id,
        date: r.date!,
        amount: String(Math.abs(Number(r.amount))),
        currency: 'BRL',
        direction: r.direction!,
        description: r.description ?? '',
        documentId,
        rawData: r.rawData ?? {},
        metadata: { stagingId: r.id, sourceType },
        needsReview: false,
        status: 'confirmed',
      })),
    ).returning({ id: transactions.id })
    insertedIds.push(...rows.map(r => r.id))
  }

  // Dispara categorização assíncrona via Inngest (não bloqueia a resposta)
  if (insertedIds.length > 0) {
    try {
      await inngest.send({
        name: 'transaction/batch-inserted',
        data: { transactionIds: insertedIds, organizationId },
      })
    } catch {
      // Não bloqueia a importação se o Inngest estiver offline
    }
  }

  revalidatePath(`/upload/${documentId}/review`)
  return { inserted: valid.length, skipped, total: approved.length }
}
