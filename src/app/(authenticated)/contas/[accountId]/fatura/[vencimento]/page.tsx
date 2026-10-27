import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getExtratoDaConta, getFaturasDaConta } from '@/server/account-ledger'
import type { TransactionsSearchParams } from '@/components/transacoes-shared/transactions-table'
import { decodificar, opcoesDaTabela } from '../../pagina-da-conta'
import FaturaClient from './fatura-client'

export const metadata: Metadata = { title: 'Fatura do cartão' }
export const dynamic = 'force-dynamic'

interface Props {
  params: { accountId: string; vencimento: string }
  searchParams: Omit<TransactionsSearchParams, 'accountId' | 'from' | 'to'>
}

export default async function FaturaPage({ params, searchParams }: Props) {
  const accountId = decodificar(params.accountId)
  const vencimento = params.vencimento
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) notFound()

  const page = Math.max(1, Number(searchParams.page) || 1)
  const pageSize = Number(searchParams.pageSize) || undefined

  const [dados, faturas, options] = await Promise.all([
    // A fatura É a data de caixa: o período fica preso nela.
    getExtratoDaConta(accountId, {
      page,
      pageSize,
      q: searchParams.q,
      from: vencimento,
      to: vencimento,
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
      origem: searchParams.origem,
    }),
    getFaturasDaConta(accountId),
    opcoesDaTabela(),
  ])

  if (!dados) notFound()
  const i = faturas.findIndex(f => f.vencimento === vencimento)
  if (i < 0) notFound()

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <FaturaClient
        conta={dados.conta}
        fatura={faturas[i]}
        anterior={faturas[i - 1]?.vencimento ?? null}
        proxima={faturas[i + 1]?.vencimento ?? null}
        extrato={dados.extrato}
        options={options}
        searchParams={searchParams}
      />
    </div>
  )
}
