'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, documents, transactions, categories } from '@/db/schema'
import { eq, and, isNotNull, desc, lte, gte, asc, inArray, sum } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { BP_TYPES, BP_TYPE_LABELS, type BpType } from '@/lib/bp-types'
export type { BpType } from '@/lib/bp-types'

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

// ─── Multi-date BP table ──────────────────────────────────────────────────────

export type BpFilho = { id: string; name: string; code: string | null; parentId: string }
export type BpPai   = { id: string; name: string; code: string | null; type: BpType; filhos: BpFilho[] }
export type BpGroup = { bpType: BpType; label: string; pais: BpPai[] }
export type BpSectionData = { label: string; bpTypes: BpType[]; groups: BpGroup[] }
export type BpAllData = {
  dates: string[]
  sections: BpSectionData[]
  amounts: Record<string, Record<string, number>>
}

const BP_SECTION_DEFS: { label: string; bpTypes: BpType[] }[] = [
  { label: 'ATIVO',              bpTypes: ['ativo_circulante', 'ativo_nao_circulante'] },
  { label: 'PASSIVO',            bpTypes: ['passivo_circulante', 'passivo_nao_circulante'] },
  { label: 'PATRIMÔNIO LÍQUIDO', bpTypes: ['patrimonio_liquido'] },
]

// Gera todas as chaves "YYYY-MM" entre from e to (ambos "YYYY-MM-DD").
function generateMonthRange(from: string, to: string): string[] {
  const months: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [toY, toM] = to.split('-').map(Number)
  while (y < toY || (y === toY && m <= toM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return months
}

export async function getBpAllDates(from?: string, to?: string): Promise<BpAllData> {
  const { organizationId } = await getAuthContext()

  // 1. All active BP categories for this org
  const allCats = await db
    .select({ id: categories.id, name: categories.name, code: categories.code, parentId: categories.parentId, type: categories.type })
    .from(categories)
    .where(and(
      eq(categories.organizationId, organizationId),
      inArray(categories.type, [...BP_TYPES]),
    ))
    .orderBy(asc(categories.code))

  // 2. BP docs in period — dedup por ano-mês (YYYY-MM), mantendo o mais recente por mês
  const docConditions = [
    eq(documents.organizationId, organizationId),
    eq(documents.reportType, 'balance_sheet'),
    isNotNull(documents.referenceDate),
  ] as Parameters<typeof and>[0][]
  if (from) docConditions.push(gte(documents.referenceDate, from))
  if (to)   docConditions.push(lte(documents.referenceDate, to))

  const allDocs = await db
    .select({ id: documents.id, referenceDate: documents.referenceDate, createdAt: documents.createdAt })
    .from(documents)
    .where(and(...docConditions))
    .orderBy(asc(documents.referenceDate), desc(documents.createdAt))

  // Dedup por YYYY-MM: quando há múltiplos uploads no mesmo mês, mantém o mais recente (primeiro da ordem)
  const seenMonths = new Set<string>()
  const dedupedDocs: { id: string; yearMonth: string }[] = []
  for (const doc of allDocs) {
    if (!doc.referenceDate) continue
    const ym = doc.referenceDate.slice(0, 7)
    if (seenMonths.has(ym)) continue
    seenMonths.add(ym)
    dedupedDocs.push({ id: doc.id, yearMonth: ym })
  }

  // Datas = todos os meses do intervalo solicitado (inclusive os sem documento → zeros).
  // Se não houver intervalo definido, exibe apenas os meses com dados.
  const dates = (from && to) ? generateMonthRange(from, to) : dedupedDocs.map(d => d.yearMonth)

  // 3. Somas por (documentId, categoryId) — chaveadas por YYYY-MM
  const amounts: Record<string, Record<string, number>> = {}
  if (dedupedDocs.length > 0) {
    const docIds = dedupedDocs.map(d => d.id)
    const sums = await db
      .select({
        documentId: transactions.documentId,
        categoryId: transactions.categoryId,
        total: sum(transactions.amount),
      })
      .from(transactions)
      .where(and(
        eq(transactions.organizationId, organizationId),
        inArray(transactions.documentId, docIds),
        isNotNull(transactions.documentId),
        isNotNull(transactions.categoryId),
      ))
      .groupBy(transactions.documentId, transactions.categoryId)

    const docToYearMonth = new Map(dedupedDocs.map(d => [d.id, d.yearMonth]))
    for (const row of sums) {
      if (!row.documentId || !row.categoryId) continue
      const ym = docToYearMonth.get(row.documentId)
      if (!ym) continue
      if (!amounts[ym]) amounts[ym] = {}
      amounts[ym][row.categoryId] = Number(row.total ?? 0)
    }
  }

  // Build category tree
  const paiMap = new Map<string, BpPai>()
  const filhoList: BpFilho[] = []

  for (const cat of allCats) {
    if (!cat.parentId) {
      paiMap.set(cat.id, { id: cat.id, name: cat.name, code: cat.code, type: cat.type as BpType, filhos: [] })
    } else {
      filhoList.push({ id: cat.id, name: cat.name, code: cat.code, parentId: cat.parentId })
    }
  }
  for (const filho of filhoList) {
    const pai = paiMap.get(filho.parentId)
    if (pai) pai.filhos.push(filho)
  }

  const sections: BpSectionData[] = BP_SECTION_DEFS.map(def => ({
    label: def.label,
    bpTypes: def.bpTypes,
    groups: def.bpTypes.map(bpType => ({
      bpType,
      label: BP_TYPE_LABELS[bpType],
      pais: Array.from(paiMap.values()).filter(p => p.type === bpType),
    })),
  }))

  return { dates, sections, amounts }
}
