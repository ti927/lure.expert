import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { documents, transactionsStaging } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { parseExcelOrCsv } from '@/lib/parsers/excel-csv'

const PARSEABLE_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
])

export const processDocument = inngest.createFunction(
  {
    id: 'process-document',
    name: 'Processar documento',
    triggers: [{ event: 'document/uploaded' }],
  },
  async ({ event, step }) => {
    const { documentId, organizationId, mimeType, sourceType, signedUrl } = event.data as {
      documentId: string
      organizationId: string
      storagePath: string
      mimeType: string
      sourceType: string
      signedUrl: string | null
    }

    // source types onde toda linha é saída por definição
    const FORCE_OUTFLOW_SOURCES = new Set(['credit_card'])

    await step.run('mark-processing', async () => {
      await db
        .update(documents)
        .set({ extractionStatus: 'processing' })
        .where(eq(documents.id, documentId))
    })

    if (!PARSEABLE_MIME_TYPES.has(mimeType)) {
      // PDFs e imagens: extração via LLM (Fase 2.4+)
      await step.run('mark-needs-llm', async () => {
        await db
          .update(documents)
          .set({ extractionStatus: 'pending', extractionMethod: 'llm' })
          .where(eq(documents.id, documentId))
      })
      return { documentId, status: 'pending_llm' }
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

    const result = await step.run('parse-and-stage', async () => {
      const response = await fetch(signedUrl)
      if (!response.ok) throw new Error(`Download falhou: ${response.status}`)

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      const parsed = parseExcelOrCsv(buffer, mimeType)

      if (parsed.rows.length === 0) {
        return { rowCount: 0, warnings: parsed.warnings }
      }

      // Insere em lotes de 100 para não estourar limite do Postgres
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
            direction: FORCE_OUTFLOW_SOURCES.has(sourceType)
              ? 'outflow'
              : row.direction,
            description: row.description,
            status: 'pending' as const,
          })),
        )
      }

      await db
        .update(documents)
        .set({
          extractionStatus: 'completed',
          extractionMethod: 'template',
          extractedData: { columnMap: parsed.columnMap, warnings: parsed.warnings },
        })
        .where(eq(documents.id, documentId))

      return { rowCount: parsed.rows.length, warnings: parsed.warnings }
    })

    return { documentId, status: 'completed', ...result }
  },
)
