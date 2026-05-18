'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, GitCompare, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/states/empty-state'
import { cn } from '@/lib/utils'
import { confirmDuplicate, skipReconciliation } from '@/server/reconciliation'
import type { ReconciliationRow } from '@/server/reconciliation'

interface Props {
  rows: ReconciliationRow[]
  total: number
  pages: number
  page: number
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

function formatBRL(amount: string) {
  return Number(amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = pct >= 75
    ? 'bg-amber-100 text-amber-800 border-amber-200'
    : 'bg-slate-100 text-slate-600 border-slate-200'
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums', color)}>
      {pct}% similaridade
    </span>
  )
}

function TxSide({
  label,
  date,
  description,
  amount,
  direction,
  highlight,
}: {
  label: string
  date: string
  description: string
  amount: string
  direction: string
  highlight?: boolean
}) {
  const isInflow = direction === 'inflow'
  return (
    <div className={cn('flex-1 rounded-lg border p-4', highlight ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50/40')}>
      <p className={cn('mb-3 text-xs font-semibold uppercase tracking-wide', highlight ? 'text-emerald-700' : 'text-slate-500')}>
        {label}
      </p>
      <p className="text-xs text-slate-400 tabular-nums">{formatDate(date)}</p>
      <p className="mt-1 text-sm text-slate-800 font-medium leading-snug line-clamp-2" title={description}>
        {description}
      </p>
      <p className={cn('mt-2 text-base font-semibold tabular-nums', isInflow ? 'text-emerald-700' : 'text-slate-700')}>
        {isInflow ? '+' : ''}{formatBRL(amount)}
      </p>
      <p className="mt-0.5 text-xs text-slate-400">{isInflow ? 'Entrada' : 'Saída'}</p>
    </div>
  )
}

function ReconciliationCard({
  row,
  onConfirm,
  onSkip,
  isPending,
}: {
  row: ReconciliationRow
  onConfirm: () => void
  onSkip: () => void
  isPending: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <ScoreBadge score={row.score} />
        <span className="text-xs text-slate-400">
          O expert identificou uma possível duplicata
        </span>
      </div>

      <div className="flex gap-3">
        <TxSide
          label="Importação manual"
          date={row.date}
          description={row.description}
          amount={row.amount}
          direction={row.direction}
        />

        <div className="flex items-center justify-center text-slate-300 shrink-0">
          <GitCompare className="h-5 w-5" />
        </div>

        <TxSide
          label="Banco conectado"
          date={row.pluggy.date}
          description={row.pluggy.description}
          amount={row.pluggy.amount}
          direction={row.pluggy.direction}
          highlight
        />
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <Button
          size="sm"
          variant="outline"
          onClick={onSkip}
          disabled={isPending}
          className="text-slate-600"
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
          Manter ambas
        </Button>
        <Button
          size="sm"
          onClick={onConfirm}
          disabled={isPending}
          className="bg-emerald-700 hover:bg-emerald-800 text-white"
        >
          <Check className="mr-1.5 h-3.5 w-3.5" />
          Confirmar duplicata
        </Button>
      </div>
    </div>
  )
}

export default function ReconciliacaoClient({ rows, total, pages, page }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [processingId, setProcessingId] = useState<string | null>(null)

  function handleConfirm(row: ReconciliationRow) {
    setProcessingId(row.id)
    startTransition(async () => {
      const result = await confirmDuplicate(row.id, row.pluggy.id)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Duplicata confirmada. A importação manual foi marcada como duplicata.')
        router.refresh()
      }
      setProcessingId(null)
    })
  }

  function handleSkip(row: ReconciliationRow) {
    setProcessingId(row.id)
    startTransition(async () => {
      const result = await skipReconciliation(row.id)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Ambas as transações mantidas.')
        router.refresh()
      }
      setProcessingId(null)
    })
  }

  if (rows.length === 0 && page === 1) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.push('/contas')} className="text-slate-500">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar para Contas
          </Button>
        </div>
        <EmptyState
          title="Nenhuma duplicata aguardando revisão"
          description="O expert não identificou transações importadas com possível duplicata no banco conectado."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/contas')} className="text-slate-500">
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar
        </Button>
        <span className="text-sm text-slate-500">
          {total} par{total !== 1 ? 'es' : ''} aguardando revisão
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {rows.map(row => (
          <ReconciliationCard
            key={row.id}
            row={row}
            onConfirm={() => handleConfirm(row)}
            onSkip={() => handleSkip(row)}
            isPending={isPending && processingId === row.id}
          />
        ))}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Página {page} de {pages}</span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isPending}
              onClick={() => router.push(`/transacoes/reconciliacao?page=${page - 1}`)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages || isPending}
              onClick={() => router.push(`/transacoes/reconciliacao?page=${page + 1}`)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
