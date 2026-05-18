import { ContasClient } from './contas-client'
import { getOrgConnections } from '@/server/connections'

export default async function ContasPage() {
  const connections = await getOrgConnections()
  const includeSandbox = process.env.PLUGGY_ENVIRONMENT === 'sandbox'

  return (
    <div className="p-6 space-y-6">
      <ContasClient connections={connections} includeSandbox={includeSandbox} />
    </div>
  )
}
