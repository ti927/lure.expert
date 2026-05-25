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
import { syncAcquirerItem } from '@/jobs/sync-acquirer-item'
import { syncAllAcquirerItems } from '@/jobs/sync-all-acquirer-items'
import { watchdogStuckDocuments } from '@/jobs/watchdog-stuck-documents'

// Necessário para parsing de CSV/Excel grande: chunked Haiku calls podem
// somar 2-4 min num único step. Vercel default (10s Hobby / 60s Pro) corta.
export const maxDuration = 300

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
    syncAcquirerItem,
    syncAllAcquirerItems,
    watchdogStuckDocuments,
  ],
})
