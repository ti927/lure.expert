// Formatação PT-BR compartilhada por server e client. Sem 'use server'.

export const PT_MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

/** 'YYYY-MM' → 'Mar/27'. Aceita também 'YYYY-MM-DD'. */
export function monthLabel(month: string): string {
  const [y, m] = month.slice(0, 7).split('-').map(Number)
  return `${PT_MONTHS_SHORT[m - 1]}/${String(y).slice(2)}`
}

/** 'YYYY-MM-DD' → '05/03/2027'. Sem `new Date`, para não escorregar de fuso. */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const NUM = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const MONEY = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Número inteiro com separador de milhar — o formato das matrizes de 12 meses. */
export function fmtNum(value: number): string {
  return NUM.format(value)
}

/** Valor com centavos, sem símbolo. Use quando a coluna já diz "R$". */
export function fmtMoney(value: number): string {
  return MONEY.format(value)
}

/** Valor com centavos e símbolo. */
export function fmtBRL(value: number): string {
  return `R$ ${MONEY.format(value)}`
}
