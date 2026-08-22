'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, documents, transactions, categories } from '@/db/schema'
import { eq, and, isNotNull, desc, lte, gte, asc, inArray, sum, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { BP_TYPES, BP_TYPE_LABELS, type BpType } from '@/lib/bp-types'
import type { DrillDownTransaction } from '@/lib/dre-types'
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

// ─── Drill-down de BP ─────────────────────────────────────────────────────────
//
// O usuário clica num nó (Pai/Filho/Group/Section) ou numa célula (nó × mês).
// O drill-down filtra por categoryIds + yearMonths (YYYY-MM array).
// Para cada YYYY-MM, identifica o documento BP mais recente daquele mês
// (mesmo dedup de getBpAllDates) e busca as transações vinculadas.

export async function getBalancoDrillDown(
  categoryIds: string[],
  yearMonths: string[],
): Promise<{ transactions: DrillDownTransaction[] }> {
  const { organizationId } = await getAuthContext()

  if (categoryIds.length === 0 || yearMonths.length === 0) {
    return { transactions: [] }
  }

  // Resolve documentIds para cada YYYY-MM via dedup (mais recente por mês).
  // Faz uma única query buscando docs no range [min, lastDayOfMax] e dedupa em memória.
  const sortedMonths = [...yearMonths].sort()
  const minMonth = sortedMonths[0]
  const maxMonth = sortedMonths[sortedMonths.length - 1]
  const [maxY, maxM] = maxMonth.split('-').map(Number)
  const lastDay = new Date(maxY, maxM, 0).getDate()
  const fromDate = `${minMonth}-01`
  const toDate   = `${maxMonth}-${String(lastDay).padStart(2, '0')}`

  const allDocs = await db
    .select({ id: documents.id, referenceDate: documents.referenceDate, createdAt: documents.createdAt })
    .from(documents)
    .where(and(
      eq(documents.organizationId, organizationId),
      eq(documents.reportType, 'balance_sheet'),
      isNotNull(documents.referenceDate),
      gte(documents.referenceDate, fromDate),
      lte(documents.referenceDate, toDate),
    ))
    .orderBy(asc(documents.referenceDate), desc(documents.createdAt))

  const targetMonthSet = new Set(yearMonths)
  const seenMonths = new Set<string>()
  const docIds: string[] = []
  for (const doc of allDocs) {
    if (!doc.referenceDate) continue
    const ym = doc.referenceDate.slice(0, 7)
    if (!targetMonthSet.has(ym)) continue
    if (seenMonths.has(ym)) continue
    seenMonths.add(ym)
    docIds.push(doc.id)
  }

  if (docIds.length === 0) return { transactions: [] }

  type TxRow = {
    id:                 string
    date:               string
    description:        string
    direction:          string
    amount:             string
    category_id:        string | null
    category_name:      string | null
    category_type:      string | null
    parent_category_id:   string | null
    parent_category_name: string | null
    parent_category_type: string | null
    cost_center_id:     string | null
    cost_center_name:   string | null
    business_unit_id:   string | null
    business_unit_name: string | null
    legal_entity_id:    string | null
    legal_entity_name:  string | null
    contact_id:         string | null
    contact_name:       string | null
    account_id:         string | null
    account_name:       string | null
    account_type:       string | null
    account_number:     string | null
    data_source_id:     string | null
    ds_metadata:        Record<string, unknown> | null
  }

  const result = await db.execute<TxRow>(sql`
    SELECT
      t.id::text               AS id,
      t.date                   AS date,
      t.description            AS description,
      t.direction              AS direction,
      t.amount::numeric        AS amount,
      t.category_id::text      AS category_id,
      c.name                   AS category_name,
      c.type                   AS category_type,
      p.id::text               AS parent_category_id,
      p.name                   AS parent_category_name,
      p.type                   AS parent_category_type,
      t.cost_center_id::text   AS cost_center_id,
      cc.name                  AS cost_center_name,
      t.business_unit_id::text AS business_unit_id,
      bu.name                  AS business_unit_name,
      t.legal_entity_id::text  AS legal_entity_id,
      le.name                  AS legal_entity_name,
      t.contact_id::text       AS contact_id,
      ct.name                  AS contact_name,
      t.account_id             AS account_id,
      t.account_name           AS account_name,
      t.account_type           AS account_type,
      t.account_number         AS account_number,
      t.data_source_id::text   AS data_source_id,
      ds.metadata              AS ds_metadata
    FROM transactions t
    LEFT JOIN categories c      ON t.category_id      = c.id
    LEFT JOIN categories p      ON c.parent_id        = p.id
    LEFT JOIN cost_centers cc   ON t.cost_center_id   = cc.id
    LEFT JOIN business_units bu ON t.business_unit_id = bu.id
    LEFT JOIN legal_entities le ON t.legal_entity_id  = le.id
    LEFT JOIN contacts ct       ON t.contact_id       = ct.id
    LEFT JOIN data_sources ds   ON t.data_source_id   = ds.id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.document_id IN (${sql.join(docIds.map(id => sql`${id}::uuid`), sql`, `)})
      AND t.category_id IN (${sql.join(categoryIds.map(id => sql`${id}::uuid`), sql`, `)})
      AND t.status NOT IN ('pending', 'duplicate')
    ORDER BY t.date DESC, t.created_at DESC
  `)

  // Gera signed URLs para customLogoPath em batch
  const customLogoByDs = new Map<string, string>()
  for (const r of result) {
    const meta = (r.ds_metadata ?? {}) as Record<string, unknown>
    const path = typeof meta.customLogoPath === 'string' ? meta.customLogoPath : null
    if (path && r.data_source_id && !customLogoByDs.has(r.data_source_id)) {
      customLogoByDs.set(r.data_source_id, path)
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

  const txList: DrillDownTransaction[] = result.map(r => {
    const amount = Number(r.amount)
    const meta = (r.ds_metadata ?? {}) as Record<string, unknown>
    const autoLogo = typeof meta.institutionImageUrl === 'string' ? meta.institutionImageUrl : null
    const customLogo = r.data_source_id ? signedMap.get(r.data_source_id) ?? null : null
    const badge = (meta.customBadge as { text?: string } | undefined)?.text || null

    // Quando a transação está classificada diretamente numa Natureza Pai
    // (categoria sem filhos), parent_* vem nulo — usamos a própria categoria
    // como "Pai" para que os subtotais agrupem corretamente.
    const parentId   = r.parent_category_id   ?? r.category_id   ?? null
    const parentName = r.parent_category_name ?? r.category_name ?? null
    const parentType = r.parent_category_type ?? r.category_type ?? null

    return {
      id:                 r.id,
      date:               String(r.date),
      description:        r.description,
      direction:          r.direction,
      amount,
      netAmount:          r.direction === 'inflow' ? amount : -amount,
      categoryId:         r.category_id ?? null,
      categoryName:       r.category_name ?? null,
      costCenterId:       r.cost_center_id ?? null,
      costCenterName:     r.cost_center_name ?? null,
      businessUnitId:     r.business_unit_id ?? null,
      businessUnitName:   r.business_unit_name ?? null,
      legalEntityId:      r.legal_entity_id ?? null,
      legalEntityName:    r.legal_entity_name ?? null,
      contactId:          r.contact_id ?? null,
      contactName:        r.contact_name ?? null,
      accountId:          r.account_id ?? null,
      accountName:        r.account_name ?? null,
      accountType:        r.account_type ?? null,
      accountNumber:      r.account_number ?? null,
      connectionLogoUrl:  customLogo ?? autoLogo,
      connectionBadge:    badge,
      parentCategoryId:   parentId,
      parentCategoryName: parentName,
      parentCategoryType: parentType,
    }
  })

  return { transactions: txList }
}
