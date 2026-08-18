'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2, Repeat } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CellCombobox, CategoryCellCombobox } from '@/components/transacoes-shared/cell-combobox'
import type { CategoryItem, SimpleDimensionItem } from '@/components/transacoes-shared/types'
import { cn } from '@/lib/utils'
import { dateLabel, fmtMoney, monthLabel } from '@/lib/format'
import type { BudgetVersionListItem, RecurrenceChoice } from '@/lib/budget-types'
import type { RecurrenceCandidate } from '@/lib/budget-import'
import { acceptDetectedRecurrences, getRecurrenceCandidates } from '@/server/budget'

interface RowState {
  selected:     boolean
  categoryId:   string | null
  costCenterId: string | null
  amount:       string
}

interface Props {
  open:           boolean
  onOpenChange:   (open: boolean) => void
  version:        BudgetVersionListItem
  leafCategories: CategoryItem[]
  costCenters:    SimpleDimensionItem[]
  onSaved:        () => void
}

export function RecurrencesDialog({
  open, onOpenChange, version, leafCategories, costCenters, onSaved,
}: Props) {
  const [candidates, setCandidates] = useState<RecurrenceCandidate[] | null>(null)
  const [state, setState] = useState<Record<string, RowState>>({})
  const [isLoading, startLoading] = useTransition()
  const [isSaving, startSaving]   = useTransition()

  useEffect(() => {
    if (!open) { setCandidates(null); setState({}); return }
    startLoading(async () => {
      const result = await getRecurrenceCandidates(version.id)
      if ('error' in result) { toast.error(result.error); onOpenChange(false); return }
      setCandidates(result.candidates)
      setState(Object.fromEntries(result.candidates.map(c => [c.key, {
        selected:     false,
        categoryId:   null,
        costCenterId: null,
        // Já mensalizado: uma recorrência de 7 dias entra como 4× o valor médio.
        amount:       String(c.valorMensal),
      }])))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, version.id])

  function patch(key: string, next: Partial<RowState>) {
    setState(prev => ({ ...prev, [key]: { ...prev[key], ...next } }))
  }

  const selectable = (candidates ?? []).filter(c => !c.blocked && !c.alreadyAccepted)
  const chosen = selectable.filter(c => state[c.key]?.selected)
  const missingCategory = chosen.filter(c => !state[c.key]?.categoryId).length

  function save() {
    const choices: RecurrenceChoice[] = []
    for (const c of chosen) {
      const s = state[c.key]
      const amount = Number(s.amount.replace(',', '.'))
      if (!s.categoryId) { toast.error(`Escolha a categoria de "${c.descricao}".`); return }
      if (!Number.isFinite(amount) || amount <= 0) { toast.error(`Valor inválido em "${c.descricao}".`); return }
      choices.push({ key: c.key, categoryId: s.categoryId, costCenterId: s.costCenterId, amount })
    }
    if (choices.length === 0) { toast.error('Escolha ao menos uma recorrência.'); return }

    startSaving(async () => {
      const result = await acceptDetectedRecurrences(version.id, choices)
      if ('error' in result && result.error) { toast.error(result.error); return }
      const created = 'series' in result ? result.series : 0
      toast.success(`${created} ${created === 1 ? 'lançamento criado' : 'lançamentos criados'}.`)
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Recorrências detectadas</DialogTitle>
          <DialogDescription>
            O que se repete no seu histórico dos últimos 180 dias, pronto para virar previsão de {version.fiscalYear}.
            A detecção agrupa por descrição e não sabe a categoria — por isso ela é obrigatória aqui.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto pr-1">
          {isLoading || !candidates ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-xs">
              <Loader2 className="h-4 w-4 animate-spin" /> Procurando recorrências…
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <Repeat className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm font-medium">Nenhuma recorrência detectada</p>
              <p className="text-xs text-muted-foreground max-w-md">
                A detecção precisa de pelo menos duas ocorrências da mesma descrição nos últimos 180 dias,
                com intervalo entre 7 e 40 dias.
              </p>
            </div>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 bg-muted z-10">
                <tr className="border-b">
                  <th className="w-8 px-2 py-1.5" />
                  <th className="text-left px-2 py-1.5 font-medium">Descrição</th>
                  <th className="text-left px-2 py-1.5 font-medium w-40">Detectado</th>
                  <th className="text-left px-2 py-1.5 font-medium w-32">No orçamento</th>
                  <th className="text-right px-2 py-1.5 font-medium w-28">Valor mensal</th>
                  <th className="text-left px-2 py-1.5 font-medium w-56">Categoria</th>
                  <th className="text-left px-2 py-1.5 font-medium w-40">Centro de custo</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(c => {
                  const s = state[c.key]
                  const disabled = !!c.blocked || c.alreadyAccepted
                  const reason = c.blocked ?? (c.alreadyAccepted ? 'Já aceita nesta versão.' : null)

                  return (
                    <tr key={c.key} className={cn('border-b last:border-b-0', disabled && 'opacity-50')}>
                      <td className="px-2 py-1.5 text-center align-top">
                        <input
                          type="checkbox"
                          checked={!disabled && !!s?.selected}
                          disabled={disabled}
                          onChange={e => patch(c.key, { selected: e.target.checked })}
                        />
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <span className={c.direction === 'inflow' ? 'text-emerald-700' : 'text-rose-600'}>
                          {c.direction === 'inflow' ? '+ ' : '− '}
                        </span>
                        {c.descricao}
                        {reason && <p className="text-amber-600">{reason}</p>}
                      </td>
                      <td className="px-2 py-1.5 align-top text-muted-foreground">
                        a cada {c.intervaloDias} dias · {fmtMoney(c.valorMedio)}
                        <span className="block">
                          {c.ocorrencias}× até {dateLabel(c.ultimaData)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 align-top text-muted-foreground">
                        {c.mesesRestantes}× mensal
                        <span className="block">a partir de {monthLabel(c.startMonth)}</span>
                        {c.vezesPorMes > 1 && (
                          <span className="block text-amber-600">{c.vezesPorMes}× por mês no valor</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top text-right">
                        <input
                          type="number" min={0} step="0.01"
                          value={s?.amount ?? ''}
                          disabled={disabled}
                          onChange={e => patch(c.key, { amount: e.target.value })}
                          className="w-24 h-7 rounded border border-input px-1.5 text-right tabular-nums bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                        />
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        {!disabled && (
                          <CategoryCellCombobox
                            value={s?.categoryId ?? null}
                            categories={leafCategories}
                            onValueChange={v => patch(c.key, { categoryId: v, selected: true })}
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        {!disabled && (
                          <CellCombobox
                            value={s?.costCenterId ?? null}
                            options={costCenters}
                            onValueChange={v => patch(c.key, { costCenterId: v })}
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter className="items-center">
          {chosen.length > 0 && missingCategory > 0 && (
            <span className="text-[11px] text-amber-600 mr-auto">
              {missingCategory} {missingCategory === 1 ? 'selecionada sem categoria' : 'selecionadas sem categoria'}.
            </span>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancelar</Button>
          <Button onClick={save} disabled={isSaving || chosen.length === 0 || missingCategory > 0}>
            {isSaving
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Criando…</>
              : `Criar ${chosen.length} ${chosen.length === 1 ? 'lançamento' : 'lançamentos'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
