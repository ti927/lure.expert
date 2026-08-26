'use server'

import { getAuthContext } from '@/lib/auth-context'

import { db } from '@/db'
import { sql } from 'drizzle-orm'
import type { DreFilters } from '@/lib/dre-types'
import { BP_TYPES } from '@/lib/dre-types'
import { generateMonthRange } from '@/lib/dre-calc'
import { dimensionFilters } from '@/lib/sql-dimensions'
import { filtroDeVisibilidade } from '@/lib/category-visibility'

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

// ─── Query principal ──────────────────────────────────────────────────────────

export async function getFluxoMensalData(filters: DreFilters): Promise<FluxoMensalData> {
  const { organizationId } = await getAuthContext()
  const { from, to } = filters

  const dimFilters = dimensionFilters('t', filters)

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
      TO_CHAR(DATE_TRUNC('month', COALESCE(t.effective_date, t.date)::date), 'YYYY-MM') AS month,
      COALESCE(SUM(
        CASE WHEN t.direction = 'inflow'
             THEN  t.amount::numeric
             ELSE -t.amount::numeric END
      ), 0)                                                                  AS net_amount
    -- Ver transaction_lines na migration 0026: com rateio, cada parte entra
    -- com o seu valor e as suas dimensões; sem rateio, a linha de hoje.
    FROM transaction_lines t
    JOIN categories c ON t.category_id = c.id
    JOIN categories p ON c.parent_id   = p.id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND COALESCE(t.effective_date, t.date)::date >= ${from}::date
      AND COALESCE(t.effective_date, t.date)::date <= ${to}::date
      AND c.type NOT IN (${sql.raw(BP_TYPES.map(t => `'${t}'`).join(', '))})
      ${filtroDeVisibilidade('c', 'hide_in_cashflow')}
      ${dimFilters}
    GROUP BY
      c.id, c.name, c.code,
      c.parent_id, p.name, p.code, p.opex_capex,
      DATE_TRUNC('month', COALESCE(t.effective_date, t.date)::date)
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
