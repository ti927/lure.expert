import type { Metadata } from 'next'
import { listSefazConnections, getLegalEntitiesForSefaz } from '@/server/sefaz'
import { SefazClient } from './sefaz-client'

export const metadata: Metadata = { title: 'Conexões SEFAZ' }

export default async function SefazPage() {
  const [connections, entities] = await Promise.all([
    listSefazConnections(),
    getLegalEntitiesForSefaz(),
  ])

  return <SefazClient connections={connections} entities={entities} />
}
