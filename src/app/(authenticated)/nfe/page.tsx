import type { Metadata } from 'next'
import { listInvoices, getInvoiceStats } from '@/server/invoices'
import { getLegalEntities } from '@/server/dimensions'
import { NfeClient } from './nfe-client'

export const metadata: Metadata = { title: 'NF-e' }

export default async function NfePage() {
  const [{ rows, total, totalPages }, stats, legalEntities] = await Promise.all([
    listInvoices(),
    getInvoiceStats(),
    getLegalEntities(),
  ])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <NfeClient
        initialRows={rows}
        initialTotal={total}
        initialTotalPages={totalPages}
        stats={stats}
        legalEntities={legalEntities.map(le => ({ id: le.id, name: le.name }))}
      />
    </div>
  )
}
