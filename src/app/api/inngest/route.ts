import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
import { processDocument } from '@/jobs/process-document'
import { categorizeTransactions } from '@/jobs/categorize-transaction'
import { syncPluggyItem } from '@/jobs/sync-pluggy-item'
import { syncAllPluggyItems } from '@/jobs/sync-all-pluggy-items'
import { reconcilePluggyTransactions } from '@/jobs/reconcile-pluggy-transactions'
import { syncSefazItem } from '@/jobs/sync-sefaz-item'
import { syncAllSefazItems } from '@/jobs/sync-all-sefaz-items'
import { reconcileInvoices } from '@/jobs/reconcile-invoices'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processDocument,
    categorizeTransactions,
    syncPluggyItem,
    syncAllPluggyItems,
    reconcilePluggyTransactions,
    syncSefazItem,
    syncAllSefazItems,
    reconcileInvoices,
  ],
})
