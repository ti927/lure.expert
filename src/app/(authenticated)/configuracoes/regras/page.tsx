import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Regras de categorização' }

import { listRules } from '@/server/categorization-rules'
import { getCategories } from '@/server/categories'
import { getCostCenters, getBusinessUnits, getLegalEntities } from '@/server/dimensions'
import { getDataSourcesWithTransactions } from '@/server/connections'
import { RulesManager } from '@/components/settings/rules-manager'
import type { CategoryItem, SimpleDimensionItem } from '@/components/transacoes-shared/types'

interface SearchParams {
  page?: string
  q?: string
  accounts?: string
  categories?: string
}

interface Props {
  searchParams: SearchParams
}

export default async function RegrasPage({ searchParams }: Props) {
  const page = Math.max(1, Number(searchParams.page) || 1)

  const [data, cats, ccs, bus, les, accounts] = await Promise.all([
    listRules({
      page,
      q: searchParams.q,
      accounts: searchParams.accounts,
      categories: searchParams.categories,
    }),
    getCategories(),
    getCostCenters(),
    getBusinessUnits(),
    getLegalEntities(),
    getDataSourcesWithTransactions(),
  ])

  const categoryItems: CategoryItem[] = cats
    .filter(c => c.isActive)
    .map(c => ({ id: c.id, name: c.name, code: c.code, type: c.type, parentId: c.parentId }))

  const ccItems: SimpleDimensionItem[] = ccs
    .filter(c => c.isActive)
    .map(c => ({ id: c.id, name: c.name, code: c.code }))

  const buItems: SimpleDimensionItem[] = bus
    .filter(b => b.isActive)
    .map(b => ({ id: b.id, name: b.name, code: b.code }))

  const leItems: SimpleDimensionItem[] = les
    .filter(l => l.isActive)
    .map(l => ({ id: l.id, name: l.name, code: l.cnpj ?? null }))

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <RulesManager
        data={data}
        categories={categoryItems}
        costCenters={ccItems}
        businessUnits={buItems}
        legalEntities={leItems}
        accounts={accounts.map(a => ({ accountId: a.accountId, label: a.label }))}
        searchParams={searchParams}
      />
    </div>
  )
}
