// Expansão da recorrência do orçamento — FUNÇÕES PURAS, sem 'use server'.
//
// Ser puro não é estética: é o que permite o dialog de criação renderizar o
// preview das 12 ocorrências ao vivo, antes de salvar. Sem isso, os quatro modos
// de valor são incompreensíveis para quem está preenchendo o formulário.
//
// Toda aritmética de data é feita em UTC ou em componentes numéricos — nunca
// com `new Date('YYYY-MM-DD')` interpretado no fuso local, que já causou bug de
// deslocamento de mês neste projeto (ver generateMonthRange, UTC-3).

import type { AmountMode, EntryDraft } from './budget-types'
import { monthLabel } from './format'

export interface RecurrenceInput {
  startMonth:      string   // 'YYYY-MM'
  occurrences:     number
  intervalMonths:  number
  dayOfMonth:      number
  cashLagDays:     number
  amountMode:      AmountMode
  baseAmount:      number | null
  totalAmount:     number | null
  adjustmentRate:  number | null   // fração decimal: 0.05 = 5%
  adjustmentEvery: number          // conta OCORRÊNCIAS, não meses
  seasonalAmounts: number[] | null // em ordem de sequência, length === occurrences
}

// ─── Helpers de data ──────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

export function lastDayOfMonth(year: number, month: number): number {
  // Dia 0 do mês seguinte = último dia deste mês. Em UTC para não escorregar de fuso.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Mês de competência da ocorrência `sequence` (1-based), no formato 'YYYY-MM'. */
export function occurrenceMonth(startMonth: string, intervalMonths: number, sequence: number): string {
  const [year, month] = startMonth.split('-').map(Number)
  const absolute = (month - 1) + (sequence - 1) * intervalMonths
  const y = year + Math.floor(absolute / 12)
  const m = (absolute % 12) + 1
  return `${y}-${pad(m)}`
}

/** Todos os meses de competência da série, em ordem. */
export function occurrenceMonths(input: Pick<RecurrenceInput, 'startMonth' | 'intervalMonths' | 'occurrences'>): string[] {
  return Array.from({ length: input.occurrences }, (_, i) =>
    occurrenceMonth(input.startMonth, input.intervalMonths, i + 1),
  )
}

// ─── Valor ────────────────────────────────────────────────────────────────────

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Valor de cada ocorrência, em ordem de sequência.
 *
 * `parcelado` divide em centavos e joga a sobra na ÚLTIMA parcela — a soma bate
 * exatamente com o total. `reajuste` é sempre calculado a partir de `baseAmount`,
 * nunca iterativamente sobre o valor arredondado anterior (evita drift).
 */
export function occurrenceAmounts(input: RecurrenceInput): number[] {
  const n = input.occurrences

  switch (input.amountMode) {
    case 'fixo': {
      const base = round2(input.baseAmount ?? 0)
      return Array.from({ length: n }, () => base)
    }

    case 'reajuste': {
      const base = input.baseAmount ?? 0
      const rate = input.adjustmentRate ?? 0
      const every = Math.max(1, input.adjustmentEvery)
      return Array.from({ length: n }, (_, i) =>
        round2(base * Math.pow(1 + rate, Math.floor(i / every))),
      )
    }

    case 'sazonal': {
      const values = input.seasonalAmounts ?? []
      return Array.from({ length: n }, (_, i) => round2(values[i] ?? 0))
    }

    case 'parcelado': {
      const totalCents = Math.round((input.totalAmount ?? 0) * 100)
      const perCents = Math.floor(totalCents / n)
      return Array.from({ length: n }, (_, i) =>
        i === n - 1 ? (totalCents - perCents * (n - 1)) / 100 : perCents / 100,
      )
    }
  }
}

// ─── Expansão ─────────────────────────────────────────────────────────────────

/**
 * Materializa as ocorrências da série.
 *
 * `competenceDate` = startMonth + (i−1) × intervalMonths, no `dayOfMonth`
 * clampado ao último dia do mês (31 em fevereiro vira 28/29).
 * `cashDate` = competenceDate + cashLagDays.
 */
export function expandSeries(input: RecurrenceInput): EntryDraft[] {
  const amounts = occurrenceAmounts(input)

  return Array.from({ length: input.occurrences }, (_, i) => {
    const sequence = i + 1
    const month = occurrenceMonth(input.startMonth, input.intervalMonths, sequence)
    const [y, m] = month.split('-').map(Number)
    const day = Math.min(input.dayOfMonth, lastDayOfMonth(y, m))
    const competenceDate = `${month}-${pad(day)}`

    return {
      sequence,
      competenceDate,
      cashDate: input.cashLagDays === 0 ? competenceDate : addDaysIso(competenceDate, input.cashLagDays),
      amount: amounts[i],
    }
  })
}

/** Total do ano segundo a REGRA. A UI exibe sempre o total das entries — use com cuidado. */
export function seriesRuleTotal(input: RecurrenceInput): number {
  return round2(occurrenceAmounts(input).reduce((acc, v) => acc + v, 0))
}

// ─── Validação de horizonte ───────────────────────────────────────────────────

/**
 * O exercício é o ano civil: toda ocorrência precisa ter COMPETÊNCIA dentro dele.
 *
 * `cashDate` é deliberadamente livre para vazar — competência de dez/27 com prazo
 * de 30 dias tem caixa em jan/28, e isso é a realidade, não um erro. O orçado que
 * vaza simplesmente não aparece na matriz do exercício; a tela de comparação
 * informa o total vazado no rodapé.
 */
export function fitsInFiscalYear(
  input: Pick<RecurrenceInput, 'startMonth' | 'intervalMonths' | 'occurrences'>,
  fiscalYear: number,
): { ok: true } | { ok: false; message: string } {
  const months = occurrenceMonths(input)
  const first = months[0]
  const last = months[months.length - 1]

  if (Number(first.slice(0, 4)) !== fiscalYear) {
    return { ok: false, message: `O mês inicial precisa estar dentro do exercício de ${fiscalYear}.` }
  }
  if (Number(last.slice(0, 4)) !== fiscalYear) {
    return {
      ok: false,
      message: `A última ocorrência cai em ${monthLabel(last)}, fora do exercício de ${fiscalYear}. Reduza a quantidade ou a periodicidade.`,
    }
  }
  return { ok: true }
}
