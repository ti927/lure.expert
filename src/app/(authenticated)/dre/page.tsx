import type { Metadata } from 'next'
import { getDreData } from '@/server/dre'

export const metadata: Metadata = { title: 'DRE' }
import { getCostCenters, getBusinessUnits, getLegalEntities, getLeafCategories } from '@/server/dimensions'
import { listBudgetVersions } from '@/server/budget'
import { DreClient } from './dre-client'

function defaultRange() {
  const now = new Date()
  // 12-month window: 1st of month 11 months ago → last day of current month
  const from = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  return { from: fmt(from), to: fmt(to) }
}

export default async function DrePage() {
  const { from, to } = defaultRange()

  const [data, costCenters, businessUnits, legalEntities, leafCategories, budgetVersions] = await Promise.all([
    getDreData({ from, to }),
    getCostCenters(),
    getBusinessUnits(),
    getLegalEntities(),
    getLeafCategories(),
    listBudgetVersions(),
  ])

  return (
    <DreClient
      initialData={data}
      initialFrom={from}
      initialTo={to}
      costCenters={costCenters.filter(c => c.isActive)}
      businessUnits={businessUnits.filter(b => b.isActive)}
      legalEntities={legalEntities.filter(l => l.isActive)}
      leafCategories={leafCategories}
      budgetVersions={budgetVersions}
    />
  )
}
