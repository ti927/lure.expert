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

const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** '30,3%' — sem sinal. Para proporções, como a análise vertical da DRE. */
export function fmtPct(value: number): string {
  return `${PCT.format(value)}%`
}

/** '+28,8%' — com sinal explícito. Para variações, onde a direção é o recado. */
export function fmtPctSigned(value: number): string {
  return `${value > 0 ? '+' : ''}${PCT.format(value)}%`
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

/**
 * Minúsculo, sem acento, espaços colapsados — para casar texto digitado com
 * cadastro.
 *
 * Movida de `budget-import.ts`, que passou a importar daqui. **Não unifique com
 * `normalizeForMatch` de `categorizer.ts`:** aquela decide classificação, e
 * mexer nela mudaria retroativamente o resultado de `findCategoryByCsvMapping`.
 * Duas funções parecidas com donos diferentes é mais barato que uma com dois.
 */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const MESES_PT: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
}

/**
 * Texto de planilha → data ISO `AAAA-MM-DD`. `null` quando não dá para ler.
 *
 * Movida de `parsers/excel-csv.ts` (onde se chamava `normalizeDate`) pelo mesmo
 * motivo que `parseAmount` foi movida na 9.5, e que está escrito ali em cima: o
 * arquivo de origem carrega o SDK da Anthropic junto, e quem precisa desta
 * função — o contrato de importação — não pode arrastar isso.
 *
 * Comportamento inalterado: ISO, DD/MM/AAAA (com `/`, `.` ou `-`), DD/MM/AA
 * assumindo 20AA, "02 jan." usando o ano corrente, e serial do Excel.
 */
export function parseDate(s: string | undefined | null): string | null {
  if (!s) return null
  const v = String(s).trim()
  if (!v) return null

  // AAAA-MM-DD
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`

  // DD/MM/AAAA, DD-MM-AAAA, DD.MM.AAAA
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`

  // DD/MM/AA → assume 20AA
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/)
  if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`

  // "02 jan." ou "31 jul" — usa o ano corrente
  m = v.match(/^(\d{1,2})\s+([a-zç]+)\.?$/i)
  if (m) {
    const mes = MESES_PT[m[2].toLowerCase().slice(0, 3)]
    if (mes) {
      const ano = new Date().getFullYear()
      return `${ano}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`
    }
  }

  // Serial do Excel (o `raw=false` já deveria ter convertido; isto é a rede)
  const num = Number(v)
  if (!Number.isNaN(num) && num > 25569 && num < 60000) {
    const d = new Date(Date.UTC(1900, 0, 1) + (num - 2) * 86400000)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }

  return null
}
