'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships } from '@/db/schema'
import { eq, and, isNotNull, sql } from 'drizzle-orm'
import type {
  DreFilters,
  DreCategoryRow,
  DreMonthSubtotals,
  DreData,
  DrillDownTransaction,
} from '@/lib/dre-types'
import { BP_TYPES } from '@/lib/dre-types'

// Re-exporta tipos para uso em server e client components
export type {
  DreFilters,
  DreCategoryRow,
  DreMonthSubtotals,
  DreData,
  DrillDownTransaction,
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

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

// ─── Query principal ──────────────────────────────────────────────────────────

export async function getDreData(filters: DreFilters): Promise<DreData> {
  const { organizationId } = await getAuthContext()
  const { from, to, costCenterIds, businessUnitIds, legalEntityIds } = filters

  const ccFilter = costCenterIds?.length
    ? sql`AND t.cost_center_id IN (${sql.join(costCenterIds.map(id => sql`${id}::uuid`), sql`, `)})`
    : sql``

  const buFilter = businessUnitIds?.length
    ? sql`AND t.business_unit_id IN (${sql.join(businessUnitIds.map(id => sql`${id}::uuid`), sql`, `)})`
    : sql``

  const leFilter = legalEntityIds?.length
    ? sql`AND t.legal_entity_id IN (${sql.join(legalEntityIds.map(id => sql`${id}::uuid`), sql`, `)})`
    : sql``

  type AggRow = {
    category_id:       string
    category_name:     string
    category_code:     string
    category_type:     string
    parent_id:         string
    parent_name:       string
    parent_code:       string
    month:             string
    net_amount:        string
    total_inflow:      string
    total_outflow:     string
    transaction_count: number
  }

  const result = await db.execute<AggRow>(sql`
    SELECT
      c.id::text                                                              AS category_id,
      c.name                                                                  AS category_name,
      c.code                                                                  AS category_code,
      c.type                                                                  AS category_type,
      c.parent_id::text                                                       AS parent_id,
      p.name                                                                  AS parent_name,
      p.code                                                                  AS parent_code,
      TO_CHAR(DATE_TRUNC('month', t.date::date), 'YYYY-MM')                  AS month,
      COALESCE(SUM(
        CASE WHEN t.direction = 'inflow'
             THEN  t.amount::numeric
             ELSE -t.amount::numeric END
      ), 0)                                                                   AS net_amount,
      COALESCE(SUM(CASE WHEN t.direction = 'inflow'  THEN t.amount::numeric ELSE 0 END), 0) AS total_inflow,
      COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric ELSE 0 END), 0) AS total_outflow,
      COUNT(*)::int                                                           AS transaction_count
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    JOIN categories p ON c.parent_id   = p.id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND t.date::date >= ${from}::date
      AND t.date::date <= ${to}::date
      AND c.type NOT IN (${sql.raw(BP_TYPES.map(t => `'${t}'`).join(', '))})
      AND c.hide_in_dre = false
      ${ccFilter}
      ${buFilter}
      ${leFilter}
    GROUP BY
      c.id, c.name, c.code, c.type,
      c.parent_id, p.name, p.code,
      DATE_TRUNC('month', t.date::date)
    ORDER BY
      c.type,
      p.code  NULLS LAST,
      c.code,
      month
  `)

  const rows: DreCategoryRow[] = result.map(r => ({
    categoryId:       r.category_id,
    categoryName:     r.category_name,
    categoryCode:     r.category_code,
    categoryType:     r.category_type as DreCategoryRow['categoryType'],
    parentId:         r.parent_id,
    parentName:       r.parent_name,
    parentCode:       r.parent_code,
    month:            r.month,
    netAmount:        Number(r.net_amount),
    totalInflow:      Number(r.total_inflow),
    totalOutflow:     Number(r.total_outflow),
    transactionCount: Number(r.transaction_count),
  }))

  const months    = generateMonthRange(from, to)
  const subtotals = months.map(month => computeSubtotals(month, rows))

  return { months, rows, subtotals }
}

// ─── Drill-down ───────────────────────────────────────────────────────────────

export async function getDreDrillDown(
  categoryId: string,
  month: string,   // YYYY-MM; ignorado quando dateRange é fornecido
  filters: Pick<DreFilters, 'costCenterIds' | 'businessUnitIds' | 'legalEntityIds'>,
  dateRange?: { from: string; to: string },
): Promise<{ transactions: DrillDownTransaction[]; total: number }> {
  const { organizationId } = await getAuthContext()
  const { costCenterIds, businessUnitIds, legalEntityIds } = filters

  const ccFilter = costCenterIds?.length
    ? sql`AND t.cost_center_id IN (${sql.join(costCenterIds.map(id => sql`${id}::uuid`), sql`, `)})`
    : sql``

  const buFilter = businessUnitIds?.length
    ? sql`AND t.business_unit_id IN (${sql.join(businessUnitIds.map(id => sql`${id}::uuid`), sql`, `)})`
    : sql``

  const leFilter = legalEntityIds?.length
    ? sql`AND t.legal_entity_id IN (${sql.join(legalEntityIds.map(id => sql`${id}::uuid`), sql`, `)})`
    : sql``

  let monthFrom: string
  let monthTo: string
  if (dateRange) {
    monthFrom = dateRange.from
    monthTo   = dateRange.to
  } else {
    const [y, m] = month.split('-').map(Number)
    monthFrom = `${month}-01`
    monthTo   = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  }

  type TxRow = {
    id:                 string
    date:               string
    description:        string
    direction:          string
    amount:             string
    category_id:        string | null
    category_name:      string | null
    cost_center_id:     string | null
    cost_center_name:   string | null
    business_unit_id:   string | null
    business_unit_name: string | null
    legal_entity_id:    string | null
    legal_entity_name:  string | null
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
      t.cost_center_id::text   AS cost_center_id,
      cc.name                  AS cost_center_name,
      t.business_unit_id::text AS business_unit_id,
      bu.name                  AS business_unit_name,
      t.legal_entity_id::text  AS legal_entity_id,
      le.name                  AS legal_entity_name,
      t.account_id             AS account_id,
      t.account_name           AS account_name,
      t.account_type           AS account_type,
      t.account_number         AS account_number,
      t.data_source_id::text   AS data_source_id,
      ds.metadata              AS ds_metadata
    FROM transactions t
    LEFT JOIN categories c     ON t.category_id     = c.id
    LEFT JOIN cost_centers cc  ON t.cost_center_id  = cc.id
    LEFT JOIN business_units bu ON t.business_unit_id = bu.id
    LEFT JOIN legal_entities le ON t.legal_entity_id  = le.id
    LEFT JOIN data_sources ds   ON t.data_source_id   = ds.id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.category_id     = ${categoryId}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND t.date::date >= ${monthFrom}::date
      AND t.date::date <= ${monthTo}::date
      ${ccFilter}
      ${buFilter}
      ${leFilter}
    ORDER BY t.date DESC, t.created_at DESC
  `)

  // Gera signed URLs para customLogoPath em batch (uma chamada por data_source único)
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

  const transactions: DrillDownTransaction[] = result.map(r => {
    const amount = Number(r.amount)
    const meta = (r.ds_metadata ?? {}) as Record<string, unknown>
    const autoLogo = typeof meta.institutionImageUrl === 'string' ? meta.institutionImageUrl : null
    const customLogo = r.data_source_id ? signedMap.get(r.data_source_id) ?? null : null
    const badge = (meta.customBadge as { text?: string } | undefined)?.text || null

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
      accountId:          r.account_id ?? null,
      accountName:        r.account_name ?? null,
      accountType:        r.account_type ?? null,
      accountNumber:      r.account_number ?? null,
      connectionLogoUrl:  customLogo ?? autoLogo,
      connectionBadge:    badge,
    }
  })

  return { transactions, total: transactions.length }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateMonthRange(from: string, to: string): string[] {
  const months: string[] = []
  let [y, m] = from.slice(0, 7).split('-').map(Number)
  const [toY, toM] = to.slice(0, 7).split('-').map(Number)
  while (y < toY || (y === toY && m <= toM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return months
}

function sumByTypes(month: string, rows: DreCategoryRow[], types: DreCategoryRow['categoryType'][]): number {
  return rows
    .filter(r => r.month === month && types.includes(r.categoryType))
    .reduce((acc, r) => acc + r.netAmount, 0)
}

function computeSubtotals(month: string, rows: DreCategoryRow[]): DreMonthSubtotals {
  const receitaBruta        = sumByTypes(month, rows, ['receita_operacional'])
  const deducoes            = sumByTypes(month, rows, ['deducoes_tributarias', 'deducoes_operacionais'])
  const receitaLiquida      = receitaBruta + deducoes
  const cpv                 = sumByTypes(month, rows, ['cpv'])
  const lucroBruto          = receitaLiquida + cpv
  const sga                 = sumByTypes(month, rows, ['sga'])
  const ebitda              = lucroBruto + sga
  const resultadoFinanceiro = sumByTypes(month, rows, ['resultado_financeiro'])
  const lair                = ebitda + resultadoFinanceiro
  const ir                  = sumByTypes(month, rows, ['ir'])
  const lucroLiquido        = lair + ir

  const emprestimosAmortizacoes = sumByTypes(month, rows, ['emprestimos_amortizacoes'])
  const investimentosRetiradas  = sumByTypes(month, rows, ['investimentos_retiradas'])
  const transferencias          = sumByTypes(month, rows, ['transfer'])
  const variacaoCaixa           = lucroLiquido + emprestimosAmortizacoes + investimentosRetiradas + transferencias

  return {
    month,
    receitaBruta,
    deducoes,
    receitaLiquida,
    cpv,
    lucroBruto,
    sga,
    ebitda,
    resultadoFinanceiro,
    lair,
    ir,
    lucroLiquido,
    emprestimosAmortizacoes,
    investimentosRetiradas,
    transferencias,
    variacaoCaixa,
  }
}
