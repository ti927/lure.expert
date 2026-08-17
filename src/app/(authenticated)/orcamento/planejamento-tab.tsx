'use client'

import { Fragment, useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, Loader2, Pencil, Trash2, CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/states/empty-state'
import { ColHeader } from '@/components/transacoes-shared/col-header'
import {
  MultiSelectFilter, DescFilter, DirectionFilter, AmountFilter,
} from '@/components/transacoes-shared/filters'
import type {
  CategoryItem, SimpleDimensionItem, DimensionOption, GroupedDimensionOption,
} from '@/components/transacoes-shared/types'
import { cn } from '@/lib/utils'
import { fmtMoney, monthLabel, dateLabel } from '@/lib/format'
import {
  AMOUNT_MODES, AMOUNT_MODE_LABELS, ADJUSTABLE_FIELD_LABELS, intervalLabel,
  type BudgetSeriesListItem, type BudgetEntryListItem, type BudgetVersionListItem,
} from '@/lib/budget-types'
import {
  getBudgetSeriesEntries, deleteBudgetSeries, deleteBudgetEntry, updateBudgetEntry,
} from '@/server/budget'
import { SeriesDialog } from './series-dialog'

// Chave própria: `lure:orcamento:filters` guarda versão + aba no shell.
const STORAGE_KEY = 'lure:orcamento:planejamento:filters'
const PAGE_SIZE = 100

type SortKey = 'description' | 'start' | 'total' | ''

interface Filters {
  desc?: string
  direction?: string
  category?: string
  costCenter?: string
  start?: string
  interval?: string
  mode?: string
  amountMin?: string
  amountMax?: string
}

/** Semântica do multi-select: valor é CSV de ids; vazio = sem filtro. */
function multiMatch(value: string | null, filter: string | undefined): boolean {
  if (!filter) return true
  return filter.split(',').filter(Boolean).includes(value ?? '')
}

interface Props {
  version: BudgetVersionListItem
  series: BudgetSeriesListItem[]
  isPending: boolean
  costCenters: SimpleDimensionItem[]
  businessUnits: SimpleDimensionItem[]
  legalEntities: SimpleDimensionItem[]
  leafCategories: CategoryItem[]
  contactOptions: SimpleDimensionItem[]
  onChanged: () => void
}

export function PlanejamentoTab({
  version, series, isPending,
  costCenters, businessUnits, legalEntities, leafCategories, contactOptions,
  onChanged,
}: Props) {
  const [filters, setFilters] = useState<Filters>({})
  const [sort, setSort] = useState<SortKey>('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [entriesBySeries, setEntriesBySeries] = useState<Record<string, BudgetEntryListItem[]>>({})
  const [loadingSeries, setLoadingSeries] = useState<Set<string>>(new Set())

  const [editing, setEditing] = useState<BudgetSeriesListItem | null>(null)
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'series'; id: string; label: string; entryCount: number; adjustedCount: number }
    | { kind: 'entry'; id: string; label: string; seriesId: string; sequence: number; following: number }
    | null
  >(null)
  // Escopo da exclusão de ocorrência: só esta ou desta em diante.
  const [deleteScope, setDeleteScope] = useState<'esta' | 'daqui'>('esta')
  const [isMutating, startMutation] = useTransition()

  const isArchived = version.status === 'arquivado'

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setFilters(JSON.parse(raw) as Filters)
    } catch { /* ignora */ }
  }, [])

  const update = useCallback((patch: Partial<Filters>) => {
    setFilters(prev => {
      const next = { ...prev, ...patch }
      for (const k of Object.keys(next) as (keyof Filters)[]) if (!next[k]) delete next[k]
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignora */ }
      return next
    })
    setPage(1)
  }, [])

  function clearAll() {
    setFilters({})
    setPage(1)
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignora */ }
  }

  function toggleSort(key: SortKey) {
    if (sort !== key) { setSort(key); setSortDir(key === 'total' ? 'desc' : 'asc'); return }
    if (sortDir === 'asc') { setSortDir('desc'); return }
    setSort(''); setSortDir('asc')
  }

  const currentSort = sort ? `${sort}_${sortDir}` : ''

  // ── Opções de filtro derivadas do conjunto carregado ──
  const categoryGroups: GroupedDimensionOption[] = useMemo(() => {
    const byType = new Map<string, Map<string, string>>()
    for (const s of series) {
      if (!byType.has(s.categoryType)) byType.set(s.categoryType, new Map())
      byType.get(s.categoryType)!.set(s.categoryId, s.categoryCode ? `${s.categoryCode} – ${s.categoryName}` : s.categoryName)
    }
    return Array.from(byType.entries()).map(([type, items]) => ({
      type,
      items: Array.from(items.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    }))
  }, [series])

  const costCenterOptions: DimensionOption[] = useMemo(() => {
    const seen = new Map<string, string>()
    for (const s of series) if (s.costCenterId && s.costCenterName) seen.set(s.costCenterId, s.costCenterName)
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }))
  }, [series])

  const startOptions: DimensionOption[] = useMemo(() => {
    const seen = new Set(series.map(s => s.startMonth))
    return Array.from(seen).sort().map(m => ({ id: m, label: monthLabel(m) }))
  }, [series])

  const intervalOptions: DimensionOption[] = useMemo(() => {
    const seen = new Set(series.map(s => s.intervalMonths))
    return Array.from(seen).sort((a, b) => a - b).map(m => ({ id: String(m), label: intervalLabel(m) }))
  }, [series])

  const modeOptions: DimensionOption[] = AMOUNT_MODES.map(m => ({ id: m, label: AMOUNT_MODE_LABELS[m] }))

  // ── Filtro + ordenação (client-side: uma versão tem dezenas de séries) ──
  const filtered = useMemo(() => {
    const min = filters.amountMin ? Number(filters.amountMin) : null
    const max = filters.amountMax ? Number(filters.amountMax) : null
    const desc = filters.desc?.toLowerCase()

    const rows = series.filter(s => {
      if (desc && !s.description.toLowerCase().includes(desc)) return false
      if (filters.direction && s.direction !== filters.direction) return false
      if (!multiMatch(s.categoryId, filters.category)) return false
      if (!multiMatch(s.costCenterId, filters.costCenter)) return false
      if (!multiMatch(s.startMonth, filters.start)) return false
      if (!multiMatch(String(s.intervalMonths), filters.interval)) return false
      if (!multiMatch(s.amountMode, filters.mode)) return false
      if (min !== null && s.annualTotal < min) return false
      if (max !== null && s.annualTotal > max) return false
      return true
    })

    if (sort) {
      const factor = sortDir === 'asc' ? 1 : -1
      rows.sort((a, b) => {
        if (sort === 'description') return factor * a.description.localeCompare(b.description)
        if (sort === 'start') return factor * a.startMonth.localeCompare(b.startMonth)
        return factor * (a.annualTotal - b.annualTotal)
      })
    }
    return rows
  }, [series, filters, sort, sortDir])

  const totals = useMemo(() => {
    let inflow = 0, outflow = 0
    for (const s of filtered) {
      if (s.direction === 'inflow') inflow += s.annualTotal
      else outflow += s.annualTotal
    }
    return { inflow, outflow, net: inflow - outflow }
  }, [filtered])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasFilters = Object.keys(filters).length > 0

  // ── Expansão das ocorrências (carregadas sob demanda) ──
  function toggleExpand(seriesId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(seriesId)) { next.delete(seriesId); return next }
      next.add(seriesId)
      if (!entriesBySeries[seriesId]) void loadEntries(seriesId)
      return next
    })
  }

  const loadEntries = useCallback(async (seriesId: string) => {
    setLoadingSeries(prev => new Set(prev).add(seriesId))
    try {
      const rows = await getBudgetSeriesEntries(seriesId)
      setEntriesBySeries(prev => ({ ...prev, [seriesId]: rows }))
    } finally {
      setLoadingSeries(prev => { const n = new Set(prev); n.delete(seriesId); return n })
    }
  }, [])

  function saveEntryAmount(entry: BudgetEntryListItem, raw: string) {
    const value = Number(raw.replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) { toast.error('Valor inválido.'); return }
    if (value === entry.amount) return

    startMutation(async () => {
      const result = await updateBudgetEntry(entry.id, { amount: value })
      if ('error' in result && result.error) { toast.error(result.error); return }
      await loadEntries(entry.seriesId)
      onChanged()
    })
  }

  function confirmDelete() {
    if (!pendingDelete) return
    const target = pendingDelete
    startMutation(async () => {
      let result: { error?: string } = {}

      if (target.kind === 'series') {
        result = await deleteBudgetSeries(target.id, { scope: 'todas' })
      } else if (deleteScope === 'daqui') {
        // Trunca a regra: occurrences cai para (sequência − 1).
        result = await deleteBudgetSeries(target.seriesId, { scope: 'daqui', fromSequence: target.sequence })
      } else {
        // Só esta: a regra não muda e a sequência fica com um buraco, por design.
        result = await deleteBudgetEntry(target.id)
      }

      if (result.error) { toast.error(result.error); return }

      if (target.kind === 'series') {
        toast.success('Lançamento excluído.')
        setExpanded(prev => { const n = new Set(prev); n.delete(target.id); return n })
      } else if (deleteScope === 'daqui') {
        toast.success(`Ocorrências de ${target.label} em diante excluídas.`)
        await loadEntries(target.seriesId)
      } else {
        toast.success(`Ocorrência de ${target.label} excluída.`)
        await loadEntries(target.seriesId)
      }
      setPendingDelete(null)
      onChanged()
    })
  }

  if (series.length === 0 && !hasFilters) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <EmptyState
          icon={<CalendarClock className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title={`Nenhuma previsão em ${version.name}`}
          description="Lance a primeira previsão de recebimento ou pagamento em Novo lançamento, no topo da tela."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Zona 2: totalizador ── */}
      <div className="shrink-0 px-6 pb-3 flex items-center gap-6 flex-wrap text-xs">
        <span className="text-muted-foreground">
          <span className="tabular-nums font-medium text-foreground">{filtered.length}</span>
          {filtered.length === 1 ? ' lançamento' : ' lançamentos'}
          {hasFilters && <span className="text-muted-foreground"> de {series.length}</span>}
        </span>
        <span className="text-muted-foreground">
          Entradas <span className="tabular-nums font-medium text-emerald-700">{fmtMoney(totals.inflow)}</span>
        </span>
        <span className="text-muted-foreground">
          Saídas <span className="tabular-nums font-medium text-rose-600">{fmtMoney(totals.outflow)}</span>
        </span>
        <span className="text-muted-foreground">
          Líquido <span className={cn('tabular-nums font-semibold', totals.net >= 0 ? 'text-emerald-700' : 'text-rose-600')}>
            {fmtMoney(totals.net)}
          </span>
        </span>
        {hasFilters && (
          <button onClick={clearAll} className="text-primary hover:underline">Limpar tudo</button>
        )}
        {isArchived && (
          <span className="ml-auto text-amber-600">Versão arquivada — somente leitura.</span>
        )}
      </div>

      {/* ── Zona 4: tabela ── */}
      <div className="flex-1 min-h-0 overflow-hidden px-6">
        <div className={cn('h-full overflow-auto border rounded-lg', isPending && 'opacity-50 pointer-events-none')}>
          <table className="w-full text-xs border-collapse [&_td]:border-r [&_th]:border-r [&_td]:border-border/20 [&_th]:border-border/20 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted border-b">
                <th className="w-8" />
                <th className="text-left px-1 min-w-[220px]">
                  <ColHeader hasValue={!!filters.desc} onClear={() => update({ desc: undefined })}
                    sortKey="description" currentSort={currentSort} onSort={() => toggleSort('description')}>
                    <DescFilter value={filters.desc} onUpdate={v => update({ desc: v })} />
                  </ColHeader>
                </th>
                <th className="text-left px-1 w-24">
                  <ColHeader hasValue={!!filters.direction} onClear={() => update({ direction: undefined })}>
                    <DirectionFilter value={filters.direction} onUpdate={v => update({ direction: v })} />
                  </ColHeader>
                </th>
                <th className="text-left px-1 min-w-[180px]">
                  <ColHeader hasValue={!!filters.category} onClear={() => update({ category: undefined })}>
                    <MultiSelectFilter placeholder="Categoria" value={filters.category} options={[]}
                      grouped={categoryGroups} width="w-72" onUpdate={v => update({ category: v })} />
                  </ColHeader>
                </th>
                <th className="text-left px-1 w-36">
                  <ColHeader hasValue={!!filters.costCenter} onClear={() => update({ costCenter: undefined })}>
                    <MultiSelectFilter placeholder="Centro de custo" value={filters.costCenter}
                      options={costCenterOptions} onUpdate={v => update({ costCenter: v })} />
                  </ColHeader>
                </th>
                <th className="text-left px-1 w-24">
                  <ColHeader hasValue={!!filters.start} onClear={() => update({ start: undefined })}
                    sortKey="start" currentSort={currentSort} onSort={() => toggleSort('start')}>
                    <MultiSelectFilter placeholder="Início" value={filters.start} options={startOptions}
                      width="w-44" onUpdate={v => update({ start: v })} />
                  </ColHeader>
                </th>
                <th className="text-left px-1 w-32">
                  <ColHeader hasValue={!!filters.interval} onClear={() => update({ interval: undefined })}>
                    <MultiSelectFilter placeholder="Repetição" value={filters.interval} options={intervalOptions}
                      width="w-44" onUpdate={v => update({ interval: v })} />
                  </ColHeader>
                </th>
                <th className="text-left px-1 w-32">
                  <ColHeader hasValue={!!filters.mode} onClear={() => update({ mode: undefined })}>
                    <MultiSelectFilter placeholder="Modo" value={filters.mode} options={modeOptions}
                      width="w-52" onUpdate={v => update({ mode: v })} />
                  </ColHeader>
                </th>
                <th className="text-right px-1 w-32">
                  <ColHeader hasValue={!!(filters.amountMin || filters.amountMax)}
                    onClear={() => update({ amountMin: undefined, amountMax: undefined })}
                    sortKey="total" currentSort={currentSort} onSort={() => toggleSort('total')}>
                    <AmountFilter amountMin={filters.amountMin} amountMax={filters.amountMax}
                      onUpdate={u => update({ amountMin: u.amountMin, amountMax: u.amountMax })} />
                  </ColHeader>
                </th>
                <th className="w-20" />
              </tr>
            </thead>

            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhum lançamento com esses filtros.
                  </td>
                </tr>
              )}

              {visible.map(s => {
                const isOpen = expanded.has(s.id)
                const entries = entriesBySeries[s.id]
                const diverged = s.entryCount !== s.occurrences

                return (
                  <Fragment key={s.id}>
                    <tr className="border-b hover:bg-muted/40">
                      <td className="text-center">
                        <button onClick={() => toggleExpand(s.id)} className="h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-foreground">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="font-medium">{s.description}</span>
                        {s.adjustedCount > 0 && (
                          <span className="ml-2 text-[10px] rounded px-1.5 py-0.5 bg-amber-500/15 text-amber-600 tabular-nums">
                            {s.adjustedCount} ajustada{s.adjustedCount > 1 ? 's' : ''}
                          </span>
                        )}
                        {s.notes && <p className="text-[11px] text-muted-foreground truncate">{s.notes}</p>}
                      </td>
                      <td className={cn('px-2 py-1.5', s.direction === 'inflow' ? 'text-emerald-700' : 'text-rose-600')}>
                        {s.direction === 'inflow' ? 'Entrada' : 'Saída'}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="truncate block">{s.categoryCode ? `${s.categoryCode} – ${s.categoryName}` : s.categoryName}</span>
                        {s.parentName && <span className="text-[11px] text-muted-foreground truncate block">{s.parentName}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground truncate">{s.costCenterName ?? '—'}</td>
                      <td className="px-2 py-1.5 tabular-nums">{monthLabel(s.startMonth)}</td>
                      <td className="px-2 py-1.5">
                        <span className="tabular-nums font-medium">{s.entryCount}×</span>
                        <span className="text-muted-foreground"> {intervalLabel(s.intervalMonths).toLowerCase()}</span>
                        {diverged && (
                          <span
                            className="ml-1 text-[10px] text-amber-600"
                            title={`A regra geraria ${s.occurrences}; existem ${s.entryCount} após exclusões pontuais.`}
                          >
                            ≠{s.occurrences}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{AMOUNT_MODE_LABELS[s.amountMode]}</td>
                      <td className={cn('px-2 py-1.5 text-right tabular-nums font-medium',
                        s.direction === 'inflow' ? 'text-emerald-700' : 'text-rose-600')}>
                        {fmtMoney(s.annualTotal)}
                      </td>
                      <td className="px-1 py-1.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            onClick={() => setEditing(s)}
                            disabled={isArchived}
                            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
                            title="Editar lançamento"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => setPendingDelete({
                              kind: 'series', id: s.id, label: s.description,
                              entryCount: s.entryCount, adjustedCount: s.adjustedCount,
                            })}
                            disabled={isArchived}
                            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
                            title="Excluir lançamento"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="border-b bg-muted/20">
                        <td />
                        <td colSpan={9} className="px-2 py-2">
                          {loadingSeries.has(s.id) || !entries ? (
                            <div className="flex items-center gap-2 text-muted-foreground py-2">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando ocorrências…
                            </div>
                          ) : entries.length === 0 ? (
                            <p className="text-muted-foreground py-2">
                              Nenhuma ocorrência. Edite o lançamento para regenerá-las.
                            </p>
                          ) : (
                            <table className="w-full text-[11px] border-collapse">
                              <thead>
                                <tr className="text-muted-foreground border-b border-border/40">
                                  <th className="text-left font-medium py-1 w-10">#</th>
                                  <th className="text-left font-medium py-1 w-28">Competência</th>
                                  <th className="text-left font-medium py-1 w-28">Caixa</th>
                                  <th className="text-right font-medium py-1 w-32">Valor (R$)</th>
                                  <th className="text-left font-medium py-1 pl-3">Ajustes</th>
                                  <th className="w-8" />
                                </tr>
                              </thead>
                              <tbody>
                                {entries.map(e => (
                                  <tr key={e.id} className="border-b border-border/30 last:border-b-0">
                                    <td className="py-1 tabular-nums text-muted-foreground">{e.sequence}</td>
                                    <td className="py-1 tabular-nums">{dateLabel(e.competenceDate)}</td>
                                    <td className={cn('py-1 tabular-nums',
                                      e.cashDate.slice(0, 4) !== String(version.fiscalYear) && 'text-amber-600')}>
                                      {dateLabel(e.cashDate)}
                                    </td>
                                    <td className="py-1 text-right">
                                      <input
                                        type="number" min={0} step="0.01"
                                        defaultValue={e.amount}
                                        disabled={isArchived || isMutating}
                                        onBlur={ev => saveEntryAmount(e, ev.target.value)}
                                        onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
                                        className={cn(
                                          'w-28 h-6 rounded border px-1.5 text-right tabular-nums bg-transparent',
                                          'border-transparent hover:border-input focus:border-input focus:bg-background focus:outline-none',
                                          'disabled:opacity-50 disabled:pointer-events-none',
                                          e.adjustedFields.includes('amount') && 'text-amber-700 font-medium',
                                        )}
                                      />
                                    </td>
                                    <td className="py-1 pl-3 text-muted-foreground">
                                      {e.adjustedFields.length === 0
                                        ? '—'
                                        : e.adjustedFields.map(f => ADJUSTABLE_FIELD_LABELS[f]).join(', ')}
                                    </td>
                                    <td className="py-1 text-right">
                                      <button
                                        onClick={() => {
                                          setDeleteScope('esta')
                                          setPendingDelete({
                                            kind: 'entry', id: e.id, seriesId: s.id,
                                            label: monthLabel(e.competenceDate),
                                            sequence: e.sequence,
                                            following: entries.filter(x => x.sequence > e.sequence).length,
                                          })
                                        }}
                                        disabled={isArchived}
                                        className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
                                        title="Excluir só esta ocorrência"
                                      >
                                        <Trash2 className="h-2.5 w-2.5" />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Zona 5: rodapé (só quando há mais de uma página) ── */}
      {pages > 1 && (
        <div className="shrink-0 px-6 py-2 flex items-center justify-end gap-2 text-xs">
          <Button variant="outline" size="sm" className="h-7 text-xs"
            disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
          <span className="text-muted-foreground tabular-nums">Página {page} de {pages}</span>
          <Button variant="outline" size="sm" className="h-7 text-xs"
            disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Próxima</Button>
        </div>
      )}

      {editing && (
        <SeriesDialog
          open={!!editing}
          onOpenChange={open => { if (!open) setEditing(null) }}
          mode="edit"
          versionId={version.id}
          fiscalYear={version.fiscalYear}
          initial={editing}
          leafCategories={leafCategories}
          costCenters={costCenters}
          businessUnits={businessUnits}
          legalEntities={legalEntities}
          contactOptions={contactOptions}
          onSaved={() => {
            const id = editing.id
            setEditing(null)
            setEntriesBySeries(prev => { const n = { ...prev }; delete n[id]; return n })
            if (expanded.has(id)) void loadEntries(id)
            onChanged()
          }}
        />
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={open => { if (!open) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === 'series' ? 'Excluir lançamento?' : 'Excluir esta ocorrência?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === 'series' ? (
                <>
                  &quot;{pendingDelete.label}&quot; e suas {pendingDelete.entryCount} ocorrências serão removidas.
                  {pendingDelete.adjustedCount > 0 && (
                    <> {pendingDelete.adjustedCount} delas {pendingDelete.adjustedCount > 1 ? 'foram ajustadas' : 'foi ajustada'} à mão.</>
                  )}
                </>
              ) : (
                <>Escolha o alcance da exclusão.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pendingDelete?.kind === 'entry' && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setDeleteScope('esta')}
                className={cn('w-full text-left rounded-md border px-2 py-1.5 transition-colors',
                  deleteScope === 'esta' ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted')}
              >
                <span className={cn('text-xs font-medium', deleteScope === 'esta' ? 'text-primary' : 'text-foreground')}>
                  Somente {pendingDelete.label}
                </span>
                <span className="block text-[11px] text-muted-foreground leading-snug">
                  A regra do lançamento não muda — a sequência fica com um buraco, o que é esperado.
                </span>
              </button>

              {pendingDelete.following > 0 && (
                <button
                  type="button"
                  onClick={() => setDeleteScope('daqui')}
                  className={cn('w-full text-left rounded-md border px-2 py-1.5 transition-colors',
                    deleteScope === 'daqui' ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted')}
                >
                  <span className={cn('text-xs font-medium', deleteScope === 'daqui' ? 'text-primary' : 'text-foreground')}>
                    {pendingDelete.label} e as {pendingDelete.following} seguintes
                  </span>
                  <span className="block text-[11px] text-muted-foreground leading-snug">
                    A regra passa a ter {pendingDelete.sequence - 1} ocorrência{pendingDelete.sequence - 1 === 1 ? '' : 's'} —
                    truncar o fim é seguro.
                  </span>
                </button>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isMutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isMutating ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
