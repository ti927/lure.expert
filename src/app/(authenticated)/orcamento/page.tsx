import type { Metadata } from 'next'
import { listBudgetVersions, listBudgetSeries } from '@/server/budget'
import {
  getCostCenters,
  getBusinessUnits,
  getLegalEntities,
  getLeafCategories,
  getContactOptions,
} from '@/server/dimensions'
import { OrcamentoClient } from './orcamento-client'

export const metadata: Metadata = { title: 'Orçamento' }

export default async function OrcamentoPage() {
  const versions = await listBudgetVersions()
  // Vigente do exercício mais recente; sem vigente, a primeira da lista.
  const selected = versions.find(v => v.isActive) ?? versions[0] ?? null

  const [series, costCenters, businessUnits, legalEntities, leafCategories, contactOptions] = await Promise.all([
    selected ? listBudgetSeries(selected.id) : Promise.resolve([]),
    getCostCenters(),
    getBusinessUnits(),
    getLegalEntities(),
    getLeafCategories(),
    getContactOptions(),
  ])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <OrcamentoClient
        initialVersions={versions}
        initialSelectedId={selected?.id ?? null}
        initialSeries={series}
        costCenters={costCenters.filter(c => c.isActive)}
        businessUnits={businessUnits.filter(b => b.isActive)}
        legalEntities={legalEntities.filter(l => l.isActive)}
        leafCategories={leafCategories}
        contactOptions={contactOptions}
      />
    </div>
  )
}
