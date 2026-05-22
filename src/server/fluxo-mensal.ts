'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships } from '@/db/schema'
import { eq, and, isNotNull, sql } from 'drizzle-orm'
import type { DreFilters } from '@/lib/dre-types'
import { BP_TYPES } from '@/lib/dre-types'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface FluxoMensalCategoryRow {
  categoryId:       string
  categoryName:     string
  categoryCode:     string
  parentId:         string
  parentName:       string
  parentCode:       string
  parentOpexCapex:  string
  month:            string  // "YYYY-MM"
  netAmount:        number  // SUM(inflow) - SUM(outflow)
}

export interface FluxoMensalData {
  months: string[]                 // todos os meses do intervalo, mesmo sem dados
  rows:   FluxoMensalCategoryRow[]
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

export async function getFluxoMensalData(filters: DreFilters): Promise<FluxoMensalData> {
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
    category_id:        string
    category_name:      string
    category_code:      string
    parent_id:          string
    parent_name:        string
    parent_code:        string
    parent_opex_capex:  string
    month:              string
    net_amount:         string
  }

  const result = await db.execute<AggRow>(sql`
    SELECT
      c.id::text                                                             AS category_id,
      c.name                                                                 AS category_name,
      c.code                                                                 AS category_code,
      c.parent_id::text                                                      AS parent_id,
      p.name                                                                 AS parent_name,
      p.code                                                                 AS parent_code,
      p.opex_capex                                                           AS parent_opex_capex,
      TO_CHAR(DATE_TRUNC('month', t.date::date), 'YYYY-MM')                 AS month,
      COALESCE(SUM(
        CASE WHEN t.direction = 'inflow'
             THEN  t.amount::numeric
             ELSE -t.amount::numeric END
      ), 0)                                                                  AS net_amount
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    JOIN categories p ON c.parent_id   = p.id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND t.date::date >= ${from}::date
      AND t.date::date <= ${to}::date
      AND c.type NOT IN (${sql.raw(BP_TYPES.map(t => `'${t}'`).join(', '))})
      AND c.hide_in_cashflow = false
      ${ccFilter}
      ${buFilter}
      ${leFilter}
    GROUP BY
      c.id, c.name, c.code,
      c.parent_id, p.name, p.code, p.opex_capex,
      DATE_TRUNC('month', t.date::date)
    ORDER BY
      p.code NULLS LAST,
      c.code,
      month
  `)

  const rows: FluxoMensalCategoryRow[] = result.map(r => ({
    categoryId:      r.category_id,
    categoryName:    r.category_name,
    categoryCode:    r.category_code,
    parentId:        r.parent_id,
    parentName:      r.parent_name,
    parentCode:      r.parent_code,
    parentOpexCapex: r.parent_opex_capex,
    month:           r.month,
    netAmount:       Number(r.net_amount),
  }))

  const months = generateMonthRange(from, to)
  return { months, rows }
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
