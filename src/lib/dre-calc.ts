// Cálculo da cascata da DRE e geração da grade de meses — FUNÇÕES PURAS.
//
// Extraído de `src/server/dre.ts` e `src/server/fluxo-mensal.ts`, onde eram
// privadas e duplicadas. Precisam viver fora de um arquivo `'use server'` por
// duas razões: essa diretiva só permite exportar funções async, e a coluna
// "Projeção do ano" do módulo de Orçamento roda `computeSubtotals` no cliente.

import type { DreType, DreMonthSubtotals } from './dre-types'

/**
 * Forma mínima que a cascata precisa. `DreCategoryRow` a satisfaz
 * estruturalmente; o orçamento passa projeções (orçado / realizado / misto)
 * sem precisar fabricar os campos que não usa.
 */
export interface SubtotalRow {
  month:        string
  categoryType: DreType
  netAmount:    number
}

/** Meses 'YYYY-MM' de `from` até `to`, inclusive — mesmo os sem dado. */
export function generateMonthRange(from: string, to: string): string[] {
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

export function sumByTypes(month: string, rows: readonly SubtotalRow[], types: DreType[]): number {
  return rows
    .filter(r => r.month === month && types.includes(r.categoryType))
    .reduce((acc, r) => acc + r.netAmount, 0)
}

/**
 * A cascata do P&L de um mês.
 *
 * Depende da convenção de sinal do projeto: `netAmount` já vem com sinal
 * (receita positiva, custo/despesa negativo), por isso os encadeamentos são
 * todos somas.
 */
export function computeSubtotals(month: string, rows: readonly SubtotalRow[]): DreMonthSubtotals {
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
