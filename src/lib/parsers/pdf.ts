import type { DocumentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { anthropic } from '@/lib/anthropic'
import type { StagingRow } from './excel-csv'

export type PdfParseResult = {
  rows: StagingRow[]
  warnings: string[]
  method: 'text' | 'vision'
}

type LlmRow = {
  date: string | null
  effectiveDate: string | null
  amount: number | null
  direction: 'inflow' | 'outflow' | null
  description: string | null
}

const SYSTEM_PROMPT = `Você é um extrator especializado de dados de extratos bancários e relatórios financeiros.
Analise o conteúdo fornecido e extraia cada movimentação financeira individual.

Retorne APENAS um array JSON válido. Sem explicações, sem markdown, sem código fence — apenas o JSON bruto.

Formato de cada elemento:
{"date":"YYYY-MM-DD","effectiveDate":"YYYY-MM-DD","amount":1234.56,"direction":"inflow","description":"descrição"}

Regras:
- date: data de competência — quando o evento econômico ocorreu (ex: data da NF, data da compra no cartão). Formato YYYY-MM-DD. Converta DD/MM/AAAA ou outras variações para este padrão.
- effectiveDate: data em que o dinheiro efetivamente entrou ou saiu da conta (ex: data do crédito ou débito no extrato). Formato YYYY-MM-DD. Se o documento tiver apenas uma data, repita o mesmo valor de date.
- amount: número positivo (nunca negativo). Remova R$, pontos de milhar, converta vírgula decimal.
- direction: "inflow" para entradas/créditos/depósitos/recebimentos/estornos/reembolsos; "outflow" para saídas/débitos/pagamentos/compras.
- Valores precedidos de sinal negativo (ex: -R$120,00 ou (120,00)) indicam crédito/estorno → direction "inflow".
- description: texto identificador da transação, máximo 200 caracteres.
- Ignore: saldos, totais, subtotais, cabeçalhos, rodapés e linhas de resumo.
- Extraia APENAS movimentações individuais.
- Se um campo não for determinável, use null.

Atenção para PDFs com múltiplas colunas monetárias (ex: valor em moeda estrangeira + cotação + valor em BRL):
use SEMPRE o valor em BRL (coluna "valor" ou a última coluna monetária) como amount.
Ignore colunas de câmbio/cotação e valores em moeda estrangeira.`

// Abre o PDF apenas para detectar proteção por senha — não usa o texto extraído.
// pdf-parse corrompe fontes customizadas de PDFs bancários (ex: $ decodificado como 5).
async function checkPasswordProtection(buffer: Buffer, password?: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pdf-parse')
  const pdfParse = (typeof mod === 'function' ? mod : mod.default) as (
    buf: Buffer,
    opts?: { password?: string },
  ) => Promise<{ text: string }>
  await pdfParse(buffer, password ? { password } : undefined)
}

function parseLlmResponse(raw: string): { rows: LlmRow[]; warnings: string[] } {
  const warnings: string[] = []
  let cleaned = raw.trim()

  // Remove markdown code fences caso o modelo esqueça de não usar
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

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

// Envia o PDF como documento nativo para Claude.
// Claude renderiza o PDF com seu próprio motor — sem problemas de codificação de fonte.
// Funciona tanto para PDFs com camada de texto quanto para PDFs de imagem (scaneados).
async function extractViaDocument(buffer: Buffer): Promise<PdfParseResult> {
  const base64 = buffer.toString('base64')

  const docBlock: DocumentBlockParam = {
    type: 'document',
    source: {
      type: 'base64',
      media_type: 'application/pdf',
      data: base64,
    },
  }

  const textBlock: TextBlockParam = {
    type: 'text',
    text: 'Extraia as transações deste extrato bancário.',
  }

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [docBlock, textBlock],
      },
    ],
  })

  const responseText = message.content.find(b => b.type === 'text')?.text ?? ''
  const { rows: llmRows, warnings: parseWarnings } = parseLlmResponse(responseText)

  return {
    rows: toStagingRows(llmRows),
    warnings: parseWarnings,
    method: 'vision',
  }
}

// Ponto de entrada principal
export async function parsePdf(buffer: Buffer, password?: string): Promise<PdfParseResult> {
  // Detecta proteção por senha antes de enviar à API
  try {
    await checkPasswordProtection(buffer, password)
  } catch (err) {
    const errStr = String(err).toLowerCase()
    const isEncrypted = errStr.includes('password') || errStr.includes('encrypt') || errStr.includes('protected')
    if (isEncrypted) {
      throw new Error(
        'PDF protegido por senha. Para enviar, abra o arquivo no Google Chrome, pressione Ctrl+P e salve como PDF — o novo arquivo não terá senha.',
      )
    }
    // Erro desconhecido no pdf-parse: continua para o Claude mesmo assim
  }

  // Sempre usa o processamento nativo de PDF do Claude para garantir precisão.
  // Extração de texto via pdf-parse é não-confiável em PDFs bancários brasileiros
  // com fontes customizadas (ex: Itaú, XP) onde símbolos monetários são corrompidos.
  return extractViaDocument(buffer)
}
