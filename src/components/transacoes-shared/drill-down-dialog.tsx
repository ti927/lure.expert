'use client'

// Dialog de drill-down genérico — usado em /dre e /balanco.
// O caller decide o título (e.g. "Receita Operacional · jan/25" ou "Banco · 2026-02") e
// fornece as transações já filtradas pelo escopo apropriado. Edição inline, batch e
// delete funcionam direto no banco via server actions.

import { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { classifyTransaction, deleteTransactions } from '@/server/transactions'
import type { DrillDownTransaction, LeafCategory } from '@/lib/dre-types'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'
import { ColHeader } from './col-header'
import { MultiSelectFilter, DescFilter, AmountFilter, DirectionFilter } from './filters'
import { CellCombobox, CategoryCellCombobox } from './cell-combobox'
import { BatchClassifyDialog } from './batch-classify-dialog'
import { ACCT_LABELS } from './types'

function fmtNum(v: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

export interface DrillDownDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string              // ex.: "Receita Operacional · jan/26", "Banco Itaú · fev/26"
  subtitle?: string          // ex.: "Total — jan/25 a dez/25"
  data: DrillDownTransaction[] | null
  loading: boolean
  onDataChange: (next: DrillDownTransaction[]) => void
  leafCategories: LeafCategory[]
  costCenters: CostCenter[]
  businessUnits: BusinessUnit[]
  legalEntities: LegalEntity[]
}

export function DrillDownDialog({
  open, onOpenChange, title, subtitle,
  data, loading, onDataChange,
  leafCategories, costCenters, businessUnits, legalEntities,
}: DrillDownDialogProps) {
  const [localData, setLocalData] = useState<DrillDownTransaction[]>([])

  // Filtros client-side
  const [search, setSearch] = useState<string | undefined>(undefined)
  const [direction, setDirection] = useState<string | undefined>(undefined)
  const [amountMin, setAmountMin] = useState<string | undefined>(undefined)
  const [amountMax, setAmountMax] = useState<string | undefined>(undefined)
  const [catFilter, setCatFilter] = useState<string | undefined>(undefined)
  const [ccFilter, setCcFilter] = useState<string | undefined>(undefined)
  const [buFilter, setBuFilter] = useState<string | undefined>(undefined)
  const [leFilter, setLeFilter] = useState<string | undefined>(undefined)
  const [acctFilter, setAcctFilter] = useState<string | undefined>(undefined)

  const [sort, setSort] = useState<string | undefined>('date_desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchOpen, setBatchOpen] = useState(false)
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([])
  const [isDeleting, setIsDeleting] = useState(false)
  const [classifyingId, setClassifyingId] = useState<string | null>(null)

  // Sincroniza data externa com state local
  useEffect(() => {
    if (data) {
      setLocalData(data)
      setSelectedIds(new Set())
    }
  }, [data])

  // Reset de filtros e seleção ao abrir/fechar
  useEffect(() => {
    if (!open) {
      setSearch(undefined); setDirection(undefined)
      setAmountMin(undefined); setAmountMax(undefined)
      setCatFilter(undefined); setCcFilter(undefined)
      setBuFilter(undefined); setLeFilter(undefined); setAcctFilter(undefined)
      setSelectedIds(new Set()); setSort('date_desc')
    }
  }, [open])

  const acctOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const tx of localData) {
      if (!tx.accountId) continue
      if (seen.has(tx.accountId)) continue
      const label = tx.accountType
        ? `${ACCT_LABELS[tx.accountType] ?? tx.accountType}${tx.accountNumber ? ` · ${tx.accountNumber}` : ''}`
        : tx.accountName ?? 'Conta'
      seen.set(tx.accountId, label)
    }
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }))
  }, [localData])

  const catFilterGroups = useMemo(() => {
    const byType = leafCategories.reduce((acc, c) => {
      if (!acc[c.type]) acc[c.type] = []
      acc[c.type].push({ id: c.id, label: `${c.code} – ${c.name}` })
      return acc
    }, {} as Record<string, { id: string; label: string }[]>)
    return Object.entries(byType).map(([type, items]) => ({ type, items }))
  }, [leafCategories])

  const ccOptions = useMemo(() => costCenters.map(c => ({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name })), [costCenters])
  const buOptions = useMemo(() => businessUnits.map(b => ({ id: b.id, label: b.code ? `${b.code} – ${b.name}` : b.name })), [businessUnits])
  const leOptions = useMemo(() => legalEntities.map(l => ({ id: l.id, label: l.name })), [legalEntities])

  const filtered = useMemo(() => {
    function multiMatch(value: string | null | undefined, filter: string | undefined): boolean {
      if (!filter) return true
      const ids = filter.split(',').filter(Boolean)
      const includeNone = ids.includes('__none__')
      const includeClassified = ids.includes('__classified__')
      const realIds = ids.filter(i => i !== '__none__' && i !== '__classified__')
      if (includeNone && (value === null || value === undefined)) return true
      if (includeClassified && value !== null && value !== undefined) return true
      if (realIds.length > 0 && value && realIds.includes(value)) return true
      return realIds.length === 0 && !includeNone && !includeClassified
    }
    return localData.filter(tx => {
      if (search && !tx.description.toLowerCase().includes(search.toLowerCase())) return false
      if (direction && tx.direction !== direction) return false
      if (amountMin && tx.amount < Number(amountMin)) return false
      if (amountMax && tx.amount > Number(amountMax)) return false
      if (catFilter && !multiMatch(tx.categoryId, catFilter)) return false
      if (ccFilter && !multiMatch(tx.costCenterId, ccFilter)) return false
      if (buFilter && !multiMatch(tx.businessUnitId, buFilter)) return false
      if (leFilter && !multiMatch(tx.legalEntityId, leFilter)) return false
      if (acctFilter && !multiMatch(tx.accountId, acctFilter)) return false
      return true
    })
  }, [localData, search, direction, amountMin, amountMax, catFilter, ccFilter, buFilter, leFilter, acctFilter])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    if (!sort) return arr
    const [field, dir] = sort.split('_') as [string, 'asc' | 'desc']
    const m = dir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      switch (field) {
        case 'date':         av = a.date; bv = b.date; break
        case 'desc':         av = a.description.toLowerCase(); bv = b.description.toLowerCase(); break
        case 'amount':       av = a.amount; bv = b.amount; break
        case 'account':      av = a.accountName ?? ''; bv = b.accountName ?? ''; break
        case 'direction':    av = a.direction; bv = b.direction; break
        case 'category':     av = a.categoryName ?? ''; bv = b.categoryName ?? ''; break
        case 'costcenter':   av = a.costCenterName ?? ''; bv = b.costCenterName ?? ''; break
        case 'businessunit': av = a.businessUnitName ?? ''; bv = b.businessUnitName ?? ''; break
        case 'legalentity':  av = a.legalEntityName ?? ''; bv = b.legalEntityName ?? ''; break
      }
      if (av < bv) return -m
      if (av > bv) return m
      return 0
    })
    return arr
  }, [filtered, sort])

  function toggleSort(key: string) {
    const ascKey  = `${key}_asc`
    const descKey = `${key}_desc`
    if (key === 'date') {
      setSort(prev => (!prev || prev === descKey) ? ascKey : descKey)
    } else {
      setSort(prev => {
        if (!prev || !prev.startsWith(key + '_')) return descKey
        if (prev === descKey) return ascKey
        return undefined
      })
    }
  }

  function toggleRow(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const allSelected = sorted.length > 0 && selectedIds.size === sorted.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < sorted.length

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(sorted.map(t => t.id)))
  }

  async function handleClassify(
    txId: string,
    field: 'categoryId' | 'costCenterId' | 'businessUnitId' | 'legalEntityId',
    newId: string | null,
  ) {
    const nameMap = {
      categoryId:     { nameKey: 'categoryName'     as const, list: leafCategories.map(c => ({ id: c.id, name: c.name })) },
      costCenterId:   { nameKey: 'costCenterName'   as const, list: costCenters.map(c => ({ id: c.id, name: c.name })) },
      businessUnitId: { nameKey: 'businessUnitName' as const, list: businessUnits.map(c => ({ id: c.id, name: c.name })) },
      legalEntityId:  { nameKey: 'legalEntityName'  as const, list: legalEntities.map(c => ({ id: c.id, name: c.name })) },
    }
    const { nameKey, list } = nameMap[field]
    const newName = newId ? (list.find(o => o.id === newId)?.name ?? null) : null

    setClassifyingId(txId)
    const prev = localData
    const next = localData.map(tx =>
      tx.id === txId ? { ...tx, [field]: newId, [nameKey]: newName } : tx
    )
    setLocalData(next)

    const result = await classifyTransaction(txId, { [field]: newId })
    setClassifyingId(null)
    if (result?.error) {
      toast.error(result.error)
      setLocalData(prev)
    } else {
      onDataChange(next)
    }
  }

  async function handleConfirmDelete() {
    if (deleteTargetIds.length === 0) return
    setIsDeleting(true)
    const result = await deleteTransactions(deleteTargetIds)
    setIsDeleting(false)
    const ids = deleteTargetIds
    setDeleteTargetIds([])
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success(`${result.deleted} lançamento${result.deleted !== 1 ? 's' : ''} apagado${result.deleted !== 1 ? 's' : ''}.`)
      const next = localData.filter(tx => !ids.includes(tx.id))
      setLocalData(next)
      setSelectedIds(new Set())
      onDataChange(next)
    }
  }

  function clearAllFilters() {
    setSearch(undefined); setDirection(undefined)
    setAmountMin(undefined); setAmountMax(undefined)
    setCatFilter(undefined); setCcFilter(undefined)
    setBuFilter(undefined); setLeFilter(undefined); setAcctFilter(undefined)
  }

  const hasAnyFilter = !!(search || direction || amountMin || amountMax || catFilter || ccFilter || buFilter || leFilter || acctFilter)
  const totalNet = sorted.reduce((s, t) => s + t.netAmount, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col w-[98vw] max-w-none max-h-[92vh] p-0 sm:rounded-lg">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="text-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate">{title}</span>
              {subtitle && (
                <span className="font-normal text-muted-foreground shrink-0">{subtitle}</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {selectedIds.size > 0 && (
                <Button size="sm" variant="outline" onClick={() => setBatchOpen(true)}>
                  Alterar {selectedIds.size} em lote
                </Button>
              )}
              {hasAnyFilter && (
                <Button size="sm" variant="ghost" onClick={clearAllFilters} className="text-muted-foreground">
                  Limpar filtros
                </Button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {loading && localData.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col min-h-0 flex-1 px-6 pb-2">
            <div className="flex-1 min-h-0 overflow-auto border rounded-lg">
              <table className="w-full text-sm table-fixed [&_td]:border-r [&_th]:border-r [&_td]:border-border/20 [&_th]:border-border/20 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
                <colgroup>
                  <col className="w-9" />
                  <col className="w-[90px]" />
                  <col />
                  <col className="w-[110px]" />
                  <col className="w-[180px]" />
                  <col className="w-[80px]" />
                  <col className="w-[200px]" />
                  <col className="w-[130px]" />
                  <col className="w-[120px]" />
                  <col className="w-[120px]" />
                  <col className="w-9" />
                </colgroup>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted border-b">
                    <th className="px-2 py-1.5 text-left">
                      <input
                        type="checkbox"
                        className="rounded border-input"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected }}
                        onChange={toggleAll}
                      />
                    </th>
                    <th className="px-2 py-1">
                      <ColHeader hasValue={false} onClear={() => {}} sortKey="date" currentSort={sort} onSort={() => toggleSort('date')}>
                        <span className="text-xs font-medium text-muted-foreground px-1">Data</span>
                      </ColHeader>
                    </th>
                    <th className="px-2 py-1">
                      <ColHeader hasValue={!!search} onClear={() => setSearch(undefined)} sortKey="desc" currentSort={sort} onSort={() => toggleSort('desc')}>
                        <DescFilter value={search} onUpdate={setSearch} />
                      </ColHeader>
                    </th>
                    <th className="px-2 py-1">
                      <ColHeader hasValue={!!(amountMin || amountMax)} onClear={() => { setAmountMin(undefined); setAmountMax(undefined) }} sortKey="amount" currentSort={sort} onSort={() => toggleSort('amount')}>
                        <AmountFilter amountMin={amountMin} amountMax={amountMax} onUpdate={u => { setAmountMin(u.amountMin); setAmountMax(u.amountMax) }} />
                      </ColHeader>
                    </th>
                    <th className="px-2 py-1">
                      <ColHeader hasValue={!!acctFilter} onClear={() => setAcctFilter(undefined)} sortKey="account" currentSort={sort} onSort={() => toggleSort('account')}>
                        <MultiSelectFilter placeholder="Banco/Conta" value={acctFilter} options={acctOptions} onUpdate={setAcctFilter} width="w-72" />
                      </ColHeader>
                    </th>
                    <th className="px-2 py-1">
                      <ColHeader hasValue={!!direction} onClear={() => setDirection(undefined)} sortKey="direction" currentSort={sort} onSort={() => toggleSort('direction')}>
                        <DirectionFilter value={direction} onUpdate={setDirection} />
                      </ColHeader>
                    </th>
                    <th className="px-2 py-1">
                      <ColHeader hasValue={!!catFilter} onClear={() => setCatFilter(undefined)} sortKey="category" currentSort={sort} onSort={() => toggleSort('category')}>
                        <MultiSelectFilter placeholder="Categoria" value={catFilter} options={[]} grouped={catFilterGroups} showSpecial onUpdate={setCatFilter} width="w-72" />
                      </ColHeader>
                    </th>
                    <th className="px-2 py-1">
                      <ColHeader hasValue={!!ccFilter} onClear={() => setCcFilter(undefined)} sortKey="costcenter" currentSort={sort} onSort={() => toggleSort('costcenter')}>
                        <MultiSelectFilter placeholder="C. custo" value={ccFilter} options={ccOptions} showSpecial onUpdate={setCcFilter} />
                      </ColHeader>
                    </th>
                    <th className="px-2 py-1">
                      <ColHeader hasValue={!!buFilter} onClear={() => setBuFilter(undefined)} sortKey="businessunit" currentSort={sort} onSort={() => toggleSort('businessunit')}>
                        <MultiSelectFilter placeholder="Un. negócio" value={buFilter} options={buOptions} showSpecial onUpdate={setBuFilter} />
                      </ColHeader>
                    </th>
                    <th className="px-2 py-1">
                      <ColHeader hasValue={!!leFilter} onClear={() => setLeFilter(undefined)} sortKey="legalentity" currentSort={sort} onSort={() => toggleSort('legalentity')}>
                        <MultiSelectFilter placeholder="Entidade" value={leFilter} options={leOptions} showSpecial onUpdate={setLeFilter} />
                      </ColHeader>
                    </th>
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(tx => {
                    const isClassifying = classifyingId === tx.id
                    const acctLabel = tx.accountType ? (ACCT_LABELS[tx.accountType] ?? tx.accountType) : null
                    const acctStr = acctLabel
                      ? (tx.accountNumber ? `${acctLabel} · ${tx.accountNumber}` : acctLabel)
                      : null

                    return (
                      <tr key={tx.id} className="group border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-2 py-1.5">
                          <input type="checkbox" className="rounded border-input" checked={selectedIds.has(tx.id)} onChange={() => toggleRow(tx.id)} />
                        </td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                          {fmtDate(tx.date)}
                        </td>
                        <td className="px-2 py-1.5 overflow-hidden">
                          <div className="truncate text-xs">{tx.description}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                          <span className={cn('font-medium text-xs', tx.direction === 'inflow' ? 'text-emerald-600' : 'text-rose-600')}>
                            {tx.direction === 'outflow' && '−'}{fmtNum(tx.amount)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground">
                          <div className="flex items-center gap-2 min-w-0">
                            {tx.connectionLogoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={tx.connectionLogoUrl} alt="" className="h-5 w-5 rounded object-contain shrink-0" />
                            ) : null}
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="truncate">{acctStr ?? '—'}</span>
                              {tx.connectionBadge && (
                                <span className="inline-flex items-center self-start rounded px-1 py-0 text-[10px] font-medium bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                                  {tx.connectionBadge}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={cn(
                            'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                            tx.direction === 'inflow' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
                          )}>
                            {tx.direction === 'inflow' ? 'Entrada' : 'Saída'}
                          </span>
                        </td>
                        <td className="px-1 py-1">
                          <CategoryCellCombobox
                            value={tx.categoryId}
                            categories={leafCategories.map(c => ({ id: c.id, name: c.name, code: c.code, type: c.type, parentId: null }))}
                            onValueChange={v => handleClassify(tx.id, 'categoryId', v)}
                            disabled={isClassifying}
                          />
                        </td>
                        <td className="px-1 py-1">
                          <CellCombobox
                            value={tx.costCenterId}
                            options={costCenters.map(c => ({ id: c.id, name: c.name, code: c.code }))}
                            onValueChange={v => handleClassify(tx.id, 'costCenterId', v)}
                            disabled={isClassifying}
                          />
                        </td>
                        <td className="px-1 py-1">
                          <CellCombobox
                            value={tx.businessUnitId}
                            options={businessUnits.map(c => ({ id: c.id, name: c.name, code: c.code }))}
                            onValueChange={v => handleClassify(tx.id, 'businessUnitId', v)}
                            disabled={isClassifying}
                          />
                        </td>
                        <td className="px-1 py-1">
                          <CellCombobox
                            value={tx.legalEntityId}
                            options={legalEntities.map(c => ({ id: c.id, name: c.name }))}
                            onValueChange={v => handleClassify(tx.id, 'legalEntityId', v)}
                            disabled={isClassifying}
                          />
                        </td>
                        <td className="px-1 py-1 text-center">
                          <button
                            onClick={() => setDeleteTargetIds([tx.id])}
                            className="h-7 w-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                            title="Apagar lançamento"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {sorted.length === 0 && (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  {localData.length === 0 ? 'Sem transações para exibir.' : 'Nenhuma transação corresponde aos filtros.'}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t pt-2.5 mt-2 text-xs shrink-0">
              <span className="text-muted-foreground">{sorted.length} transaç{sorted.length !== 1 ? 'ões' : 'ão'}</span>
              <span className={cn('font-semibold tabular-nums', totalNet >= 0 ? 'text-emerald-700' : 'text-rose-600')}>
                Total: {fmtNum(totalNet)}
              </span>
            </div>
          </div>
        )}

        <BatchClassifyDialog
          open={batchOpen}
          onOpenChange={setBatchOpen}
          selectedIds={Array.from(selectedIds)}
          categories={leafCategories.map(c => ({ id: c.id, name: c.name, code: c.code, type: c.type, parentId: null }))}
          costCenters={costCenters.map(c => ({ id: c.id, name: c.name, code: c.code }))}
          businessUnits={businessUnits.map(c => ({ id: c.id, name: c.name, code: c.code }))}
          legalEntities={legalEntities.map(c => ({ id: c.id, name: c.name }))}
          onSuccess={() => { setSelectedIds(new Set()) }}
        />

        <AlertDialog open={deleteTargetIds.length > 0} onOpenChange={open => { if (!open) setDeleteTargetIds([]) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apagar {deleteTargetIds.length} lançamento{deleteTargetIds.length !== 1 ? 's' : ''}?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação não pode ser desfeita. O lançamento será removido permanentemente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                {isDeleting ? 'Apagando...' : 'Apagar'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
