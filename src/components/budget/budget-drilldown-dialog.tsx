'use client'

import { useState, useTransition } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { fmtMoney, fmtNum, dateLabel } from '@/lib/format'
import type { BudgetDrillDownEntry, BudgetSeriesListItem } from '@/lib/budget-types'
import type { CategoryItem, SimpleDimensionItem } from '@/components/transacoes-shared/types'
import { getBudgetSeries } from '@/server/budget'
import { SeriesDialog } from './series-dialog'

// As ocorrências orçadas por trás de uma célula — extraído da aba
// Orçado × Realizado na sessão 9.8, quando a DRE passou a precisar do mesmo
// diálogo. Ganhou aqui o botão que abre o lançamento para edição, fechando o
// ciclo: quem vê o desvio corrige a previsão sem trocar de tela.

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  title:        string
  subtitle:     string
  data:         BudgetDrillDownEntry[] | null
  loading:      boolean
  /** Sem estes, o diálogo é somente leitura (a coluna de ação não aparece). */
  edit?: {
    /** `BudgetSeriesListItem` não carrega a versão; quem abriu o diálogo sabe. */
    versionId:      string
    fiscalYear:     number
    /** Versão arquivada não edita — o motivo aparece no lugar do botão. */
    readOnlyReason: string | null
    leafCategories: CategoryItem[]
    costCenters:    SimpleDimensionItem[]
    businessUnits:  SimpleDimensionItem[]
    legalEntities:  SimpleDimensionItem[]
    contactOptions: SimpleDimensionItem[]
    /** Chamado depois de salvar: recarregue o drill-down e a malha. */
    onSaved:        () => void
  }
}

export function BudgetDrillDownDialog({
  open, onOpenChange, title, subtitle, data, loading, edit,
}: Props) {
  const [editing, setEditing] = useState<BudgetSeriesListItem | null>(null)
  const [loadingSeriesId, setLoadingSeriesId] = useState<string | null>(null)
  const [, startLoad] = useTransition()

  const canEdit = !!edit && !edit.readOnlyReason

  function openSeries(seriesId: string) {
    setLoadingSeriesId(seriesId)
    startLoad(async () => {
      try {
        const series = await getBudgetSeries(seriesId)
        if (!series) { toast.error('Lançamento não encontrado. Ele pode ter sido excluído.'); return }
        setEditing(series)
      } finally {
        setLoadingSeriesId(null)
      }
    })
  }

  const total = (data ?? []).reduce(
    (s, e) => s + (e.direction === 'inflow' ? e.amount : -e.amount), 0)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {title}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{subtitle} · orçado</span>
            </DialogTitle>
          </DialogHeader>

          {loading || !data ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : data.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">Nada orçado nesta célula.</p>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-auto border rounded-lg">
                <table className="w-full text-xs border-collapse [&_td]:border-r [&_th]:border-r [&_td]:border-border/20 [&_th]:border-border/20 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-muted border-b">
                      <th className="text-left font-medium px-2 py-1.5">Descrição</th>
                      <th className="text-left font-medium px-2 py-1.5 w-28">Competência</th>
                      <th className="text-left font-medium px-2 py-1.5 w-28">Caixa</th>
                      <th className="text-left font-medium px-2 py-1.5 w-32">Centro de custo</th>
                      <th className="text-right font-medium px-2 py-1.5 w-32">Valor</th>
                      {edit && <th className="w-10" />}
                    </tr>
                  </thead>
                  <tbody>
                    {data.map(e => (
                      <tr key={e.id} className="border-b last:border-b-0">
                        <td className="px-2 py-1">
                          {e.description}
                          {e.adjusted && (
                            <span className="ml-1.5 text-[10px] rounded px-1 py-0.5 bg-amber-500/15 text-amber-600">ajustada</span>
                          )}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{dateLabel(e.competenceDate)}</td>
                        <td className="px-2 py-1 tabular-nums">{dateLabel(e.cashDate)}</td>
                        <td className="px-2 py-1 text-muted-foreground truncate">{e.costCenterName ?? '—'}</td>
                        <td className={cn('px-2 py-1 text-right tabular-nums',
                          e.direction === 'inflow' ? 'text-emerald-700' : 'text-rose-600')}>
                          {fmtMoney(e.amount)}
                        </td>
                        {edit && (
                          <td className="px-1 py-1 text-center">
                            <button
                              onClick={() => openSeries(e.seriesId)}
                              disabled={!canEdit || loadingSeriesId !== null}
                              title={edit.readOnlyReason ?? 'Editar o lançamento que gerou esta ocorrência'}
                              className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
                            >
                              {loadingSeriesId === e.seriesId
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Pencil className="h-3 w-3" />}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between text-xs pt-2">
                <span className="text-muted-foreground">
                  {data.length} {data.length === 1 ? 'ocorrência' : 'ocorrências'}
                  {edit?.readOnlyReason && (
                    <span className="ml-2 text-amber-600">{edit.readOnlyReason}</span>
                  )}
                </span>
                <span className="tabular-nums font-medium">Total: {fmtNum(total)}</span>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* O mesmo diálogo da aba Planejamento, com os três escopos da 9.3. */}
      {editing && edit && (
        <SeriesDialog
          open
          onOpenChange={o => { if (!o) setEditing(null) }}
          mode="edit"
          versionId={edit.versionId}
          fiscalYear={edit.fiscalYear}
          initial={editing}
          leafCategories={edit.leafCategories}
          costCenters={edit.costCenters}
          businessUnits={edit.businessUnits}
          legalEntities={edit.legalEntities}
          contactOptions={edit.contactOptions}
          onSaved={() => { setEditing(null); edit.onSaved() }}
        />
      )}
    </>
  )
}
