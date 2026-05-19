'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, documents, transactions, categories } from '@/db/schema'
import { eq, and, isNotNull, desc, lte, inArray, sum } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

export const BP_TYPES = [
  'ativo_circulante',
  'ativo_nao_circulante',
  'passivo_circulante',
  'passivo_nao_circulante',
  'patrimonio_liquido',
] as const

export type BpType = typeof BP_TYPES[number]

export const BP_TYPE_LABELS: Record<BpType, string> = {
  ativo_circulante: 'Ativo Circulante',
  ativo_nao_circulante: 'Ativo Não-Circulante',
  passivo_circulante: 'Passivo Circulante',
  passivo_nao_circulante: 'Passivo Não-Circulante',
  patrimonio_liquido: 'Patrimônio Líquido',
}

export type BpRow = {
  childId: string
  childName: string
  childCode: string | null
  parentId: string
  parentName: string
  parentCode: string | null
  parentType: BpType
  total: number
}

export type BpData = {
  referenceDate: string
  documentId: string
  rows: BpRow[]
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

export async function getBpData(referenceDate: string): Promise<BpData | null> {
  const { organizationId } = await getAuthContext()

  const parent = alias(categories, 'parent')

  const [latestDoc] = await db
    .select({ id: documents.id, referenceDate: documents.referenceDate })
    .from(documents)
    .where(and(
      eq(documents.organizationId, organizationId),
      eq(documents.reportType, 'balance_sheet'),
      isNotNull(documents.referenceDate),
      lte(documents.referenceDate, referenceDate),
    ))
    .orderBy(desc(documents.referenceDate))
    .limit(1)

  if (!latestDoc?.referenceDate) return null

  const rows = await db
    .select({
      childId: categories.id,
      childName: categories.name,
      childCode: categories.code,
      parentId: parent.id,
      parentName: parent.name,
      parentCode: parent.code,
      parentType: parent.type,
      total: sum(transactions.amount),
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .innerJoin(parent, eq(categories.parentId, parent.id))
    .where(and(
      eq(transactions.documentId, latestDoc.id),
      eq(transactions.organizationId, organizationId),
      inArray(parent.type, [...BP_TYPES]),
    ))
    .groupBy(
      categories.id, categories.name, categories.code,
      parent.id, parent.name, parent.code, parent.type,
    )
    .orderBy(parent.code, categories.code)

  return {
    referenceDate: latestDoc.referenceDate,
    documentId: latestDoc.id,
    rows: rows.map(r => ({
      childId: r.childId,
      childName: r.childName,
      childCode: r.childCode,
      parentId: r.parentId,
      parentName: r.parentName,
      parentCode: r.parentCode,
      parentType: r.parentType as BpType,
      total: Number(r.total ?? 0),
    })),
  }
}

export async function getAvailableBpDates(): Promise<string[]> {
  const { organizationId } = await getAuthContext()

  const docs = await db
    .select({ referenceDate: documents.referenceDate })
    .from(documents)
    .where(and(
      eq(documents.organizationId, organizationId),
      eq(documents.reportType, 'balance_sheet'),
      isNotNull(documents.referenceDate),
    ))
    .orderBy(desc(documents.referenceDate))

  return docs.map(d => d.referenceDate).filter(Boolean) as string[]
}
