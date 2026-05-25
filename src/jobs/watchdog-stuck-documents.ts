import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { documents } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'

// Documentos em `pending` significam que o evento document/uploaded nunca foi
// consumido — provável dessincronização do app Inngest. O primeiro step do job
// process-document marca como `processing` em milissegundos, então qualquer
// linha presa em `pending` por mais de 15 min está realmente abandonada.
//
// `processing` por muito tempo (>30 min) também é suspeito — função morreu
// antes de virar `completed`/`failed`, ou o Anthropic ficou pendurado.
const PENDING_TIMEOUT_MIN = 15
const PROCESSING_TIMEOUT_MIN = 30

export const watchdogStuckDocuments = inngest.createFunction(
  {
    id: 'watchdog-stuck-documents',
    name: 'Watchdog de documentos travados',
    triggers: [{ cron: '*/10 * * * *' }],
  },
  async ({ step }) => {
    const stuckPending = await step.run('fail-stuck-pending', async () => {
      return db
        .update(documents)
        .set({
          extractionStatus: 'failed',
          extractedData: {
            error: 'Processamento não foi iniciado em tempo hábil. Pode ter sido um problema temporário na fila — reenvie o arquivo.',
            stuckAt: 'pending',
            timeoutMin: PENDING_TIMEOUT_MIN,
          },
        })
        .where(
          and(
            eq(documents.extractionStatus, 'pending'),
            sql`${documents.createdAt} < now() - (${PENDING_TIMEOUT_MIN} || ' minutes')::interval`,
          ),
        )
        .returning({ id: documents.id, filename: documents.filename })
    })

    const stuckProcessing = await step.run('fail-stuck-processing', async () => {
      return db
        .update(documents)
        .set({
          extractionStatus: 'failed',
          extractedData: {
            error: 'Extração interrompida — o processo ficou travado e foi cancelado. Reenvie o arquivo.',
            stuckAt: 'processing',
            timeoutMin: PROCESSING_TIMEOUT_MIN,
          },
        })
        .where(
          and(
            eq(documents.extractionStatus, 'processing'),
            sql`${documents.createdAt} < now() - (${PROCESSING_TIMEOUT_MIN} || ' minutes')::interval`,
          ),
        )
        .returning({ id: documents.id, filename: documents.filename })
    })

    return {
      pendingFailed: stuckPending.length,
      processingFailed: stuckProcessing.length,
      pendingIds: stuckPending.map(d => d.id),
      processingIds: stuckProcessing.map(d => d.id),
    }
  },
)
