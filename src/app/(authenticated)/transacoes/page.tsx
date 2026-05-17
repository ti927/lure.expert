import { ArrowLeftRight } from 'lucide-react'
import { getTransactions } from '@/server/transactions'
import { getCategories } from '@/server/categories'
import { getCostCenters, getBusinessUnits, getLegalEntities } from '@/server/dimensions'
import { getDocumentsWithTransactions } from '@/server/documents'
import { EmptyState } from '@/components/states/empty-state'
import TransacoesClient from './transacoes-client'

interface SearchParams {
  page?: string
  q?: string
  from?: string
  to?: string
  direction?: string
  category?: string
  costCenter?: string
  businessUnit?: string
  legalEntity?: string
  documentId?: string
  sort?: string
}

interface Props {
  searchParams: SearchParams
}

export default async function TransacoesPage({ searchParams }: Props) {
  const page = Math.max(1, Number(searchParams.page) || 1)

  const [txData, cats, ccs, bus, les, docs] = await Promise.all([
    getTransactions({
      page,
      q: searchParams.q,
      from: searchParams.from,
      to: searchParams.to,
      direction: searchParams.direction,
      category: searchParams.category,
      costCenter: searchParams.costCenter,
      businessUnit: searchParams.businessUnit,
      legalEntity: searchParams.legalEntity,
      documentId: searchParams.documentId,
      sort: searchParams.sort,
    }),
    getCategories(),
    getCostCenters(),
    getBusinessUnits(),
    getLegalEntities(),
    getDocumentsWithTransactions(),
  ])

  const hasAnyFilter = !!(searchParams.q || searchParams.from || searchParams.to ||
    searchParams.direction || searchParams.category || searchParams.costCenter ||
    searchParams.businessUnit || searchParams.legalEntity || searchParams.documentId)

  if (txData.total === 0 && !hasAnyFilter) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Transações</h1>
        </div>
        <EmptyState
          icon={<ArrowLeftRight className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Sem transações"
          description="Conecte uma conta bancária ou importe um extrato para ver as movimentações."
        />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Transações</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {txData.total} transação{txData.total !== 1 ? 'ões' : ''}
          {hasAnyFilter ? ' encontrada' + (txData.total !== 1 ? 's' : '') : ' no total'}
        </p>
      </div>
      <TransacoesClient
        data={txData}
        options={{
          categories: cats.filter(c => c.isActive),
          costCenters: ccs.filter(c => c.isActive),
          businessUnits: bus.filter(c => c.isActive),
          legalEntities: les.filter(c => c.isActive),
        }}
        documents={docs}
        searchParams={searchParams}
      />
    </div>
  )
}
