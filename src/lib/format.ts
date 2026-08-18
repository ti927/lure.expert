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

/**
 * Texto de planilha → número. `null` quando não dá para ler.
 *
 * Movido de `parsers/excel-csv.ts` na sessão 9.5, sem alteração de comportamento
 * — o import de orçamento seria a segunda cópia, e o arquivo de origem carrega
 * o SDK da Anthropic junto.
 *
 * Trata parênteses e prefixo como negativo, remove R$/espaços/+, e desambigua
 * BR (1.234,56) de US (1,234.56) pela posição do último separador.
 */
export function parseAmount(s: string | undefined | null): number | null {
  if (s === null || s === undefined) return null
  let v = String(s).trim()
  if (!v) return null

  let negative = false
  if (v.startsWith('(') && v.endsWith(')')) {
    negative = true
    v = v.slice(1, -1).trim()
  }
  if (v.startsWith('-')) {
    negative = true
    v = v.slice(1).trim()
  }

  v = v.replace(/R\$\s*/g, '').replace(/[+\s]/g, '')

  const hasComma = v.includes(',')
  const hasDot = v.includes('.')
  if (hasComma && hasDot) {
    if (v.lastIndexOf(',') > v.lastIndexOf('.')) {
      // BR: 1.234,56
      v = v.replace(/\./g, '').replace(',', '.')
    } else {
      // US: 1,234.56
      v = v.replace(/,/g, '')
    }
  } else if (hasComma) {
    v = v.replace(',', '.')
  }
  // só ponto → assume decimal (não mexe)

  const n = Number(v)
  if (Number.isNaN(n)) return null
  const abs = Math.abs(n)
  return negative ? -abs : abs
}
