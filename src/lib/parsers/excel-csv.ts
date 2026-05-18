import * as XLSX from 'xlsx'
import { anthropic } from '@/lib/anthropic'

export type StagingRow = {
  rowIndex: number
  rawData: Record<string, unknown>
  date: string | null
  amount: number | null
  direction: 'inflow' | 'outflow' | null
  description: string | null
}

type LlmRow = {
  date: string | null
  amount: number | null
  direction: 'inflow' | 'outflow' | null
  description: string | null
}

const SYSTEM_PROMPT = `Você é um extrator especializado de dados de extratos bancários e relatórios financeiros em formato planilha ou CSV.
Analise o conteúdo fornecido e extraia cada movimentação financeira individual.

Retorne APENAS um array JSON válido. Sem explicações, sem markdown, sem código fence — apenas o JSON bruto.

Formato de cada elemento:
{"date":"YYYY-MM-DD","amount":1234.56,"direction":"inflow","description":"descrição"}

Regras:
- date: formato YYYY-MM-DD. Converta DD/MM/AAAA, "31 jul.", "09 ago." e outras variações para este padrão. Para meses abreviados em português sem ano, use o ano mais recente plausível.
- amount: número positivo (nunca negativo). Remova R$, pontos de milhar, converta vírgula decimal. Se a célula contiver valor em moeda estrangeira + BRL, use sempre o valor em BRL.
- direction: "inflow" para entradas/créditos/depósitos/recebimentos/estornos/reembolsos/resgate de aplicação; "outflow" para saídas/débitos/pagamentos/compras/aplicações.
- Valores precedidos de sinal negativo (ex: -R$120,00 ou (120,00)) na perspectiva do extrato indicam débito → direction "outflow". Valores positivos indicam crédito → direction "inflow".
- description: texto identificador da transação, máximo 200 caracteres. Use o campo de lançamento/histórico/descrição.
- Ignore: saldos, totais, subtotais, cabeçalhos, rodapés, linhas de resumo, linhas em branco, metadados (nome, agência, conta, atualização).
- Extraia APENAS movimentações individuais.
- Se um campo não for determinável, use null.`

function fileToText(buffer: Buffer, mimeType?: string): string {
  if (mimeType === 'text/plain' || mimeType === 'text/csv') {
    return buffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  }
  // Excel binário: converte primeira sheet para CSV puro
  const wb = XLSX.read(buffer, { type: 'buffer', raw: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return ''
  return XLSX.utils.sheet_to_csv(wb.Sheets[sheetName])
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
    rows.push({
      date: typeof r.date === 'string' ? r.date : null,
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
    rawData: { llm: true, date: r.date, amount: r.amount, direction: r.direction, description: r.description },
    date: r.date,
    amount: r.amount,
    direction: r.direction,
    description: r.description,
  }))
}

export async function parseExcelOrCsv(
  buffer: Buffer,
  mimeType?: string,
): Promise<{ rows: StagingRow[]; warnings: string[] }> {
  const text = fileToText(buffer, mimeType)
  if (!text.trim()) return { rows: [], warnings: ['Arquivo sem conteúdo legível'] }

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: text,
      },
    ],
  })

  const responseText = message.content.find(b => b.type === 'text')?.text ?? ''
  const { rows: llmRows, warnings } = parseLlmResponse(responseText)

  return { rows: toStagingRows(llmRows), warnings }
}
