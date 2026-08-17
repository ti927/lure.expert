// Fragmentos SQL de filtro por dimensão (centro de custo, unidade de negócio,
// entidade legal), compartilhados por `dre.ts`, `fluxo-mensal.ts` e `budget.ts`.
//
// Sem `'use server'` (a diretiva só permite exportar funções async); é
// server-only por convenção, como `src/lib/categorizer.ts`.
//
// SEGURANÇA: `alias` é um union literal fechado, nunca string livre — é o único
// pedaço que entra via `sql.raw`. Os ids continuam parametrizados.

import { sql, type SQL } from 'drizzle-orm'

/** 't' = transactions (realizado) · 'e' = budget_entries (orçado) */
export type DimensionAlias = 't' | 'e'

export interface DimensionFilterInput {
  costCenterIds?:   string[]
  businessUnitIds?: string[]
  legalEntityIds?:  string[]
}

function inFilter(alias: DimensionAlias, column: string, ids: string[] | undefined): SQL {
  if (!ids?.length) return sql``
  return sql`AND ${sql.raw(`${alias}.${column}`)} IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})`
}

/**
 * Cláusulas `AND ... IN (...)` para as três dimensões, ou vazio quando nenhuma
 * está filtrada. O filtro precisa ser aplicado de forma SIMÉTRICA nos dois lados
 * de uma comparação orçado × realizado — filtrar só um lado infla a variação.
 */
export function dimensionFilters(alias: DimensionAlias, f: DimensionFilterInput): SQL {
  return sql`
    ${inFilter(alias, 'cost_center_id',   f.costCenterIds)}
    ${inFilter(alias, 'business_unit_id', f.businessUnitIds)}
    ${inFilter(alias, 'legal_entity_id',  f.legalEntityIds)}
  `
}
