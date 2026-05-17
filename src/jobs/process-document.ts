import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { documents, transactionsStaging } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { parseExcelOrCsv } from '@/lib/parsers/excel-csv'
import { parsePdf } from '@/lib/parsers/pdf'

const EXCEL_CSV_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
])

const PDF_MIME_TYPES = new Set([
  'application/pdf',
])

// Para ambos os formatos: credit_card usa 'outflow' como padrão quando a IA retorna null
const DEFAULT_OUTFLOW_SOURCES = new Set(['credit_card'])

export const processDocument = inngest.createFunction(
  {
    id: 'process-document',
    name: 'Processar documento',
    triggers: [{ event: 'document/uploaded' }],
  },
  async ({ event, step }) => {
    const { documentId, organizationId, mimeType, sourceType, signedUrl, pdfPassword } = event.data as {
      documentId: string
      organizationId: string
      storagePath: string
      mimeType: string
      sourceType: string
      signedUrl: string | null
      pdfPassword: string | null
    }

    await step.run('mark-processing', async () => {
      await db
        .update(documents)
        .set({ extractionStatus: 'processing' })
        .where(eq(documents.id, documentId))
    })

    const isExcelCsv = EXCEL_CSV_MIME_TYPES.has(mimeType)
    const isPdf = PDF_MIME_TYPES.has(mimeType)

    if (!isExcelCsv && !isPdf) {
      await step.run('mark-unsupported', async () => {
        await db
          .update(documents)
          .set({ extractionStatus: 'failed', extractedData: { error: `Formato não suportado: ${mimeType}` } })
          .where(eq(documents.id, documentId))
      })
      return { documentId, status: 'failed', reason: 'unsupported_format' }
    }

    if (!signedUrl) {
      await step.run('mark-failed', async () => {
        await db
          .update(documents)
          .set({ extractionStatus: 'failed' })
          .where(eq(documents.id, documentId))
      })
      return { documentId, status: 'failed', reason: 'no_signed_url' }
    }

    const stepName = isExcelCsv ? 'parse-excel-csv' : 'parse-pdf-llm'

    const result = await step.run(stepName, async () => {
      try {
        const response = await fetch(signedUrl)
        if (!response.ok) throw new Error(`Download falhou: ${response.status}`)

        const buffer = Buffer.from(await response.arrayBuffer())
        const parsed = isExcelCsv
          ? await parseExcelOrCsv(buffer, mimeType)
          : await parsePdf(buffer, pdfPassword ?? undefined)

        if (parsed.rows.length > 0) {
          const batchSize = 100
          for (let i = 0; i < parsed.rows.length; i += batchSize) {
            const batch = parsed.rows.slice(i, i + batchSize)
            await db.insert(transactionsStaging).values(
              batch.map((row) => ({
                organizationId,
                documentId,
                rowIndex: row.rowIndex,
                rawData: row.rawData,
                date: row.date,
                amount: row.amount !== null ? String(row.amount) : null,
                direction: DEFAULT_OUTFLOW_SOURCES.has(sourceType)
                  ? (row.direction ?? 'outflow')
                  : row.direction,
                description: row.description,
                status: 'pending' as const,
              })),
            )
          }
        }

        await db
          .update(documents)
          .set({
            extractionStatus: 'completed',
            extractionMethod: 'llm',
            extractedData: { warnings: parsed.warnings },
          })
          .where(eq(documents.id, documentId))

        return { rowCount: parsed.rows.length, warnings: parsed.warnings }
      } catch (err) {
        await db
          .update(documents)
          .set({
            extractionStatus: 'failed',
            extractedData: { error: String(err) },
          })
          .where(eq(documents.id, documentId))
        throw err
      }
    })

    return { documentId, status: 'completed', ...result }
  },
)
