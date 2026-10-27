import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CreditCard } from 'lucide-react'
import { getExtratoDaConta, getContaParaConferencia, getFaturasDaConta } from '@/server/account-ledger'
import { temSaldoCorrido } from '@/lib/import-contract'
import { EmptyState } from '@/components/states/empty-state'
import type { TransactionsSearchParams } from '@/components/transacoes-shared/transactions-table'
import ConferenciaClient from './conferencia-client'
import FaturasClient from './faturas-client'
import { CabecalhoDaConta } from './cabecalho-da-conta'
import { decodificar, opcoesDaTabela } from './pagina-da-conta'

export const metadata: Metadata = { title: 'Conferência de saldo' }
export const dynamic = 'force-dynamic'

interface Props {
  params: { accountId: string }
  searchParams: Omit<TransactionsSearchParams, 'accountId'>
}

export default async function ConferenciaPage({ params, searchParams }: Props) {
  const accountId = decodificar(params.accountId)
  const conta = await getContaParaConferencia(accountId)
  if (!conta) notFound()

  // Cartão de crédito confere por FATURA (Decisão 30). Os do Pluggy ainda não:
  // o vencimento deles não está na data de caixa (o sync grava a da compra).
  if (!temSaldoCorrido(conta.tipo)) {
    if (!conta.manual) {
      return (
        <div className="h-full flex flex-col overflow-hidden">
          <CabecalhoDaConta conta={conta} contexto="Cartão de crédito conectado" />
          <EmptyState
            icon={<CreditCard className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
            title="Conferência de cartão conectado ainda não disponível"
            description="A conferência por fatura vale hoje para cartões cadastrados à mão, importados com o vencimento na coluna Data de caixa."
          />
        </div>
      )
    }
    const [faturas, options] = await Promise.all([getFaturasDaConta(accountId), opcoesDaTabela()])
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <FaturasClient conta={conta} faturas={faturas} categories={options.categories} />
      </div>
    )
  }

  const page = Math.max(1, Number(searchParams.page) || 1)
  const pageSize = Number(searchParams.pageSize) || undefined

  const [dados, options] = await Promise.all([
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
      origem: searchParams.origem,
    }),
    opcoesDaTabela(),
  ])

  if (!dados) notFound()

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ConferenciaClient
        conta={dados.conta}
        extrato={dados.extrato}
        semConta={dados.semConta}
        options={options}
        searchParams={searchParams}
      />
    </div>
  )
}
