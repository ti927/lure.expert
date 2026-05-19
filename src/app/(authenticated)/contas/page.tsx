import type { Metadata } from 'next'
import { ContasClient } from './contas-client'

export const metadata: Metadata = { title: 'Contas' }
import { getOrgConnections, getPendingTransactionsBySource } from '@/server/connections'
import { getReconciliationCount } from '@/server/reconciliation'

export const dynamic = 'force-dynamic'

export default async function ContasPage() {
  const [connections, reconciliationCount, pendingSources] = await Promise.all([
    getOrgConnections(),
    getReconciliationCount(),
    getPendingTransactionsBySource(),
  ])
  const includeSandbox = process.env.PLUGGY_ENVIRONMENT === 'sandbox'

  return (
    <div className="p-6 space-y-6">
      <ContasClient
        connections={connections}
        includeSandbox={includeSandbox}
        reconciliationCount={reconciliationCount}
        pendingSources={pendingSources}
      />
    </div>
  )
}
