import { parse } from 'csv-parse/sync'
import * as XLSX from 'xlsx'
import { anthropic } from '@/lib/anthropic'

export type StagingRow = {
  rowIndex: number
  rawData: Record<string, unknown>
  date: string | null
  effectiveDate: string | null
  amount: number | null
  direction: 'inflow' | 'outflow' | null
  description: string | null
}

type ColumnMapping = {
  date: number | null
  effectiveDate: number | null
  amount: number | null
  direction: number | null
  description: number | null
  amountSignIndicatesDirection: boolean
  // Índices de colunas que descrevem hierarquia/categoria do lançamento
  // (ex: Grupo, Família, Categoria, Conta Contábil, Departamento, Centro de Custo)
  // — não viram campos estruturados, mas alimentam o prompt do categorizador.
  categoryHints: number[]
}

const SYSTEM_PROMPT = `Você analisa cabeçalhos de planilhas/CSV financeiros em português e retorna o índice (0-based) de cada coluna semântica.

Retorne APENAS um objeto JSON válido, sem markdown ou explicação:
{"date": <int|null>, "effectiveDate": <int|null>, "amount": <int|null>, "direction": <int|null>, "description": <int|null>, "amountSignIndicatesDirection": <bool>, "categoryHints": <int[]>}

Regras:
- date: coluna de competência — quando o evento ocorreu (ex: "Data", "Data da NF", "Data da compra", "Vencimento", "Emissão", "Lançamento").
- effectiveDate: coluna de caixa — quando o dinheiro se moveu (ex: "Data Pagamento", "Crédito", "Débito", "Liquidação"). Se não existir, retorne null (NÃO repita date).
- amount: coluna de valor monetário (ex: "Valor", "Total", "Bruto", "Líquido", "Montante", "VLR").
- direction: coluna que indica se é entrada/saída (ex: "Tipo", "Natureza", "C/D", "Entrada/Saída"). Se não houver coluna explícita, retorne null.
- amountSignIndicatesDirection: true se os valores de amount podem vir negativos (= saída) ou positivos (= entrada). Olhe as amostras pra decidir.
- description: coluna identificadora da transação (ex: "Descrição", "Histórico", "Produto", "Lançamento", "Obs"). Se houver várias candidatas (ex: produto + cliente), escolha a MAIS DESCRITIVA.
- categoryHints: lista de índices de colunas que descrevem HIERARQUIA ou CATEGORIA do lançamento — sinais úteis pra um categorizador classificar a natureza contábil (ex: "Grupo", "Família", "Subgrupo", "Categoria", "Conta Contábil", "Departamento", "Centro de Custo", "Classe", "Plano de Contas"). NÃO inclua aqui description, date, amount nem direction. Se não houver nenhuma, retorne lista vazia [].
- Se um campo não existir no arquivo, use null. Não invente.`

// ─────────────────────────────────────────────────────────────────────
// 1) LEITURA TABULAR (CSV ou Excel) → array de array de strings
// ─────────────────────────────────────────────────────────────────────

function readTabular(buffer: Buffer, mimeType?: string): string[][] {
  if (mimeType === 'text/plain' || mimeType === 'text/csv') {
    const text = buffer.toString('utf-8')
    // Detecta delimitador olhando a primeira linha não-vazia
    const firstLine = text.split('\n').find(l => l.trim().length > 0) ?? ''
    const semicolons = (firstLine.match(/;/g) ?? []).length
    const commas = (firstLine.match(/,/g) ?? []).length
    const tabs = (firstLine.match(/\t/g) ?? []).length
    const delimiter = semicolons >= commas && semicolons >= tabs ? ';'
      : tabs >= commas ? '\t'
      : ','
    return parse(text, {
      bom: true,
      delimiter,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][]
  }
  // Excel: XLSX → array de arrays
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const sheet = wb.Sheets[sheetName]
  return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' }) as string[][]
}

// ─────────────────────────────────────────────────────────────────────
// 2) DETECÇÃO DE COLUNAS — LLM primeiro, heurística como fallback
// ─────────────────────────────────────────────────────────────────────

async function detectColumnMapping(header: string[], sampleRows: string[][]): Promise<ColumnMapping> {
  // Tenta LLM primeiro
  const llmMapping = await tryLlmMapping(header, sampleRows)
  if (llmMapping && validateMapping(llmMapping, header.length)) {
    return llmMapping
  }
  // Fallback heurístico
  return heuristicMapping(header, sampleRows)
}

async function tryLlmMapping(header: string[], sampleRows: string[][]): Promise<ColumnMapping | null> {
  const userMsg = [
    'Cabeçalho (com índices):',
    header.map((h, i) => `  ${i}: ${h}`).join('\n'),
    '',
    `Amostra das ${sampleRows.length} primeiras linhas:`,
    ...sampleRows.map(row => row.join(' | ')),
  ].join('\n')

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    })
    const text = msg.content.find(b => b.type === 'text')?.text ?? ''
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as Partial<ColumnMapping>
    const rawHints = Array.isArray(parsed.categoryHints) ? parsed.categoryHints : []
    return {
      date: typeof parsed.date === 'number' ? parsed.date : null,
      effectiveDate: typeof parsed.effectiveDate === 'number' ? parsed.effectiveDate : null,
      amount: typeof parsed.amount === 'number' ? parsed.amount : null,
      direction: typeof parsed.direction === 'number' ? parsed.direction : null,
      description: typeof parsed.description === 'number' ? parsed.description : null,
      amountSignIndicatesDirection: parsed.amountSignIndicatesDirection === true,
      categoryHints: rawHints.filter((n): n is number => typeof n === 'number'),
    }
  } catch {
    return null
  }
}

function validateMapping(m: ColumnMapping, colCount: number): boolean {
  const inRange = (v: number | null) => v === null || (Number.isInteger(v) && v >= 0 && v < colCount)
  if (!inRange(m.date) || !inRange(m.effectiveDate) || !inRange(m.amount) || !inRange(m.direction) || !inRange(m.description)) {
    return false
  }
  if (!m.categoryHints.every(n => Number.isInteger(n) && n >= 0 && n < colCount)) return false
  // Pelo menos date ou amount precisam estar presentes pra mapping ser útil
  return m.date !== null || m.amount !== null
}

function heuristicMapping(header: string[], sampleRows: string[][]): ColumnMapping {
  const norm = (s: string) => s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').trim()
  const cols = header.map(norm)

  const findFirst = (keywords: string[]): number | null => {
    for (let i = 0; i < cols.length; i++) {
      if (keywords.some(kw => cols[i].includes(kw))) return i
    }
    return null
  }

  const date = findFirst(['data venda', 'data emiss', 'data nf', 'data lanc', 'vencimento', 'competencia', 'emissao', 'data'])
  const effectiveDate = findFirst(['data pagamento', 'data credito', 'data debito', 'data liquid', 'data caixa'])
  const amount = findFirst(['valor bruto', 'valor liquido', 'vlr bruto', 'vlr', 'valor', 'total', 'montante', 'preco', 'bruto', 'liquido'])
  const direction = findFirst(['tipo movim', 'natureza', 'c/d', 'd/c', 'entrada saida', 'entrada/saida'])
  const description = findFirst(['descricao', 'historico', 'lancamento', 'produto', 'nome produto', 'observa', 'obs'])

  // Detecta colunas de hierarquia/categoria (Grupo, Família, Subgrupo, Departamento, etc.)
  // Não pode reusar as colunas já mapeadas semanticamente.
  const usedIdxs = new Set<number | null>([date, effectiveDate, amount, direction, description])
  const hintKeywords = [
    'grupo', 'familia', 'subgrupo', 'categoria', 'classe', 'departamento',
    'centro custo', 'centro de custo', 'cc', 'plano de contas', 'conta contabil',
    'rubrica', 'segmento', 'linha', 'natureza', 'natureza filho', 'natureza pai',
  ]
  const categoryHints: number[] = []
  for (let i = 0; i < cols.length; i++) {
    if (usedIdxs.has(i)) continue
    if (hintKeywords.some(kw => cols[i].includes(kw))) categoryHints.push(i)
  }

  // Detecta se amount tem sinais negativos nas amostras
  let amountSignIndicatesDirection = false
  if (amount !== null) {
    for (const row of sampleRows) {
      const v = row[amount] ?? ''
      if (v.includes('-') || v.startsWith('(')) {
        amountSignIndicatesDirection = true
        break
      }
    }
  }

  return { date, effectiveDate, amount, direction, description, amountSignIndicatesDirection, categoryHints }
}

// ─────────────────────────────────────────────────────────────────────
// 3) NORMALIZAÇÃO DETERMINÍSTICA de campos
// ─────────────────────────────────────────────────────────────────────

const MONTH_PT: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
}

function normalizeDate(s: string | undefined | null): string | null {
  if (!s) return null
  const v = s.trim()
  if (!v) return null

  // YYYY-MM-DD
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`

  // DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`

  // DD/MM/YY → assume 20YY
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/)
  if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`

  // "02 jan." ou "31 jul" — usa ano atual
  m = v.match(/^(\d{1,2})\s+([a-zç]+)\.?$/i)
  if (m) {
    const month = MONTH_PT[m[2].toLowerCase().slice(0, 3)]
    if (month) {
      const year = new Date().getFullYear()
      return `${year}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`
    }
  }

  // Excel serial date (raw=false já deveria ter convertido, mas garante)
  const num = Number(v)
  if (!Number.isNaN(num) && num > 25569 && num < 60000) {
    // Excel: dias desde 1900-01-01 (com bug do 1900 leap year)
    const d = new Date(Date.UTC(1900, 0, 1) + (num - 2) * 86400000)
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10)
    }
  }

  return null
}

function normalizeAmount(s: string | undefined | null): number | null {
  if (s === null || s === undefined) return null
  let v = String(s).trim()
  if (!v) return null

  // Detecta sinal negativo via parênteses ou prefixo
  let negative = false
  if (v.startsWith('(') && v.endsWith(')')) {
    negative = true
    v = v.slice(1, -1).trim()
  }
  if (v.startsWith('-')) {
    negative = true
    v = v.slice(1).trim()
  }

  // Remove R$, espaços, +
  v = v.replace(/R\$\s*/g, '').replace(/[+\s]/g, '')

  // Formato BR (1.234,56) vs US (1,234.56)
  // Se tem vírgula seguida por exatamente 2 dígitos no fim e ponto antes, é BR
  // Se tem ponto seguido por exatamente 2 dígitos no fim e vírgula antes, é US
  // Se só tem vírgula → BR (vírgula decimal)
  // Se só tem ponto → ambíguo, assume decimal
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
    // BR só com vírgula decimal
    v = v.replace(',', '.')
  }
  // só ponto → assume decimal (não mexe)

  const n = Number(v)
  if (Number.isNaN(n)) return null
  const abs = Math.abs(n)
  return negative ? -abs : abs
}

function deriveDirection(
  row: string[],
  mapping: ColumnMapping,
  amount: number | null,
  fallback?: 'inflow' | 'outflow',
): 'inflow' | 'outflow' | null {
  if (mapping.direction !== null) {
    const v = (row[mapping.direction] ?? '').toLowerCase().trim()
    if (/^(c|credito|entrada|recebim|in|inflow|\+)/.test(v)) return 'inflow'
    if (/^(d|debito|saida|pagamen|out|outflow|-)/.test(v)) return 'outflow'
  }
  if (mapping.amountSignIndicatesDirection && amount !== null) {
    return amount < 0 ? 'outflow' : 'inflow'
  }
  return fallback ?? null
}

// ─────────────────────────────────────────────────────────────────────
// 4) FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────

export async function parseExcelOrCsv(
  buffer: Buffer,
  mimeType?: string,
): Promise<{ rows: StagingRow[]; warnings: string[] }> {
  const warnings: string[] = []

  let tabular: string[][]
  try {
    tabular = readTabular(buffer, mimeType)
  } catch (err) {
    return { rows: [], warnings: [`Falha ao ler arquivo: ${err instanceof Error ? err.message : String(err)}`] }
  }

  if (tabular.length === 0) {
    return { rows: [], warnings: ['Arquivo sem linhas legíveis'] }
  }
  if (tabular.length === 1) {
    return { rows: [], warnings: ['Arquivo só tem cabeçalho, sem linhas de dados'] }
  }

  const header = tabular[0].map(c => String(c ?? ''))
  const dataRows = tabular.slice(1).map(row => row.map(c => String(c ?? '')))

  const sampleSize = Math.min(20, dataRows.length)
  const mapping = await detectColumnMapping(header, dataRows.slice(0, sampleSize))

  if (mapping.date === null && mapping.amount === null) {
    warnings.push('Não conseguimos identificar colunas de data e valor. Verifique se o cabeçalho está na primeira linha e usa nomes reconhecíveis (Data, Valor, etc.).')
    return { rows: [], warnings }
  }

  if (mapping.date === null) warnings.push('Coluna de data não detectada — linhas terão date=null')
  if (mapping.amount === null) warnings.push('Coluna de valor não detectada — linhas terão amount=null')

  // Deduplica hints contra colunas semânticas (LLM/heurística podem coincidir)
  const semanticIdxs = new Set<number>(
    [mapping.date, mapping.effectiveDate, mapping.amount, mapping.direction, mapping.description]
      .filter((v): v is number => v !== null),
  )
  const hintIdxs = Array.from(new Set(mapping.categoryHints))
    .filter(i => Number.isInteger(i) && i >= 0 && i < header.length && !semanticIdxs.has(i))

  const stagingRows: StagingRow[] = dataRows.map((row, i) => {
    const rawData: Record<string, unknown> = {}
    header.forEach((h, j) => {
      rawData[h || `col_${j}`] = row[j] ?? ''
    })

    // Bloco estável e fácil de propagar pra metadata.categoryHints na importação.
    if (hintIdxs.length > 0) {
      const hints: Record<string, string> = {}
      for (const idx of hintIdxs) {
        const key = (header[idx] || `col_${idx}`).trim()
        const val = (row[idx] ?? '').trim()
        if (val) hints[key] = val
      }
      if (Object.keys(hints).length > 0) rawData.__categoryHints = hints
    }

    const date = mapping.date !== null ? normalizeDate(row[mapping.date]) : null
    const effectiveDate = mapping.effectiveDate !== null ? normalizeDate(row[mapping.effectiveDate]) : null
    const amount = mapping.amount !== null ? normalizeAmount(row[mapping.amount]) : null
    const description = mapping.description !== null
      ? (row[mapping.description] ?? '').slice(0, 200) || null
      : null
    const direction = deriveDirection(row, mapping, amount)

    return {
      rowIndex: i,
      rawData,
      date,
      effectiveDate,
      amount: amount !== null ? Math.abs(amount) : null,
      direction,
      description,
    }
  })

  return { rows: stagingRows, warnings }
}
