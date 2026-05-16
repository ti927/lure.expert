import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
import { processDocument } from '@/jobs/process-document'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processDocument],
})
