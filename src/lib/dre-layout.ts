// Layout da cascata da DRE e montagem da árvore Tipo → Pai → Filho.
//
// Extraído de `dre-client.tsx`, onde era privado. A tela de Orçado × Realizado
// precisa exatamente da mesma cascata e da mesma árvore, com a diferença de que
// cada célula guarda dois números em vez de um — daí `buildBlocks` ser genérico
// no valor da célula.

import type { DreType, DreMonthSubtotals } from './dre-types'

export type SubtotalNumericKey = Exclude<keyof DreMonthSubtotals, 'month'>

export interface LayoutSection {
  types: DreType[]
  subtotalKey: SubtotalNumericKey
  subtotalLabel: string
  keyMetric?: boolean
}

/** As seções do P&L, cada uma fechada pelo subtotal que ela produz. */
export const LAYOUT: LayoutSection[] = [
  { types: ['receita_operacional'], subtotalKey: 'receitaBruta', subtotalLabel: 'Receita Bruta' },
  { types: ['deducoes_tributarias', 'deducoes_operacionais'], subtotalKey: 'receitaLiquida', subtotalLabel: 'Receita Líquida' },
  { types: ['cpv'], subtotalKey: 'lucroBruto', subtotalLabel: 'Lucro Bruto' },
  { types: ['sga'], subtotalKey: 'ebitda', subtotalLabel: 'EBITDA' },
  { types: ['resultado_financeiro'], subtotalKey: 'lair', subtotalLabel: 'LAIR' },
  { types: ['ir'], subtotalKey: 'lucroLiquido', subtotalLabel: 'Lucro Líquido', keyMetric: true },
]

/** Abaixo da linha: financiamento, investimento e transitórios. */
export const BELOW_LAYOUT: LayoutSection = {
  types: ['emprestimos_amortizacoes', 'investimentos_retiradas', 'transfer'],
  subtotalKey: 'variacaoCaixa',
  subtotalLabel: 'Variação de Caixa',
}

// ─── Árvore ───────────────────────────────────────────────────────────────────

export interface ChildNode<V> {
  categoryId: string
  categoryName: string
  categoryCode: string
  byMonth: Record<string, V>
}

export interface ParentNode<V> {
  parentId: string
  parentName: string
  parentCode: string
  children: ChildNode<V>[]
}

export interface SectionBlock<V> {
  type: DreType
  parents: ParentNode<V>[]
}

/** Campos mínimos que uma linha precisa ter para virar árvore. */
export interface BlockSourceRow {
  categoryId: string
  categoryName: string
  categoryCode: string
  categoryType: DreType
  parentId: string
  parentName: string
  parentCode: string
  month: string
}

/**
 * Converte linhas planas (categoria × mês) na árvore Tipo → Pai → Filho.
 *
 * `pick` extrai o valor da célula: a DRE passa `r => r.netAmount`; a tela de
 * comparação passa `r => ({ orcado, realizado })`.
 */
export function buildBlocks<R extends BlockSourceRow, V>(
  rows: R[],
  types: DreType[],
  pick: (row: R) => V,
): SectionBlock<V>[] {
  return types.map(type => {
    const parentMap = new Map<string, { parent: ParentNode<V>; childMap: Map<string, ChildNode<V>> }>()

    rows.filter(r => r.categoryType === type).forEach(row => {
      if (!parentMap.has(row.parentId)) {
        parentMap.set(row.parentId, {
          parent: { parentId: row.parentId, parentName: row.parentName, parentCode: row.parentCode, children: [] },
          childMap: new Map(),
        })
      }
      const entry = parentMap.get(row.parentId)!
      if (!entry.childMap.has(row.categoryId)) {
        entry.childMap.set(row.categoryId, {
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          categoryCode: row.categoryCode,
          byMonth: {},
        })
      }
      entry.childMap.get(row.categoryId)!.byMonth[row.month] = pick(row)
    })

    const parents = Array.from(parentMap.values())
      .sort((a, b) => a.parent.parentCode.localeCompare(b.parent.parentCode))
      .map(({ parent, childMap }) => ({
        ...parent,
        children: Array.from(childMap.values())
          .sort((a, b) => a.categoryCode.localeCompare(b.categoryCode)),
      }))

    return { type, parents }
  }).filter(b => b.parents.length > 0)
}
