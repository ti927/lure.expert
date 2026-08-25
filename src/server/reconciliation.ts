'use server'

import { getAuthContext } from '@/lib/auth-context'

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { transactions } from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'

const PAGE_SIZE = 20

export type ReconciliationRow = {
  id: string
  date: string
  description: string
  amount: string
  direction: string
  score: number
  pluggy: {
    id: string
    date: string
    description: string
    amount: string
    direction: string
  }
}

export async function getReconciliationQueue(page = 1): Promise<{
  rows: ReconciliationRow[]
  total: number
  pages: number
  page: number
}> {
  const { organizationId } = await getAuthContext()
  const offset = (page - 1) * PAGE_SIZE

  const [rows, countResult] = await Promise.all([
    db.execute<{
      id: string
      date: string
      description: string
      amount: string
      direction: string
      score: string
      pluggy_id: string
      pluggy_date: string
      pluggy_description: string
      pluggy_amount: string
      pluggy_direction: string
    }>(sql`
      SELECT
        t.id,
        t.date::text,
        t.description,
        t.amount::text,
        t.direction,
        (t.metadata->>'reconciliationScore')::numeric AS score,
        (t.metadata->>'reconciliationCandidateId') AS pluggy_id,
        p.date::text AS pluggy_date,
        p.description AS pluggy_description,
        p.amount::text AS pluggy_amount,
        p.direction AS pluggy_direction
      FROM transactions t
      JOIN transactions p ON p.id = (t.metadata->>'reconciliationCandidateId')::uuid
      WHERE t.organization_id = ${organizationId}::uuid
        AND (t.metadata->>'reconciliationPending') = 'true'
        AND t.status NOT IN ('duplicate', 'ignored')
      ORDER BY score DESC, t.date DESC
      LIMIT ${PAGE_SIZE}
      OFFSET ${offset}
    `),

    db.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total
      FROM transactions
      WHERE organization_id = ${organizationId}::uuid
        AND (metadata->>'reconciliationPending') = 'true'
        AND status NOT IN ('duplicate', 'ignored')
    `),
  ])

  const total = Number(countResult[0]?.total ?? 0)

  return {
    rows: rows.map(r => ({
      id: r.id,
      date: String(r.date),
      description: r.description,
      amount: String(r.amount),
      direction: r.direction,
      score: Number(r.score),
      pluggy: {
        id: r.pluggy_id,
        date: String(r.pluggy_date),
        description: r.pluggy_description,
        amount: String(r.pluggy_amount),
        direction: r.pluggy_direction,
      },
    })),
    total,
    pages: Math.ceil(total / PAGE_SIZE),
    page,
  }
}

export async function getReconciliationCount(): Promise<number> {
  const { organizationId } = await getAuthContext()
  const result = await db.execute<{ total: number }>(sql`
    SELECT COUNT(*)::int AS total
    FROM transactions
    WHERE organization_id = ${organizationId}::uuid
      AND (metadata->>'reconciliationPending') = 'true'
      AND status NOT IN ('duplicate', 'ignored')
  `)
  return Number(result[0]?.total ?? 0)
}

export async function confirmDuplicate(uploadTxId: string, pluggyTxId: string) {
  const { organizationId } = await getAuthContext()

  const [current] = await db
    .select({ metadata: transactions.metadata })
    .from(transactions)
    .where(and(
      eq(transactions.id, uploadTxId),
      eq(transactions.organizationId, organizationId),
    ))
    .limit(1)

  if (!current) return { error: 'Transação não encontrada.' }

  const existingMeta = { ...(current.metadata ?? {}) } as Record<string, unknown>
  delete existingMeta['reconciliationPending']
  delete existingMeta['reconciliationCandidateId']
  delete existingMeta['reconciliationScore']

  await db
    .update(transactions)
    .set({
      status: 'duplicate',
      duplicateOf: pluggyTxId,
      needsReview: false,
      metadata: existingMeta,
      updatedAt: new Date(),
    })
    .where(and(
      eq(transactions.id, uploadTxId),
      eq(transactions.organizationId, organizationId),
    ))

  revalidatePath('/transacoes/reconciliacao')
  revalidatePath('/contas')
  revalidatePath('/transacoes')
  return { success: true }
}

export async function skipReconciliation(uploadTxId: string) {
  const { organizationId } = await getAuthContext()

  const [current] = await db
    .select({ metadata: transactions.metadata })
    .from(transactions)
    .where(and(
      eq(transactions.id, uploadTxId),
      eq(transactions.organizationId, organizationId),
    ))
    .limit(1)

  if (!current) return { error: 'Transação não encontrada.' }

  const existingMeta = { ...(current.metadata ?? {}) } as Record<string, unknown>
  delete existingMeta['reconciliationPending']
  delete existingMeta['reconciliationCandidateId']
  delete existingMeta['reconciliationScore']

  await db
    .update(transactions)
    .set({
      needsReview: false,
      metadata: existingMeta,
      updatedAt: new Date(),
    })
    .where(and(
      eq(transactions.id, uploadTxId),
      eq(transactions.organizationId, organizationId),
    ))

  revalidatePath('/transacoes/reconciliacao')
  revalidatePath('/contas')
  revalidatePath('/transacoes')
  return { success: true }
}
