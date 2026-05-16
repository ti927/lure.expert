import * as XLSX from 'xlsx'

export type StagingRow = {
  rowIndex: number
  rawData: Record<string, unknown>
  date: string | null
  amount: number | null
  direction: 'inflow' | 'outflow' | null
  description: string | null
}

export type ParseResult = {
  rows: StagingRow[]
  columnMap: {
    date: string | null
    amount: string | null
    credit: string | null
    debit: string | null
    description: string | null
  }
  warnings: string[]
}

// heurísticas de nome de coluna — ordem define prioridade
const DATE_PATTERNS = /^(data|date|dt|data_lanc|data_mov|vencimento|competencia|lancamento|emissao|baixa)/i
const AMOUNT_PATTERNS = /^(valor|value|amount|vlr|vl_|montante|quantia)/i
const CREDIT_PATTERNS = /^(credito|crédito|entrada|receita|credit|in|cr\b)/i
const DEBIT_PATTERNS = /^(debito|débito|saida|saída|despesa|debit|out|db\b)/i
const DESC_PATTERNS = /^(descri|historico|histórico|memo|obs|narra|complemento|detail|lancamento|lançamento)/i

function matchColumn(headers: string[], pattern: RegExp): string | null {
  return headers.find(h => pattern.test(h.trim())) ?? null
}

function parseAmount(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') return raw
  const str = String(raw)
    .replace(/[R$\s]/g, '')
    .replace(/\./g, '')   // milhar BR
    .replace(',', '.')    // decimal BR
  const n = parseFloat(str)
  return isNaN(n) ? null : n
}

function parseDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  // Excel serial number
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw)
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const str = String(raw).trim()
  // DD/MM/YYYY ou DD-MM-YYYY
  const dmY = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (dmY) {
    const [, d, m, y] = dmY
    const year = y.length === 2 ? `20${y}` : y
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // YYYY-MM-DD (já ISO)
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10)
  return str || null
}

export function parseExcelOrCsv(buffer: Buffer, mimeType: string): ParseResult {
  const warnings: string[] = []

  const wb = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    raw: true,
  })

  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    return { rows: [], columnMap: { date: null, amount: null, credit: null, debit: null, description: null }, warnings: ['Arquivo sem planilha'] }
  }

  const ws = wb.Sheets[sheetName]
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true })

  if (raw.length === 0) {
    return { rows: [], columnMap: { date: null, amount: null, credit: null, debit: null, description: null }, warnings: ['Planilha vazia'] }
  }

  const headers = Object.keys(raw[0])
  const colDate = matchColumn(headers, DATE_PATTERNS)
  const colAmount = matchColumn(headers, AMOUNT_PATTERNS)
  const colCredit = matchColumn(headers, CREDIT_PATTERNS)
  const colDebit = matchColumn(headers, DEBIT_PATTERNS)
  const colDesc = matchColumn(headers, DESC_PATTERNS)

  const columnMap = { date: colDate, amount: colAmount, credit: colCredit, debit: colDebit, description: colDesc }

  if (!colDate) warnings.push('Coluna de data não identificada automaticamente')
  if (!colAmount && !colCredit && !colDebit) warnings.push('Coluna de valor não identificada automaticamente')

  const rows: StagingRow[] = raw.map((row, i) => {
    const rawData = { ...row } as Record<string, unknown>

    const date = colDate ? parseDate(row[colDate]) : null
    const description = colDesc ? String(row[colDesc] ?? '').trim() || null : null

    let amount: number | null = null
    let direction: 'inflow' | 'outflow' | null = null

    if (colCredit && colDebit) {
      // colunas separadas: crédito e débito
      const cr = parseAmount(row[colCredit])
      const db = parseAmount(row[colDebit])
      if (cr && cr !== 0) { amount = Math.abs(cr); direction = 'inflow' }
      else if (db && db !== 0) { amount = Math.abs(db); direction = 'outflow' }
    } else if (colAmount) {
      // coluna única: sinal determina direção
      const v = parseAmount(row[colAmount])
      if (v !== null) {
        amount = Math.abs(v)
        direction = v >= 0 ? 'inflow' : 'outflow'
      }
    }

    return { rowIndex: i, rawData, date, amount, direction, description }
  })

  return { rows, columnMap, warnings }
}
