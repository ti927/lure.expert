'use server'

import { getAuthContext } from '@/lib/auth-context'

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import type {
  DreFilters,
  DreCategoryRow,
  DreMonthSubtotals,
  DreData,
  DrillDownTransaction,
} from '@/lib/dre-types'
import { BP_TYPES } from '@/lib/dre-types'
import { generateMonthRange, computeSubtotals } from '@/lib/dre-calc'
import { dimensionFilters } from '@/lib/sql-dimensions'

// Re-exporta tipos para uso em server e client components
export type {
  DreFilters,
  DreCategoryRow,
  DreMonthSubtotals,
  DreData,
  DrillDownTransaction,
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

// ─── Query principal ──────────────────────────────────────────────────────────

export async function getDreData(filters: DreFilters): Promise<DreData> {
  const { organizationId } = await getAuthContext()
  const { from, to } = filters

  const dimFilters = dimensionFilters('t', filters)

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
      -- DISTINCT: a view devolve uma linha por parte, e o nome do campo promete
      -- lançamentos. Sem isso um lançamento rateado em 3 contaria como 3.
      COUNT(DISTINCT t.transaction_id)::int                                   AS transaction_count
    -- transaction_lines e não transactions: com rateio, cada parte entra na
    -- categoria com o SEU valor e as SUAS dimensões. Sem rateio a view devolve
    -- exatamente a linha de hoje, então nenhum número muda até alguém ratear.
    FROM transaction_lines t
    JOIN categories c ON t.category_id = c.id
    JOIN categories p ON c.parent_id   = p.id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND t.date::date >= ${from}::date
      AND t.date::date <= ${to}::date
      AND c.type NOT IN (${sql.raw(BP_TYPES.map(t => `'${t}'`).join(', '))})
      AND c.hide_in_dre = false
      ${dimFilters}
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
  // 'competencia' (padrão) filtra por t.date, como a DRE.
  // 'caixa' filtra por COALESCE(effective_date, date), como o Fluxo — necessário
  // para o drill-down da tela de Orçado × Realizado em regime de caixa.
  regime: 'competencia' | 'caixa' = 'competencia',
): Promise<{ transactions: DrillDownTransaction[]; total: number }> {
  const { organizationId } = await getAuthContext()

  const dimFilters = dimensionFilters('t', filters)
  const txDate = regime === 'caixa' ? sql`COALESCE(t.effective_date, t.date)` : sql`t.date`

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
    allocation_id:      string | null
    is_allocated:       boolean
    account_id:         string | null
    account_name:       string | null
    account_type:       string | null
    account_number:     string | null
    data_source_id:     string | null
    ds_metadata:        Record<string, unknown> | null
  }

  const result = await db.execute<TxRow>(sql`
    SELECT
      t.transaction_id::text   AS id,
      t.allocation_id::text    AS allocation_id,
      t.is_allocated           AS is_allocated,
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
    FROM transaction_lines t
    LEFT JOIN categories c     ON t.category_id     = c.id
    LEFT JOIN categories p     ON c.parent_id       = p.id
    LEFT JOIN cost_centers cc  ON t.cost_center_id  = cc.id
    LEFT JOIN business_units bu ON t.business_unit_id = bu.id
    LEFT JOIN legal_entities le ON t.legal_entity_id  = le.id
    LEFT JOIN contacts ct       ON t.contact_id       = ct.id
    LEFT JOIN data_sources ds   ON t.data_source_id   = ds.id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.category_id     = ${categoryId}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND ${txDate}::date >= ${monthFrom}::date
      AND ${txDate}::date <= ${monthTo}::date
      ${dimFilters}
    ORDER BY ${txDate} DESC, t.created_at DESC
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
      allocationId:       r.allocation_id ?? null,
      isAllocated:        r.is_allocated === true,
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

  return { transactions, total: transactions.length }
}
