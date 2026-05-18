import { ContasClient } from './contas-client'
import { getOrgConnections } from '@/server/connections'
import { getReconciliationCount } from '@/server/reconciliation'

export const dynamic = 'force-dynamic'

export default async function ContasPage() {
  const [connections, reconciliationCount] = await Promise.all([
    getOrgConnections(),
    getReconciliationCount(),
  ])
  const includeSandbox = process.env.PLUGGY_ENVIRONMENT === 'sandbox'

  return (
    <div className="p-6 space-y-6">
      <ContasClient
        connections={connections}
        includeSandbox={includeSandbox}
        reconciliationCount={reconciliationCount}
      />
    </div>
  )
}
