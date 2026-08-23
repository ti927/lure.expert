// Pós-processamento do resultado do motor.
//
// O que mora aqui NÃO é SQL: é o que se calcula depois, em memória, a partir
// das linhas agregadas. A cascata do P&L é o caso principal — receita líquida,
// lucro bruto, EBITDA e lucro líquido não são somas de categoria, são somas de
// subtotais anteriores, e `computeSubtotals` já sabe fazer isso desde a Fase 5.
//
// Ela não entra no motor de propósito: o motor devolve linha agregada, e a
// cascata é uma leitura da DRE sobre essas linhas. Misturar as duas obrigaria
// o SQL a conhecer a ordem das seções do P&L.

import { computeSubtotals, generateMonthRange, type SubtotalRow } from '@/lib/dre-calc'
import type { DreType } from '@/lib/dre-types'
import type { DreMonthSubtotals } from '@/lib/dre-types'
import { QueryValidationError } from './errors'
import type { QueryResult } from './spec'

/**
 * Converte o resultado do motor na cascata do P&L, mês a mês.
 *
 * Exige que a consulta tenha agrupado por `tipo` e `mes` e medido
 * `valor_liquido` — é a forma mínima de onde a cascata se deduz. Recusar com
 * mensagem é melhor que devolver zeros: o modelo corrige a spec e tenta de novo.
 */
export function withSubtotals(resultado: QueryResult): DreMonthSubtotals[] {
  const temTipo = resultado.agruparPor.includes('tipo')
  const temMes  = resultado.agruparPor.includes('mes')
  const temValor = resultado.medidas.includes('valor_liquido')

  if (!temTipo || !temMes || !temValor) {
    throw new QueryValidationError('spec',
      'A cascata do P&L exige agruparPor ["tipo","mes"] e a medida "valor_liquido". ' +
      `Recebi agruparPor [${resultado.agruparPor.join(', ')}] e medidas [${resultado.medidas.join(', ')}].`)
  }

  const linhas: SubtotalRow[] = resultado.linhas
    .map(l => {
      const tipo = l.chaves.find(k => k.campo === 'tipo')?.id
      const mes  = l.chaves.find(k => k.campo === 'mes')?.id
      // Linha sem tipo é lançamento sem natureza: entra no total do extrato,
      // mas não tem seção do P&L onde cair.
      if (!tipo || !mes) return null
      return { month: mes, categoryType: tipo as DreType, netAmount: l.medidas.valor_liquido }
    })
    .filter((x): x is SubtotalRow => x !== null)

  const meses = 'de' in resultado.periodo
    ? generateMonthRange(resultado.periodo.de, resultado.periodo.ate)
    : Array.from(new Set(linhas.map(l => l.month))).sort()

  return meses.map(m => computeSubtotals(m, linhas))
}

/**
 * Quanto do resultado ficou fora da cascata por não ter natureza.
 *
 * Existe porque a soma da cascata pode não fechar com o extrato, e o motivo
 * precisa ser dizível — silêncio aqui vira "a DRE está errada".
 */
export function semNatureza(resultado: QueryResult): { linhas: number; valor: number } {
  const soltas = resultado.linhas.filter(l =>
    l.chaves.some(k => (k.campo === 'tipo' || k.campo === 'categoria') && k.id === null))
  return {
    linhas: soltas.length,
    valor:  soltas.reduce((a, l) => a + (l.medidas.valor_liquido ?? 0), 0),
  }
}
