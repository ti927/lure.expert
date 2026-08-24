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

// credit_card: outflow quando IA retorna null
const DEFAULT_OUTFLOW_SOURCES = new Set(['credit_card'])
// balance_sheet: sempre inflow — categoria define o sinal no BP
const FORCE_INFLOW_SOURCES = new Set(['balance_sheet'])

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
        // O contexto é o que permite atribuir o custo da chamada à organização
        // certa — antes da Fase 0 os parsers não recebiam nada disso.
        const ctx = { organizationId, documentId }
        const parsed = isExcelCsv
          ? await parseExcelOrCsv(buffer, ctx, mimeType)
          : await parsePdf(buffer, ctx, pdfPassword ?? undefined)

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
                // A data de caixa é extraída pelos DOIS parsers desde sempre e era
                // descartada exatamente aqui — este insert listava date/amount/
                // direction/description e nada mais. `approveAndInsert` fazia
                // `r.effectiveDate ?? r.date` e caía no `date` em 100% das linhas,
                // porque o valor nunca chegava. É a explicação mecânica de "caixa
                // nunca difere da competência em toda a base" (medido em 24/ago:
                // 0 lançamentos em 10.365).
                effectiveDate: row.effectiveDate,
                amount: row.amount !== null ? String(row.amount) : null,
                direction: FORCE_INFLOW_SOURCES.has(sourceType)
                  ? 'inflow'
                  : DEFAULT_OUTFLOW_SOURCES.has(sourceType)
                  ? (row.direction ?? 'outflow')
                  : row.direction,
                description: row.description,
                status: 'pending' as const,
              })),
            )
          }
        }

        const detectedCategoryHints = 'detectedHints' in parsed ? parsed.detectedHints : []

        await db
          .update(documents)
          .set({
            extractionStatus: 'completed',
            extractionMethod: 'llm',
            extractedData: {
              warnings: parsed.warnings,
              ...(detectedCategoryHints.length > 0 ? { detectedCategoryHints } : {}),
            },
          })
          .where(eq(documents.id, documentId))

        return { rowCount: parsed.rows.length, warnings: parsed.warnings, detectedCategoryHints }
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
