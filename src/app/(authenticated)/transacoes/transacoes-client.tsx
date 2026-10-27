'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bot } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { triggerCategorization, previewCategorization } from '@/server/transactions'
import { COLUNAS_TRANSACOES } from '@/lib/column-widths'
import {
  TransactionsTable, type TxRow, type DimensionOptions, type TransactionsSearchParams,
} from '@/components/transacoes-shared/transactions-table'
import type { DataSourceOption } from '@/server/connections'

// A tabela (filtros, edição, rateio, lote, paginação) mora em
// `components/transacoes-shared/transactions-table.tsx`, compartilhada com a
// conferência de saldo. Aqui fica o que é só desta tela: o cabeçalho, o atalho
// para a revisão e o "Categorizar agora".

interface Props {
  data: { rows: TxRow[]; total: number; pages: number; page: number; totals: { inflow: string; outflow: string } }
  options: DimensionOptions
  dataSources: DataSourceOption[]
  searchParams: TransactionsSearchParams
  reviewCount: number
  hasAnyFilter: boolean
}

export default function TransacoesClient({ data, options, dataSources, searchParams, reviewCount, hasAnyFilter }: Props) {
  const [isCategorizing, setIsCategorizing] = useState(false)
  const [previaCategorizacao, setPreviaCategorizacao] =
    useState<{ count: number; custoEstimadoUsd: number } | null>(null)

  const acctOptions = dataSources.map(s => ({ id: s.accountId, label: `${s.label} (${s.txCount})` }))

  /**
   * O clique agora ABRE A PRÉVIA em vez de disparar. Este botão manda o job com
   * `forceRun`, que ignora o toggle de categorização automática — era o único
   * caminho capaz de gerar milhares de chamadas de IA sem aviso nenhum.
   */
  async function handleTriggerCategorization() {
    setIsCategorizing(true)
    const p = await previewCategorization()
    setIsCategorizing(false)
    if (p.count === 0) { toast.info('Não há lançamentos sem categoria.'); return }
    setPreviaCategorizacao(p)
  }

  async function confirmarCategorizacao() {
    setIsCategorizing(true)
    const result = await triggerCategorization()
    setIsCategorizing(false)
    setPreviaCategorizacao(null)
    if ('error' in result) { toast.error(result.error); return }
    if (!result.triggered) { toast.info('Não há lançamentos sem categoria.'); return }
    toast.success(`Categorizando ${result.count} lançamento${result.count !== 1 ? 's' : ''}...`)
  }

  const cabecalho = (
    <div className="shrink-0 flex items-center justify-between gap-4 px-6 pt-5 pb-3">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Transações</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {data.total} transação{data.total !== 1 ? 'ões' : ''}
          {hasAnyFilter ? ' encontrada' + (data.total !== 1 ? 's' : '') : ' no total'}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTriggerCategorization}
          disabled={isCategorizing}
          className="gap-2"
        >
          <Bot className="h-4 w-4" />
          {isCategorizing ? 'Iniciando...' : 'Categorizar agora'}
        </Button>
        {reviewCount > 0 && (
          <Link
            href="/transacoes/revisao"
            className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
          >
            <Bot className="h-4 w-4" />
            {reviewCount} sugestão{reviewCount !== 1 ? 'ões' : ''} do expert
          </Link>
        )}
      </div>
    </div>
  )

  return (
    <>
      <TransactionsTable
        basePath="/transacoes"
        storageKey="lure:transacoes:filters"
        widthsKey="transacoes"
        colunas={COLUNAS_TRANSACOES}
        data={data}
        options={options}
        searchParams={searchParams}
        contas={acctOptions}
        cabecalho={cabecalho}
      />

      <AlertDialog open={previaCategorizacao !== null} onOpenChange={open => { if (!open) setPreviaCategorizacao(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Classificar {previaCategorizacao?.count.toLocaleString('pt-BR')} lançamento
              {previaCategorizacao?.count !== 1 ? 's' : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Cada lançamento sem natureza que não casar por regra ou recorrência vai passar
                  pelo expert. O custo estimado desta rodada é de{' '}
                  <strong className="text-foreground tabular-nums">
                    US$ {previaCategorizacao?.custoEstimadoUsd.toFixed(2)}
                  </strong>.
                </p>
                <p className="text-[11px]">
                  É estimativa, não promessa: o consumo real depende de quantos lançamentos as
                  camadas determinísticas resolvem sozinhas antes de chegar ao expert.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCategorizing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarCategorizacao} disabled={isCategorizing}>
              {isCategorizing ? 'Iniciando...' : 'Classificar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
