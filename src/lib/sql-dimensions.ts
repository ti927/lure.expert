// Fragmentos SQL de filtro por dimensão (centro de custo, unidade de negócio,
// entidade legal, contato), compartilhados por `dre.ts`, `fluxo-mensal.ts` e
// `budget.ts`.
//
// Sem `'use server'` (a diretiva só permite exportar funções async); é
// server-only por convenção, como `src/lib/categorizer.ts`.
//
// SEGURANÇA: `alias` é um union literal fechado, nunca string livre — é o único
// pedaço que entra via `sql.raw`. Os ids continuam parametrizados.

import { sql, type SQL } from 'drizzle-orm'
// O sentinela vive em `dre-types.ts` porque cliente e servidor precisam do
// mesmo valor: `DimFilter` o emite, este arquivo o traduz para `IS NULL`.
import { DIM_NONE } from './dre-types'

/** 't' = transactions (realizado) · 'e' = budget_entries (orçado) */
export type DimensionAlias = 't' | 'e'

export interface DimensionFilterInput {
  costCenterIds?:   string[]
  businessUnitIds?: string[]
  legalEntityIds?:  string[]
  contactIds?:      string[]
}

function inFilter(alias: DimensionAlias, column: string, ids: string[] | undefined): SQL {
  if (!ids?.length) return sql``

  const col     = sql.raw(`${alias}.${column}`)
  const uuids   = ids.filter(id => id !== DIM_NONE)
  const wantsNull = ids.length !== uuids.length

  // Só "Sem <dimensão>": nenhum IN, apenas o teste de nulo.
  if (!uuids.length) return sql`AND ${col} IS NULL`

  const inList = sql`${col} IN (${sql.join(uuids.map(id => sql`${id}::uuid`), sql`, `)})`

  // "Sem <dimensão>" combinado com valores concretos vira uma disjunção — sem
  // ela, marcar os dois devolveria só os classificados.
  return wantsNull ? sql`AND (${inList} OR ${col} IS NULL)` : sql`AND ${inList}`
}

/**
 * Cláusulas `AND ... IN (...)` para as quatro dimensões, ou vazio quando nenhuma
 * está filtrada. O filtro precisa ser aplicado de forma SIMÉTRICA nos dois lados
 * de uma comparação orçado × realizado — filtrar só um lado infla a variação.
 */
export function dimensionFilters(alias: DimensionAlias, f: DimensionFilterInput): SQL {
  return sql`
    ${inFilter(alias, 'cost_center_id',   f.costCenterIds)}
    ${inFilter(alias, 'business_unit_id', f.businessUnitIds)}
    ${inFilter(alias, 'legal_entity_id',  f.legalEntityIds)}
    ${inFilter(alias, 'contact_id',       f.contactIds)}
  `
}

/** As quatro colunas de dimensão, como union fechado — o que entra via `sql.raw`. */
export type DimensionColumn =
  | 'cost_center_id' | 'business_unit_id' | 'legal_entity_id' | 'contact_id'

export interface MultiFilter {
  ids: string[]
  includeNone: boolean
  includeClassified: boolean
}

/**
 * Filtro de dimensão para as telas que listam **lançamentos**, não linhas:
 * `/transacoes` e a fila de revisão. Elas continuam mostrando uma linha por
 * lançamento, então não podem ler a view — mas o filtro precisa enxergar o
 * rateio.
 *
 * Por que não basta testar a coluna do lançamento: num lançamento rateado ela é
 * sempre nula (regra da migration 0026). Filtrar por "Comercial" pela coluna
 * esconderia justamente o lançamento rateado para Comercial, e "Sem centro de
 * custo" pegaria TODO lançamento rateado, inclusive os com todas as partes
 * classificadas.
 *
 * A pergunta certa é sobre as linhas do lançamento: *existe alguma linha dele
 * que satisfaz o filtro?* — e é exatamente isso que a view responde, com ou sem
 * rateio, por um caminho só.
 */
export function dimensionExistsFilter(
  txIdColumn: SQL | { name: string },
  column: DimensionColumn,
  f: MultiFilter,
): SQL | null {
  if (!f.includeNone && !f.includeClassified && f.ids.length === 0) return null

  const col = sql.raw(`tl.${column}`)
  const preds: SQL[] = []
  if (f.includeNone)       preds.push(sql`${col} IS NULL`)
  if (f.includeClassified) preds.push(sql`${col} IS NOT NULL`)
  if (f.ids.length > 0) {
    preds.push(sql`${col} IN (${sql.join(f.ids.map(id => sql`${id}::uuid`), sql`, `)})`)
  }

  return sql`EXISTS (
    SELECT 1 FROM transaction_lines tl
    WHERE tl.transaction_id = ${txIdColumn}
      AND (${sql.join(preds, sql` OR `)})
  )`
}
