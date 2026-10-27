// Os filtros da tabela de lançamentos — `/transacoes` e a conferência de saldo
// (`/contas/[conta]`).
//
// Moravam dentro de `getTransactions`. A conferência precisa dos MESMOS filtros
// (é a promessa da tela: "os filtros de Transações, menos o de conta"), e duas
// cópias é como as duas telas passam a filtrar diferente sem ninguém notar.
// Fora de `'use server'` porque arquivo de server action só exporta função async.
//
// Pressupõe `documents` no FROM (por join) quando `reportType` é usado.

import { eq, gte, lte, ilike, inArray, ne, sql, type SQL } from 'drizzle-orm'
import { transactions, documents } from '@/db/schema'
import { dimensionExistsFilter } from '@/lib/sql-dimensions'

/** Multi-select da URL: "id1,id2,__none__,__classified__" → ids + sentinelas. */
export function parseMultiFilter(param: string | undefined): { ids: string[]; includeNone: boolean; includeClassified: boolean } {
  if (!param) return { ids: [], includeNone: false, includeClassified: false }
  const parts = param.split(',').map(p => p.trim()).filter(Boolean)
  return {
    includeNone: parts.includes('__none__'),
    includeClassified: parts.includes('__classified__'),
    ids: parts.filter(p => p !== '__none__' && p !== '__classified__'),
  }
}

export interface FiltrosDaListagem {
  q?: string
  from?: string
  to?: string
  direction?: string
  category?: string
  costCenter?: string
  businessUnit?: string
  legalEntity?: string
  contact?: string
  documentId?: string
  accountId?: string
  reportType?: string
  amountMin?: string
  amountMax?: string
  /** `manual` = lançado à mão (`metadata.origem`); `importado` = todo o resto. */
  origem?: string
}

/** A data de caixa: quando o dinheiro se moveu. Em branco = a competência. */
export const dataDeCaixaSql = sql`COALESCE(${transactions.effectiveDate}, ${transactions.date})`

/**
 * As condições dos filtros da URL. Não inclui organização nem status — quem
 * chama decide o universo.
 *
 * `regime` diz qual data `from`/`to` limitam: `/transacoes` filtra pela
 * competência, a conferência de saldo pela de caixa (é a data do extrato).
 */
export function condicoesDaListagem(
  f: FiltrosDaListagem,
  opcoes: { regime?: 'competencia' | 'caixa' } = {},
): SQL[] {
  const conditions: SQL[] = []
  const data = opcoes.regime === 'caixa' ? dataDeCaixaSql : sql`${transactions.date}`

  if (f.q?.trim()) conditions.push(ilike(transactions.description, `%${f.q.trim()}%`))
  if (f.from) conditions.push(sql`${data} >= ${f.from}::date`)
  if (f.to) conditions.push(sql`${data} <= ${f.to}::date`)
  if (f.direction === 'inflow' || f.direction === 'outflow') conditions.push(eq(transactions.direction, f.direction))
  if (f.amountMin) conditions.push(gte(sql`${transactions.amount}::numeric`, sql`${f.amountMin}::numeric`))
  if (f.amountMax) conditions.push(lte(sql`${transactions.amount}::numeric`, sql`${f.amountMax}::numeric`))

  // Natureza e as quatro dimensões perguntam às LINHAS do lançamento, não à
  // coluna dele: com rateio a coluna do pai é nula e a classificação vive nas
  // partes. A listagem segue sendo uma linha por lançamento — só a pergunta mudou.
  const dims = [
    ['category_id', f.category],
    ['cost_center_id', f.costCenter],
    ['business_unit_id', f.businessUnit],
    ['legal_entity_id', f.legalEntity],
    ['contact_id', f.contact],
  ] as const
  for (const [coluna, valor] of dims) {
    const filtro = dimensionExistsFilter(transactions.id, coluna, parseMultiFilter(valor))
    if (filtro) conditions.push(filtro)
  }

  const docFilter = parseMultiFilter(f.documentId)
  if (docFilter.ids.length > 0) conditions.push(inArray(transactions.documentId, docFilter.ids))

  const acctFilter = parseMultiFilter(f.accountId)
  if (acctFilter.ids.length > 0) conditions.push(inArray(transactions.accountId, acctFilter.ids))

  if (f.origem === 'manual') conditions.push(sql`${transactions.metadata}->>'origem' = 'manual'`)
  else if (f.origem === 'importado') conditions.push(sql`${transactions.metadata}->>'origem' IS DISTINCT FROM 'manual'`)

  if (f.reportType === 'balance_sheet') {
    conditions.push(eq(documents.reportType, 'balance_sheet'))
  } else if (f.reportType === 'other') {
    conditions.push(ne(documents.reportType, 'balance_sheet'))
  }

  return conditions
}
