import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
import { processDocument } from '@/jobs/process-document'
import { categorizeTransactions } from '@/jobs/categorize-transaction'
import { syncPluggyItem } from '@/jobs/sync-pluggy-item'
import { syncAllPluggyItems } from '@/jobs/sync-all-pluggy-items'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processDocument, categorizeTransactions, syncPluggyItem, syncAllPluggyItems],
})
