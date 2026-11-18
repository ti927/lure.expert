// Formatação compartilhada pela aba Quadro de pessoal e seus diálogos.
// Pura: sem React, sem servidor.

import type { Componente, Vinculo } from '@/lib/payroll-types'

export const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const MESES_LONGOS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

export const inputCls =
  'w-full h-8 rounded-md border border-input px-2 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50'

/** Centavos → "1.234,56". */
export function fmtCentavos(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Número → texto de campo ("5,8"), sem casas inúteis. */
export function numParaCampo(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  return String(n).replace('.', ',')
}

/**
 * Os meses em que a pessoa é lançada: faixa contínua vira "jan–dez", lista
 * salteada vira "jan, fev, out".
 */
export function rotuloMeses(p: { mesEntrada: number; mesSaida: number; mesesPj: number[] | null; vinculo: Vinculo }): string {
  const meses = p.vinculo === 'pj' && p.mesesPj
    ? [...p.mesesPj].filter(m => m >= p.mesEntrada && m <= p.mesSaida).sort((a, b) => a - b)
    : Array.from({ length: p.mesSaida - p.mesEntrada + 1 }, (_, i) => p.mesEntrada + i)
  if (meses.length === 0) return '—'
  if (meses.length === 1) return MESES_CURTOS[meses[0] - 1]
  const continuo = meses.every((m, i) => i === 0 || m === meses[i - 1] + 1)
  if (continuo) return `${MESES_CURTOS[meses[0] - 1]}–${MESES_CURTOS[meses[meses.length - 1] - 1]}`
  return meses.map(m => MESES_CURTOS[m - 1]).join(', ')
}

/** Os componentes que um vínculo produz — o que faz sentido sobrepor na pessoa. */
export const COMPONENTES_DO_VINCULO: Record<Vinculo, Componente[]> = {
  clt: [
    'salario', 'outros_proventos', 'inss_patronal', 'fgts', 'decimo_terceiro', 'terco_ferias',
    'encargos_13_ferias', 'beneficios',
  ],
  pro_labore: ['pro_labore', 'inss_pro_labore', 'beneficios'],
  estagio: ['bolsa_estagio', 'beneficios'],
  pj: ['honorario_pj', 'beneficios'],
}

export const ROTULO_VALOR_BASE: Record<Vinculo, string> = {
  clt: 'Salário (R$/mês)',
  pro_labore: 'Pró-labore (R$/mês)',
  estagio: 'Bolsa (R$/mês)',
  pj: 'Honorário (R$/mês)',
}
