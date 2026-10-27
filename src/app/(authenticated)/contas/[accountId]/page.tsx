import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getExtratoDaConta } from '@/server/account-ledger'
import { getCategories } from '@/server/categories'
import { getCostCenters, getBusinessUnits, getLegalEntities, getContactOptions } from '@/server/dimensions'
import type { TransactionsSearchParams } from '@/components/transacoes-shared/transactions-table'
import ConferenciaClient from './conferencia-client'

export const metadata: Metadata = { title: 'Conferência de saldo' }
export const dynamic = 'force-dynamic'

interface Props {
  params: { accountId: string }
  searchParams: Omit<TransactionsSearchParams, 'accountId'>
}

/** O id da conta chega codificado na URL (`arq:caixa` → `arq%3Acaixa`). */
function decodificar(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

export default async function ConferenciaPage({ params, searchParams }: Props) {
  const accountId = decodificar(params.accountId)
  const page = Math.max(1, Number(searchParams.page) || 1)
  const pageSize = Number(searchParams.pageSize) || undefined

  const [dados, cats, ccs, bus, les, cts] = await Promise.all([
    getExtratoDaConta(accountId, {
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
      contact: searchParams.contact,
      documentId: searchParams.documentId,
      sort: searchParams.sort,
      reportType: searchParams.reportType,
      amountMin: searchParams.amountMin,
      amountMax: searchParams.amountMax,
    }),
    getCategories(),
    getCostCenters(),
    getBusinessUnits(),
    getLegalEntities(),
    getContactOptions(),
  ])

  if (!dados) notFound()

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ConferenciaClient
        conta={dados.conta}
        extrato={dados.extrato}
        semConta={dados.semConta}
        options={{
          categories: cats.filter(c => c.isActive),
          costCenters: ccs.filter(c => c.isActive),
          businessUnits: bus.filter(c => c.isActive),
          legalEntities: les.filter(c => c.isActive),
          contacts: cts,
        }}
        searchParams={searchParams}
      />
    </div>
  )
}
