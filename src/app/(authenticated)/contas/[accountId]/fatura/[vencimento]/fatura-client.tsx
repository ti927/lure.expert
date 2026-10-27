'use client'

// Uma fatura de cartão aberta: os lançamentos daquele vencimento, na mesma
// tabela de `/transacoes` (classificar, ratear, lote), sem filtro de período —
// o período é a fatura. A data mostrada é a da COMPRA.

import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PartialDataBanner } from '@/components/states/partial-data-banner'
import { COLUNAS_FATURA } from '@/lib/column-widths'
import {
  TransactionsTable, formatBRL, type TxRow, type DimensionOptions, type TransactionsSearchParams,
} from '@/components/transacoes-shared/transactions-table'
import type { Fatura } from '@/lib/account-ledger'
import type { ContaNaTela } from '@/server/account-ledger'
import { CabecalhoDaConta, Cartao, dataBR } from '../../cabecalho-da-conta'
import { LancarManual, ManuaisApagados } from '../../lancamento-manual'

interface Props {
  conta: ContaNaTela
  fatura: Fatura
  anterior: string | null
  proxima: string | null
  extrato: { rows: TxRow[]; total: number; pages: number; page: number; totals: { inflow: string; outflow: string } }
  options: DimensionOptions
  searchParams: TransactionsSearchParams
}

export default function FaturaClient({ conta, fatura, anterior, proxima, extrato, options, searchParams }: Props) {
  const base = `/contas/${encodeURIComponent(conta.accountId)}`

  const cabecalho = (
    <CabecalhoDaConta conta={conta} voltarPara={base}
      acoes={conta.manual ? <><ManuaisApagados accountId={conta.accountId} /><LancarManual accountId={conta.accountId} categories={options.categories} dataPadrao={{ caixa: fatura.vencimento }} /></> : undefined}
      contexto={`Fatura com vencimento em ${dataBR(fatura.vencimento)}`}>
      <div className="flex items-center gap-2">
        <Button asChild={!!anterior} variant="outline" size="sm" disabled={!anterior}>
          {anterior ? <Link href={`${base}/fatura/${anterior}`}><ChevronLeft className="h-4 w-4 mr-1" />{dataBR(anterior)}</Link>
            : <span><ChevronLeft className="h-4 w-4 mr-1" />Anterior</span>}
        </Button>
        <Button asChild={!!proxima} variant="outline" size="sm" disabled={!proxima}>
          {proxima ? <Link href={`${base}/fatura/${proxima}`}>{dataBR(proxima)}<ChevronRight className="h-4 w-4 ml-1" /></Link>
            : <span>Próxima<ChevronRight className="h-4 w-4 ml-1" /></span>}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Cartao
          titulo={`Compras (${fatura.compras})`}
          valor={formatBRL(fatura.valorCompras)}
          detalhe={fatura.primeiraCompra ? `de ${dataBR(fatura.primeiraCompra)} a ${dataBR(fatura.ultimaCompra)}` : undefined}
          tom="negativo"
        />
        <Cartao titulo={`Pagamentos e créditos (${fatura.creditos})`} valor={formatBRL(fatura.valorCreditos)} tom="positivo" />
        <Cartao
          titulo="Diferença desta fatura"
          valor={fatura.diferenca === 0 ? 'paga' : formatBRL(fatura.diferenca)}
          detalhe="Compras − pagamentos com este vencimento"
        />
        <Cartao
          titulo="Saldo devedor depois dela"
          valor={formatBRL(fatura.saldoDevedor)}
          tom={fatura.saldoDevedor > 0 ? 'negativo' : 'neutro'}
        />
      </div>
    </CabecalhoDaConta>
  )

  const avisos = fatura.semVencimento ? (
    <div className="shrink-0 px-6 pb-2">
      <PartialDataBanner
        variant="warning"
        message="Estas compras não têm vencimento: a data de caixa é a própria data da compra, então este grupo não é uma fatura. Reimporte com a coluna Data de caixa = vencimento."
      />
    </div>
  ) : null

  return (
    <TransactionsTable
      basePath={`${base}/fatura/${fatura.vencimento}`}
      storageKey={`lure:fatura:${conta.accountId}:filters`}
      widthsKey="fatura"
      colunas={COLUNAS_FATURA}
      data={extrato}
      options={options}
      searchParams={searchParams}
      semFiltroDeData
      cabecalho={cabecalho}
      antesDaTabela={avisos}
    />
  )
}
