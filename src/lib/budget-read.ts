// Leitura agregada do orçado — a query que a comparação e a DRE compartilham.
//
// Extraída de `getBudgetVsActual` na sessão 9.7. O motivo de existir não é
// economia de linhas: a conciliação verificada na sessão 9.2 (o orçado da aba
// Orçado × Realizado bate célula a célula com a DRE) só continua valendo se as
// duas telas lerem pela MESMA query. Uma segunda query "parecida" divergiria no
// primeiro filtro que alguém esquecesse de replicar.
//
// SERVER-ONLY: importa `db`. A UI recebe os tipos por `budget-types.ts`.

import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { BP_TYPES, type DreType } from './dre-types'
import { dimensionFilters, type DimensionFilterInput } from './sql-dimensions'
import { filtroDeVisibilidade, campoDoRegime } from './category-visibility'
import type { BudgetRegime } from './budget-types'

const BP_LIST = sql.raw(BP_TYPES.map(t => `'${t}'`).join(', '))

/** `db` ou uma transação — mesma razão do `BudgetReader` de `budget-copy.ts`. */
export type BudgetReader = Pick<typeof db, 'execute'>

/**
 * Uma linha do orçado agregada por categoria e mês.
 *
 * Satisfaz `BlockSourceRow` de `dre-layout.ts` estruturalmente, o que permite
 * jogar direto em `buildBlocks` sem adaptador.
 */
export interface BudgetPeriodRow {
  categoryId:   string
  categoryName: string
  categoryCode: string
  categoryType: DreType
  parentId:     string
  parentName:   string
  parentCode:   string
  month:        string   // YYYY-MM
  /** Convenção `netAmount`: entrada positiva, saída negativa. */
  orcado:       number
}

export interface BudgetPeriodFilters extends DimensionFilterInput {
  organizationId: string
  versionId:      string
  regime:         BudgetRegime
  from:           string   // YYYY-MM-DD
  to:             string   // YYYY-MM-DD
}

/**
 * O orçado do período, agregado por categoria e mês.
 *
 * Espelha as regras do lado realizado: mesmo INNER JOIN em `categories` e no pai
 * (o que garante folha), mesma exclusão de `BP_TYPES` e a coluna de visibilidade
 * do regime. Os filtros de dimensão entram pelo mesmo `dimensionFilters` que a
 * DRE usa — aplicar em um lado só é o que faz a variação mentir.
 */
export async function fetchBudgetRows(
  client: BudgetReader,
  f: BudgetPeriodFilters,
): Promise<BudgetPeriodRow[]> {
  const budgetDate = f.regime === 'caixa' ? sql`e.cash_date` : sql`e.competence_date`
  // Herda do pai desde 26/ago — ver `lib/category-visibility.ts`. O orçado tem
  // de esconder exatamente o mesmo conjunto que o realizado, senão a variação
  // compara uma categoria contra o vazio.
  const filtroVis  = filtroDeVisibilidade('c', campoDoRegime(f.regime))
  const dims       = dimensionFilters('e', f)

  type Row = {
    category_id:   string
    category_name: string
    category_code: string
    category_type: string
    parent_id:     string
    parent_name:   string
    parent_code:   string
    month:         string
    value:         string
  }

  const rows = await client.execute<Row>(sql`
    SELECT
      c.id::text        AS category_id,
      c.name            AS category_name,
      c.code            AS category_code,
      c.type            AS category_type,
      c.parent_id::text AS parent_id,
      p.name            AS parent_name,
      p.code            AS parent_code,
      TO_CHAR(DATE_TRUNC('month', ${budgetDate}::date), 'YYYY-MM') AS month,
      COALESCE(SUM(
        CASE WHEN e.direction = 'inflow'
             THEN  e.amount::numeric
             ELSE -e.amount::numeric END
      ), 0) AS value
    FROM budget_entries e
    JOIN categories c ON e.category_id = c.id
    JOIN categories p ON c.parent_id   = p.id
    WHERE e.organization_id = ${f.organizationId}::uuid
      AND e.version_id      = ${f.versionId}::uuid
      AND ${budgetDate}::date >= ${f.from}::date
      AND ${budgetDate}::date <= ${f.to}::date
      AND c.type NOT IN (${BP_LIST})
      ${filtroVis}
      ${dims}
    GROUP BY c.id, c.name, c.code, c.type, c.parent_id, p.name, p.code,
             DATE_TRUNC('month', ${budgetDate}::date)
  `)

  return rows.map(r => ({
    categoryId:   r.category_id,
    categoryName: r.category_name,
    categoryCode: r.category_code,
    categoryType: r.category_type as DreType,
    parentId:     r.parent_id,
    parentName:   r.parent_name,
    parentCode:   r.parent_code,
    month:        r.month,
    orcado:       Number(r.value),
  }))
}

/**
 * Orçado cuja data, no regime escolhido, cai FORA do período — a cauda de caixa.
 *
 * Competência de dez com prazo de 30 dias tem caixa em jan do ano seguinte, e
 * isso é a realidade, não um erro. O valor não aparece na matriz; declarar o
 * total é o que impede o rodapé de mentir por omissão.
 */
export async function fetchForaDoHorizonte(
  client: BudgetReader,
  f: BudgetPeriodFilters,
): Promise<{ total: number; count: number }> {
  const budgetDate = f.regime === 'caixa' ? sql`e.cash_date` : sql`e.competence_date`
  const dims       = dimensionFilters('e', f)

  const [row] = await client.execute<{ total: string; count: number }>(sql`
    SELECT
      COALESCE(SUM(e.amount::numeric), 0) AS total,
      COUNT(*)::int                       AS count
    FROM budget_entries e
    WHERE e.organization_id = ${f.organizationId}::uuid
      AND e.version_id      = ${f.versionId}::uuid
      AND (${budgetDate}::date < ${f.from}::date OR ${budgetDate}::date > ${f.to}::date)
      ${dims}
  `)

  return { total: Number(row?.total ?? 0), count: Number(row?.count ?? 0) }
}
