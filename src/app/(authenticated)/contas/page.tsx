import type { Metadata } from 'next'
import { ContasClient } from './contas-client'

export const metadata: Metadata = { title: 'Contas' }
import { getOrgConnections, getPendingTransactionsBySource, getCurrentOrgId } from '@/server/connections'
import { getReconciliationCount } from '@/server/reconciliation'

export const dynamic = 'force-dynamic'

export default async function ContasPage() {
  const [connections, reconciliationCount, pendingSources, orgId] = await Promise.all([
    getOrgConnections(),
    getReconciliationCount(),
    getPendingTransactionsBySource(),
    getCurrentOrgId(),
  ])
  const includeSandbox = process.env.PLUGGY_ENVIRONMENT === 'sandbox'

  return (
    <div className="p-6 space-y-6">
      <ContasClient
        connections={connections}
        includeSandbox={includeSandbox}
        reconciliationCount={reconciliationCount}
        pendingSources={pendingSources}
        orgId={orgId}
      />
    </div>
  )
}
