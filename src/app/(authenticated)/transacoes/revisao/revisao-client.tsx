'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck, SkipForward, ArrowLeft, ChevronLeft, ChevronRight, Bot, Repeat2, Shuffle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/states/empty-state'
import { cn } from '@/lib/utils'
import { confirmSuggestions, skipSuggestions } from '@/server/review'
import type { getReviewQueue } from '@/server/review'

type ReviewRow = Awaited<ReturnType<typeof getReviewQueue>>['rows'][number]

interface Props {
  rows: ReviewRow[]
  total: number
  pages: number
  page: number
}

const METHOD_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  rule:       { label: 'Regra',       icon: <Shuffle className="h-3 w-3" />,  color: 'bg-sky-100 text-sky-700' },
  recurrence: { label: 'Recorrência', icon: <Repeat2 className="h-3 w-3" />,  color: 'bg-violet-100 text-violet-700' },
  embedding:  { label: 'Embedding',   icon: <Bot className="h-3 w-3" />,      color: 'bg-amber-100 text-amber-700' },
  llm:        { label: 'Expert',      icon: <Bot className="h-3 w-3" />,      color: 'bg-emerald-100 text-emerald-700' },
}

function ConfidenceBadge({ value }: { value: string | null }) {
  if (!value) return null
  const pct = Math.round(Number(value) * 100)
  const color = pct >= 80 ? 'text-emerald-700' : pct >= 60 ? 'text-amber-600' : 'text-rose-600'
  return <span className={cn('tabular-nums text-xs font-medium', color)}>{pct}%</span>
}

function MethodBadge({ method }: { method: string | null }) {
  if (!method) return null
  const m = METHOD_LABELS[method]
  if (!m) return null
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium', m.color)}>
      {m.icon}{m.label}
    </span>
  )
}

function DimensionChip({ label }: { label: string | null }) {
  if (!label) return <span className="text-slate-300 text-xs">—</span>
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 truncate max-w-[140px]" title={label}>
      {label}
    </span>
  )
}

export default function RevisaoClient({ rows, total, pages, page }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()

  const allIds = rows.map(r => r.id)
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id))
  const someSelected = selected.size > 0

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(allIds))
  }

  function toggleRow(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function handleConfirm(ids: string[]) {
    startTransition(async () => {
      const result = await confirmSuggestions(ids)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success(`${result.confirmed} sugestão${result.confirmed !== 1 ? 'ões' : ''} confirmada${result.confirmed !== 1 ? 's' : ''}.`)
        setSelected(new Set())
        router.refresh()
      }
    })
  }

  function handleSkip(ids: string[]) {
    startTransition(async () => {
      const result = await skipSuggestions(ids)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success(`${result.skipped} sugestão${result.skipped !== 1 ? 'ões' : ''} descartada${result.skipped !== 1 ? 's' : ''}.`)
        setSelected(new Set())
        router.refresh()
      }
    })
  }

  if (rows.length === 0 && page === 1) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.push('/transacoes')} className="text-slate-500">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar para Transações
          </Button>
        </div>
        <EmptyState
          title="Nenhuma sugestão aguardando revisão"
          description="O expert não tem classificações pendentes no momento. Importe transações para o motor iniciar a categorização automática."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/transacoes')} className="text-slate-500">
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar
        </Button>
        <span className="text-sm text-slate-500">{total} transação{total !== 1 ? 'ões' : ''} aguardando revisão</span>
      </div>

      {/* Bulk toolbar */}
      {someSelected && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2">
          <span className="text-sm font-medium text-emerald-800">{selected.size} selecionada{selected.size !== 1 ? 's' : ''}</span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleSkip(Array.from(selected))}
            disabled={isPending}
            className="border-slate-300 text-slate-600 hover:bg-slate-50"
          >
            <SkipForward className="mr-1.5 h-3.5 w-3.5" />
            Descartar
          </Button>
          <Button
            size="sm"
            onClick={() => handleConfirm(Array.from(selected))}
            disabled={isPending}
            className="bg-emerald-700 hover:bg-emerald-800 text-white"
          >
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
            Confirmar selecionadas
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wide">
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
              </th>
              <th className="px-4 py-3 text-left">Data</th>
              <th className="px-4 py-3 text-left">Descrição</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-left">Categoria sugerida</th>
              <th className="px-4 py-3 text-left">Centro de custo</th>
              <th className="px-4 py-3 text-center">Confiança</th>
              <th className="px-4 py-3 text-center">Método</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map(row => {
              const isSelected = selected.has(row.id)
              const [y, m, d] = row.date.split('-')
              const dateLabel = `${d}/${m}/${y.slice(2)}`
              const amountNum = Number(row.amount)
              const isInflow = row.direction === 'inflow'

              return (
                <tr
                  key={row.id}
                  className={cn(
                    'group transition-colors',
                    isSelected ? 'bg-emerald-50/60' : 'hover:bg-slate-50/60',
                  )}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(row.id)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </td>

                  <td className="px-4 py-3 tabular-nums text-slate-500 whitespace-nowrap">
                    {dateLabel}
                  </td>

                  <td className="px-4 py-3 text-slate-800 max-w-[260px]">
                    <span className="truncate block" title={row.description}>
                      {row.description}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                    <span className={isInflow ? 'text-emerald-700 font-medium' : 'text-slate-700'}>
                      {isInflow ? '+' : ''}
                      {amountNum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <DimensionChip label={row.categoryName} />
                  </td>

                  <td className="px-4 py-3">
                    <DimensionChip label={row.costCenterName} />
                  </td>

                  <td className="px-4 py-3 text-center">
                    <ConfidenceBadge value={row.categorizationConfidence} />
                  </td>

                  <td className="px-4 py-3 text-center">
                    <MethodBadge method={row.categorizationMethod} />
                  </td>

                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSkip([row.id])}
                        disabled={isPending}
                        className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700"
                        title="Descartar sugestão"
                      >
                        <SkipForward className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleConfirm([row.id])}
                        disabled={isPending}
                        className="h-7 px-2 text-xs bg-emerald-700 hover:bg-emerald-800 text-white"
                        title="Confirmar sugestão"
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Página {page} de {pages}</span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isPending}
              onClick={() => router.push(`/transacoes/revisao?page=${page - 1}`)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages || isPending}
              onClick={() => router.push(`/transacoes/revisao?page=${page + 1}`)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
