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

type LlmRow = {
  date: string | null
  effectiveDate: string | null
  amount: number | null
  direction: 'inflow' | 'outflow' | null
  description: string | null
}

const SYSTEM_PROMPT = `Você é um extrator especializado de dados de extratos bancários e relatórios financeiros em formato planilha ou CSV.
Analise o conteúdo fornecido e extraia cada movimentação financeira individual.

Retorne APENAS um array JSON válido. Sem explicações, sem markdown, sem código fence — apenas o JSON bruto.

Formato de cada elemento:
{"date":"YYYY-MM-DD","effectiveDate":"YYYY-MM-DD","amount":1234.56,"direction":"inflow","description":"descrição"}

Regras:
- date: data de competência — quando o evento econômico ocorreu (ex: data da NF, data da compra no cartão, data do lançamento no ERP). Formato YYYY-MM-DD. Converta DD/MM/AAAA, "31 jul.", "09 ago." e outras variações para este padrão. Para meses abreviados em português sem ano, use o ano mais recente plausível.
- effectiveDate: data em que o dinheiro efetivamente entrou ou saiu da conta (ex: data do crédito ou débito no extrato bancário). Formato YYYY-MM-DD, mesmas regras de conversão. Se o documento tiver apenas uma data, repita o mesmo valor de date.
- amount: número positivo (nunca negativo). Remova R$, pontos de milhar, converta vírgula decimal. Se a célula contiver valor em moeda estrangeira + BRL, use sempre o valor em BRL.
- direction: "inflow" para entradas/créditos/depósitos/recebimentos/estornos/reembolsos/resgate de aplicação; "outflow" para saídas/débitos/pagamentos/compras/aplicações.
- Valores precedidos de sinal negativo (ex: -R$120,00 ou (120,00)) na perspectiva do extrato indicam débito → direction "outflow". Valores positivos indicam crédito → direction "inflow".
- description: texto identificador da transação, máximo 200 caracteres. Use o campo de lançamento/histórico/descrição.
- Ignore: saldos, totais, subtotais, cabeçalhos, rodapés, linhas de resumo, linhas em branco, metadados (nome, agência, conta, atualização).
- Extraia APENAS movimentações individuais.
- Se um campo não for determinável, use null.`

// Output budget: max_tokens=8192. Cada objeto JSON ocupa ~40-60 tokens.
// Com margem de segurança usamos 120 linhas por chunk — comporta header + ~120 rows
// e ainda deixa folga para descrições longas sem truncar o JSON.
const CHUNK_SIZE = 120

function fileToText(buffer: Buffer, mimeType?: string): string {
  let text: string
  if (mimeType === 'text/plain' || mimeType === 'text/csv') {
    text = buffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  } else {
    // Excel binário: converte primeira sheet para CSV puro
    const wb = XLSX.read(buffer, { type: 'buffer', raw: true })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) return ''
    text = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName])
  }
  // Remove BOM (U+FEFF) — se sobreviver, contamina o header de todos os chunks
  // e o fetch interno do SDK Anthropic falha em serializar caractere fora do Latin-1.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  return text
}

function parseLlmResponse(raw: string): { rows: LlmRow[]; warnings: string[] } {
  const warnings: string[] = []
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    warnings.push('Resposta do expert não é JSON válido — nenhuma linha extraída')
    return { rows: [], warnings }
  }

  if (!Array.isArray(parsed)) {
    warnings.push('Resposta do expert não é um array — nenhuma linha extraída')
    return { rows: [], warnings }
  }

  const rows: LlmRow[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const date = typeof r.date === 'string' ? r.date : null
    rows.push({
      date,
      effectiveDate: typeof r.effectiveDate === 'string' ? r.effectiveDate : date,
      amount: typeof r.amount === 'number' ? Math.abs(r.amount) : null,
      direction: r.direction === 'inflow' || r.direction === 'outflow' ? r.direction : null,
      description: typeof r.description === 'string' ? r.description.slice(0, 200) : null,
    })
  }

  return { rows, warnings }
}

function toStagingRows(llmRows: LlmRow[]): StagingRow[] {
  return llmRows.map((r, i) => ({
    rowIndex: i,
    rawData: { llm: true, date: r.date, effectiveDate: r.effectiveDate, amount: r.amount, direction: r.direction, description: r.description },
    date: r.date,
    effectiveDate: r.effectiveDate,
    amount: r.amount,
    direction: r.direction,
    description: r.description,
  }))
}

async function extractRowsFromText(text: string): Promise<{ rows: LlmRow[]; warnings: string[] }> {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  })

  const responseText = message.content.find(b => b.type === 'text')?.text ?? ''
  return parseLlmResponse(responseText)
}

export async function parseExcelOrCsv(
  buffer: Buffer,
  mimeType?: string,
): Promise<{ rows: StagingRow[]; warnings: string[] }> {
  const text = fileToText(buffer, mimeType)
  if (!text.trim()) return { rows: [], warnings: ['Arquivo sem conteúdo legível'] }

  const lines = text.split('\n').filter(l => l.trim().length > 0)

  // Arquivos pequenos vão num único call (mesma trajetória do código antigo)
  if (lines.length <= CHUNK_SIZE) {
    const { rows, warnings } = await extractRowsFromText(text)
    return { rows: toStagingRows(rows), warnings }
  }

  // Arquivo grande: preserva a primeira linha como header e fatia o resto
  const [header, ...dataLines] = lines
  const allLlmRows: LlmRow[] = []
  const allWarnings: string[] = []
  const totalChunks = Math.ceil(dataLines.length / CHUNK_SIZE)

  for (let i = 0; i < dataLines.length; i += CHUNK_SIZE) {
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1
    const chunkLines = dataLines.slice(i, i + CHUNK_SIZE)
    const chunkText = [header, ...chunkLines].join('\n')
    try {
      const { rows, warnings } = await extractRowsFromText(chunkText)
      allLlmRows.push(...rows)
      if (warnings.length > 0) {
        allWarnings.push(...warnings.map(w => `chunk ${chunkNum}/${totalChunks}: ${w}`))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      allWarnings.push(`chunk ${chunkNum}/${totalChunks} falhou: ${msg}`)
    }
  }

  return { rows: toStagingRows(allLlmRows), warnings: allWarnings }
}
