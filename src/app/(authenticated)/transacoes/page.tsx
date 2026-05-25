import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Transações' }
import { ArrowLeftRight } from 'lucide-react'
import { getTransactions } from '@/server/transactions'
import { getCategories } from '@/server/categories'
import { getCostCenters, getBusinessUnits, getLegalEntities } from '@/server/dimensions'
import { getDataSourcesWithTransactions } from '@/server/connections'
import { getReviewCount } from '@/server/review'
import { EmptyState } from '@/components/states/empty-state'
import TransacoesClient from './transacoes-client'

interface SearchParams {
  page?: string
  pageSize?: string
  q?: string
  from?: string
  to?: string
  direction?: string
  category?: string
  costCenter?: string
  businessUnit?: string
  legalEntity?: string
  documentId?: string
  accountId?: string
  sort?: string
  reportType?: string
  amountMin?: string
  amountMax?: string
}

interface Props {
  searchParams: SearchParams
}

export default async function TransacoesPage({ searchParams }: Props) {
  const page = Math.max(1, Number(searchParams.page) || 1)
  const pageSize = Number(searchParams.pageSize) || undefined

  const [txData, cats, ccs, bus, les, dataSrcs, reviewCount] = await Promise.all([
    getTransactions({
      page,
      pageSize,
      q: searchParams.q,
      from: searchParams.from,
      to: searchParams.to,
      direction: searchParams.direction,
      category: searchParams.category,
      costCenter: searchParams.costCenter,
      businessUnit: searchParams.businessUnit,
      legalEntity: searchParams.legalEntity,
      documentId: searchParams.documentId,
      accountId: searchParams.accountId,
      sort: searchParams.sort,
      reportType: searchParams.reportType,
      amountMin: searchParams.amountMin,
      amountMax: searchParams.amountMax,
    }),
    getCategories(),
    getCostCenters(),
    getBusinessUnits(),
    getLegalEntities(),
    getDataSourcesWithTransactions(),
    getReviewCount(),
  ])

  const hasAnyFilter = !!(searchParams.q || searchParams.from || searchParams.to ||
    searchParams.direction || searchParams.category || searchParams.costCenter ||
    searchParams.businessUnit || searchParams.legalEntity || searchParams.documentId ||
    searchParams.accountId || searchParams.reportType || searchParams.amountMin || searchParams.amountMax)

  if (txData.total === 0 && !hasAnyFilter) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Transações</h1>
        <EmptyState
          icon={<ArrowLeftRight className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Sem transações"
          description="Conecte uma conta bancária ou importe um extrato para ver as movimentações."
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <TransacoesClient
        data={txData}
        options={{
          categories: cats.filter(c => c.isActive),
          costCenters: ccs.filter(c => c.isActive),
          businessUnits: bus.filter(c => c.isActive),
          legalEntities: les.filter(c => c.isActive),
        }}
        dataSources={dataSrcs}
        searchParams={searchParams}
        reviewCount={reviewCount}
        hasAnyFilter={hasAnyFilter}
      />
    </div>
  )
}
