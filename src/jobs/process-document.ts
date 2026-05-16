import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { documents } from '@/db/schema'
import { eq } from 'drizzle-orm'

export const processDocument = inngest.createFunction(
  {
    id: 'process-document',
    name: 'Processar documento',
    triggers: [{ event: 'document/uploaded' }],
  },
  async ({ event, step }) => {
    const { documentId } = event.data as { documentId: string }

    await step.run('mark-processing', async () => {
      await db
        .update(documents)
        .set({ extractionStatus: 'processing' })
        .where(eq(documents.id, documentId))
    })

    // Sessões 2.3+ implementarão o parsing real aqui
    await step.sleep('aguardar-processamento', '3s')

    await step.run('mark-completed', async () => {
      await db
        .update(documents)
        .set({ extractionStatus: 'completed' })
        .where(eq(documents.id, documentId))
    })

    return { documentId, status: 'completed' }
  },
)
