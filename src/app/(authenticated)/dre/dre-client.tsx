'use client'

import { useState, useTransition, useMemo, useEffect } from 'react'
import { toast } from 'sonner'
import {
  Check, ChevronsUpDown, X, Loader2, BarChart3, Trash2,
  ChevronRight, ChevronDown, ChevronsDown, ChevronsUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/states/empty-state'
import { cn } from '@/lib/utils'
import { getDreData, getDreDrillDown } from '@/server/dre'
import { classifyTransaction, deleteTransactions } from '@/server/transactions'
import type {
  DreData, DreMonthSubtotals, DreCategoryRow, DreType, DrillDownTransaction, LeafCategory,
} from '@/lib/dre-types'
import { DRE_TYPE_LABELS } from '@/lib/dre-types'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'
import { ColHeader } from '@/components/transacoes-shared/col-header'
import {
  MultiSelectFilter, DescFilter, AmountFilter, DirectionFilter,
} from '@/components/transacoes-shared/filters'
import { CellCombobox, CategoryCellCombobox } from '@/components/transacoes-shared/cell-combobox'
import { BatchClassifyDialog } from '@/components/transacoes-shared/batch-classify-dialog'
import { ACCT_LABELS } from '@/components/transacoes-shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type SubtotalNumericKey = Exclude<keyof DreMonthSubtotals, 'month'>

type LayoutSection = {
  types: DreType[]
  subtotalKey: SubtotalNumericKey
  subtotalLabel: string
  keyMetric?: boolean
}

type ChildNode = {
  categoryId: string
  categoryName: string
  categoryCode: string
  byMonth: Record<string, number>
}

type ParentNode = {
  parentId: string
  parentName: string
  parentCode: string
  children: ChildNode[]
}

type SectionBlock = {
  type: DreType
  parents: ParentNode[]
}

type DrillDownState = {
  categoryId: string
  categoryName: string
  month: string
  dateRange?: { from: string; to: string }
}

// ─── Layout ───────────────────────────────────────────────────────────────────

const LAYOUT: LayoutSection[] = [
  { types: ['receita_operacional'], subtotalKey: 'receitaBruta', subtotalLabel: 'Receita Bruta' },
  { types: ['deducoes_tributarias', 'deducoes_operacionais'], subtotalKey: 'receitaLiquida', subtotalLabel: 'Receita Líquida' },
  { types: ['cpv'], subtotalKey: 'lucroBruto', subtotalLabel: 'Lucro Bruto' },
  { types: ['sga'], subtotalKey: 'ebitda', subtotalLabel: 'EBITDA' },
  { types: ['resultado_financeiro'], subtotalKey: 'lair', subtotalLabel: 'LAIR' },
  { types: ['ir'], subtotalKey: 'lucroLiquido', subtotalLabel: 'Lucro Líquido', keyMetric: true },
]

const BELOW_LAYOUT: LayoutSection = {
  types: ['emprestimos_amortizacoes', 'investimentos_retiradas', 'transfer'],
  subtotalKey: 'variacaoCaixa',
  subtotalLabel: 'Variação de Caixa',
}

const PT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const COL_W = 96
const TOTAL_COL_W = 106
const LABEL_W = 260

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${PT_MONTHS[m - 1]}/${String(y).slice(2)}`
}

function fmtNum(v: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

function buildBlocks(rows: DreCategoryRow[], types: DreType[]): SectionBlock[] {
  return types.map(type => {
    const parentMap = new Map<string, { parent: ParentNode; childMap: Map<string, ChildNode> }>()

    rows.filter(r => r.categoryType === type).forEach(row => {
      if (!parentMap.has(row.parentId)) {
        parentMap.set(row.parentId, {
          parent: { parentId: row.parentId, parentName: row.parentName, parentCode: row.parentCode, children: [] },
          childMap: new Map(),
        })
      }
      const entry = parentMap.get(row.parentId)!
      if (!entry.childMap.has(row.categoryId)) {
        entry.childMap.set(row.categoryId, {
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          categoryCode: row.categoryCode,
          byMonth: {},
        })
      }
      entry.childMap.get(row.categoryId)!.byMonth[row.month] = row.netAmount
    })

    const parents = Array.from(parentMap.values())
      .sort((a, b) => a.parent.parentCode.localeCompare(b.parent.parentCode))
      .map(({ parent, childMap }) => ({
        ...parent,
        children: Array.from(childMap.values())
          .sort((a, b) => a.categoryCode.localeCompare(b.categoryCode)),
      }))

    return { type, parents }
  }).filter(b => b.parents.length > 0)
}

// ─── DimFilter ────────────────────────────────────────────────────────────────

type DimOption = { id: string; name: string; code?: string | null }

function DimFilter({
  label, options, selected, onChange,
}: {
  label: string
  options: DimOption[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  if (options.length === 0) return null

  const displayText = selected.length === 0
    ? label
    : selected.length === 1
    ? (options.find(o => o.id === selected[0])?.name ?? label)
    : `${label}: ${selected.length}`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('h-8 gap-1.5 text-xs font-normal', selected.length > 0 && 'border-primary/30 bg-primary/5')}
        >
          <span className="truncate max-w-[140px]">{displayText}</span>
          {selected.length > 0 ? (
            <X
              className="h-3 w-3 shrink-0 opacity-50 hover:opacity-100"
              onClick={e => { e.stopPropagation(); onChange([]) }}
            />
          ) : (
            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar..." className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              Nenhum resultado.
            </CommandEmpty>
            <CommandGroup>
              {options.map(opt => {
                const checked = selected.includes(opt.id)
                return (
                  <CommandItem
                    key={opt.id}
                    value={`${opt.code ?? ''} ${opt.name}`}
                    onSelect={() => onChange(checked ? selected.filter(s => s !== opt.id) : [...selected, opt.id])}
                    className="text-xs"
                  >
                    <Check className={cn('mr-2 h-3 w-3 shrink-0', checked ? 'opacity-100' : 'opacity-0')} />
                    {opt.code && <span className="text-muted-foreground mr-1 font-mono text-[10px] shrink-0">{opt.code}</span>}
                    <span className="truncate">{opt.name}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Amount cell ──────────────────────────────────────────────────────────────

function Num({
  value, bold, light, inverted, onClick,
}: {
  value: number
  bold?: boolean
  light?: boolean
  inverted?: boolean
  onClick?: () => void
}) {
  const isZero = value === 0
  const clickable = !isZero && !!onClick

  let colorClass: string
  if (isZero) {
    colorClass = light ? 'text-muted-foreground/25' : 'text-muted-foreground/40'
  } else if (inverted) {
    colorClass = value > 0 ? 'text-emerald-300' : 'text-rose-300'
  } else {
    colorClass = value > 0 ? 'text-emerald-700' : 'text-rose-600'
  }

  return (
    <td
      className={cn(
        'px-3 py-[3px] text-right tabular-nums text-xs',
        bold && 'font-semibold',
        colorClass,
        clickable && 'cursor-pointer hover:underline underline-offset-2',
      )}
      onClick={clickable ? onClick : undefined}
    >
      {isZero ? '—' : fmtNum(value)}
    </td>
  )
}

// ─── Drill-down Dialog ────────────────────────────────────────────────────────
//
// Tabela com a mesma UX de /transacoes: filtros nos headers (ColHeader), sort
// por coluna, checkbox por linha, batch classify e delete inline. Tudo
// client-side dentro do dialog (sem mexer em URL).

function DrillDownDialog({
  state, data, loading, onClose, onDataChange,
  leafCategories, costCenters, businessUnits, legalEntities,
}: {
  state: DrillDownState
  data: DrillDownTransaction[] | null
  loading: boolean
  onClose: () => void
  onDataChange: (next: DrillDownTransaction[]) => void
  leafCategories: LeafCategory[]
  costCenters: CostCenter[]
  businessUnits: BusinessUnit[]
  legalEntities: LegalEntity[]
}) {
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

  // Sort local
  const [sort, setSort] = useState<string | undefined>('date_desc')

  // Seleção e batch
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchOpen, setBatchOpen] = useState(false)

  // Delete
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([])
  const [isDeleting, setIsDeleting] = useState(false)

  // Classificação inline
  const [classifyingId, setClassifyingId] = useState<string | null>(null)

  useEffect(() => {
    if (data) {
      setLocalData(data)
      setSelectedIds(new Set())
    }
  }, [data])

  // Opções para os filtros
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

  // Filtros aplicados
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

  // Sort
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
    setSearch(undefined)
    setDirection(undefined)
    setAmountMin(undefined)
    setAmountMax(undefined)
    setCatFilter(undefined)
    setCcFilter(undefined)
    setBuFilter(undefined)
    setLeFilter(undefined)
    setAcctFilter(undefined)
  }

  const hasAnyFilter = !!(search || direction || amountMin || amountMax || catFilter || ccFilter || buFilter || leFilter || acctFilter)
  const totalNet = sorted.reduce((s, t) => s + t.netAmount, 0)

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="flex flex-col w-[98vw] max-w-none max-h-[92vh] p-0 sm:rounded-lg">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="text-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate">{state.categoryName}</span>
              <span className="font-normal text-muted-foreground shrink-0">
                {state.dateRange
                  ? `Total — ${monthLabel(state.dateRange.from.slice(0, 7))} a ${monthLabel(state.dateRange.to.slice(0, 7))}`
                  : monthLabel(state.month)
                }
              </span>
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
          onSuccess={() => {
            setSelectedIds(new Set())
            // Recarrega o dialog (cuidado pra não causar loop — onDataChange manda pro pai recarregar via getDreDrillDown)
            // Para simplificar, marcamos os dados como stale e o pai pode rebuscar quando quiser.
          }}
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

// ─── DreClient ────────────────────────────────────────────────────────────────

interface Props {
  initialData: DreData
  initialFrom: string
  initialTo: string
  costCenters: CostCenter[]
  businessUnits: BusinessUnit[]
  legalEntities: LegalEntity[]
  leafCategories: LeafCategory[]
}

export function DreClient({
  initialData, initialFrom, initialTo, costCenters, businessUnits, legalEntities, leafCategories,
}: Props) {
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()

  const [fromMonth, setFromMonth] = useState(initialFrom.slice(0, 7))
  const [toMonth, setToMonth]     = useState(initialTo.slice(0, 7))
  const [selCc, setSelCc]         = useState<string[]>([])
  const [selBu, setSelBu]         = useState<string[]>([])
  const [selLe, setSelLe]         = useState<string[]>([])

  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const saved = localStorage.getItem('lure:dre:filters')
      if (!saved) return
      const p = JSON.parse(saved) as { fromMonth?: string; toMonth?: string; selCc?: string[]; selBu?: string[]; selLe?: string[] }
      const validCcIds = new Set(costCenters.map(c => c.id))
      const validBuIds = new Set(businessUnits.map(b => b.id))
      const validLeIds = new Set(legalEntities.map(l => l.id))
      const fm = p.fromMonth ?? fromMonth
      const tm = p.toMonth ?? toMonth
      const cc = (p.selCc ?? []).filter(id => validCcIds.has(id))
      const bu = (p.selBu ?? []).filter(id => validBuIds.has(id))
      const le = (p.selLe ?? []).filter(id => validLeIds.has(id))
      setFromMonth(fm)
      setToMonth(tm)
      setSelCc(cc)
      setSelBu(bu)
      setSelLe(le)
      const diffDate = fm !== initialFrom.slice(0, 7) || tm !== initialTo.slice(0, 7)
      const diffDims = cc.length > 0 || bu.length > 0 || le.length > 0
      if (diffDate || diffDims) fetchData({ fm, tm, cc, bu, le })
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [drillDown, setDrillDown]         = useState<DrillDownState | null>(null)
  const [drillDownData, setDrillDownData] = useState<DrillDownTransaction[] | null>(null)
  const [isDrillLoading, startDrillTransition] = useTransition()

  const allParentIds = useMemo(() => {
    const ids = new Set<string>()
    data.rows.forEach(r => ids.add(r.parentId))
    return ids
  }, [data.rows])

  const isFullyExpanded = collapsedParents.size === 0

  function toggleAll() {
    if (isFullyExpanded) {
      setCollapsedParents(new Set(allParentIds))
    } else {
      setCollapsedParents(new Set())
    }
  }

  function fetchData(params: { fm?: string; tm?: string; cc?: string[]; bu?: string[]; le?: string[] } = {}) {
    const fm = params.fm ?? fromMonth
    const tm = params.tm ?? toMonth
    const cc = params.cc ?? selCc
    const bu = params.bu ?? selBu
    const le = params.le ?? selLe

    try {
      localStorage.setItem('lure:dre:filters', JSON.stringify({ fromMonth: fm, toMonth: tm, selCc: cc, selBu: bu, selLe: le }))
    } catch {}

    const [y1, m1] = fm.split('-').map(Number)
    const [y2, m2] = tm.split('-').map(Number)
    const from = `${y1}-${String(m1).padStart(2, '0')}-01`
    const lastDay = new Date(y2, m2, 0).getDate()
    const to = `${y2}-${String(m2).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    startTransition(async () => {
      const d = await getDreData({
        from, to,
        costCenterIds: cc.length ? cc : undefined,
        businessUnitIds: bu.length ? bu : undefined,
        legalEntityIds: le.length ? le : undefined,
      })
      setData(d)
    })
  }

  function toggleParent(parentId: string) {
    setCollapsedParents(prev => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }

  const currentFrom = useMemo(() => {
    const [y1, m1] = fromMonth.split('-').map(Number)
    return `${y1}-${String(m1).padStart(2, '0')}-01`
  }, [fromMonth])

  const currentTo = useMemo(() => {
    const [y2, m2] = toMonth.split('-').map(Number)
    const lastDay = new Date(y2, m2, 0).getDate()
    return `${y2}-${String(m2).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  }, [toMonth])

  function openDrillDown(categoryId: string, categoryName: string, month: string, dateRange?: { from: string; to: string }) {
    setDrillDown({ categoryId, categoryName, month, dateRange })
    setDrillDownData(null)
    startDrillTransition(async () => {
      const result = await getDreDrillDown(categoryId, month, {
        costCenterIds: selCc.length ? selCc : undefined,
        businessUnitIds: selBu.length ? selBu : undefined,
        legalEntityIds: selLe.length ? selLe : undefined,
      }, dateRange)
      setDrillDownData(result.transactions)
    })
  }

  function openDrillDownTotal(categoryId: string, categoryName: string) {
    openDrillDown(categoryId, categoryName, '', { from: currentFrom, to: currentTo })
  }

  function closeDrillDown() {
    setDrillDown(null)
    setDrillDownData(null)
  }

  const subtotalsByMonth = useMemo(() => {
    const map = new Map<string, DreMonthSubtotals>()
    data.subtotals.forEach(s => map.set(s.month, s))
    return map
  }, [data.subtotals])

  const hasDimFilters = selCc.length > 0 || selBu.length > 0 || selLe.length > 0
  const { months, rows } = data
  const nCols = months.length + 3  // label + months + Total + Média

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-4 border-b bg-background shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">DRE</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Demonstrativo de Resultado do Exercício
            </p>
          </div>
          <div className="flex items-center gap-2">
            {rows.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-muted-foreground gap-1"
                onClick={toggleAll}
              >
                {isFullyExpanded
                  ? <><ChevronsUp className="h-3 w-3" /> Recolher todos</>
                  : <><ChevronsDown className="h-3 w-3" /> Expandir todos</>
                }
              </Button>
            )}
            {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1.5">
            <input
              type="month"
              value={fromMonth}
              max={toMonth}
              onChange={e => setFromMonth(e.target.value)}
              className="h-8 px-2 text-xs border rounded-md bg-background text-foreground"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <input
              type="month"
              value={toMonth}
              min={fromMonth}
              onChange={e => setToMonth(e.target.value)}
              className="h-8 px-2 text-xs border rounded-md bg-background text-foreground"
            />
            <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={() => fetchData()}>
              Filtrar
            </Button>
          </div>

          {(costCenters.length > 0 || businessUnits.length > 0 || legalEntities.length > 0) && (
            <div className="h-5 w-px bg-border mx-0.5" />
          )}

          <DimFilter
            label="Centro de Custo"
            options={costCenters.map(c => ({ id: c.id, name: c.name, code: c.code }))}
            selected={selCc}
            onChange={ids => { setSelCc(ids); fetchData({ cc: ids }) }}
          />
          <DimFilter
            label="Unidade de Negócio"
            options={businessUnits.map(b => ({ id: b.id, name: b.name, code: b.code }))}
            selected={selBu}
            onChange={ids => { setSelBu(ids); fetchData({ bu: ids }) }}
          />
          <DimFilter
            label="Entidade Jurídica"
            options={legalEntities.map(l => ({ id: l.id, name: l.name, code: l.code }))}
            selected={selLe}
            onChange={ids => { setSelLe(ids); fetchData({ le: ids }) }}
          />

          {hasDimFilters && (
            <Button
              size="sm" variant="ghost"
              className="h-8 text-xs text-muted-foreground gap-1"
              onClick={() => { setSelCc([]); setSelBu([]); setSelLe([]); fetchData({ cc: [], bu: [], le: [] }) }}
            >
              <X className="h-3 w-3" /> Limpar
            </Button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-10">
          <EmptyState
            icon={<BarChart3 className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
            title="Sem dados para o período"
            description="Categorize suas transações para que o expert monte o demonstrativo automaticamente."
          />
        </div>
      ) : (
        <div className={cn('flex-1 overflow-auto min-h-0', isPending && 'opacity-50 pointer-events-none')}>
          <table
            className="border-collapse"
            style={{ minWidth: LABEL_W + months.length * COL_W + 2 * TOTAL_COL_W, width: '100%' }}
          >
            <colgroup>
              <col style={{ width: LABEL_W, minWidth: LABEL_W }} />
              {months.map(m => <col key={m} style={{ width: COL_W, minWidth: COL_W }} />)}
              <col style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }} />
              <col style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }} />
            </colgroup>

            <thead className="sticky top-0 z-20 bg-background border-b border-slate-200 shadow-[0_1px_0_0_#e2e8f0]">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">
                  Conta
                </th>
                {months.map(m => (
                  <th key={m} className="text-right text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">
                    {monthLabel(m)}
                  </th>
                ))}
                <th className="text-right text-xs font-medium text-muted-foreground/60 px-3 py-2 whitespace-nowrap border-l border-slate-200">
                  Total
                </th>
                <th className="text-right text-xs font-medium text-muted-foreground/60 px-3 py-2 whitespace-nowrap">
                  Média/mês
                </th>
              </tr>
            </thead>

            <tbody>
              {LAYOUT.map(section => (
                <LayoutBlock
                  key={section.subtotalKey}
                  section={section}
                  rows={rows}
                  months={months}
                  subtotalsByMonth={subtotalsByMonth}
                  collapsedParents={collapsedParents}
                  toggleParent={toggleParent}
                  openDrillDown={openDrillDown}
                  openDrillDownTotal={openDrillDownTotal}
                  nCols={nCols}
                />
              ))}

              <tr>
                <td colSpan={nCols} className="py-2 px-4">
                  <div className="border-t-2 border-dashed border-slate-200" />
                </td>
              </tr>

              <LayoutBlock
                section={BELOW_LAYOUT}
                rows={rows}
                months={months}
                subtotalsByMonth={subtotalsByMonth}
                collapsedParents={collapsedParents}
                toggleParent={toggleParent}
                openDrillDown={openDrillDown}
                openDrillDownTotal={openDrillDownTotal}
                nCols={nCols}
              />
            </tbody>
          </table>
        </div>
      )}

      {/* ── Drill-down dialog ── */}
      {drillDown && (
        <DrillDownDialog
          state={drillDown}
          data={drillDownData}
          loading={isDrillLoading}
          onClose={closeDrillDown}
          onDataChange={setDrillDownData}
          leafCategories={leafCategories}
          costCenters={costCenters}
          businessUnits={businessUnits}
          legalEntities={legalEntities}
        />
      )}
    </div>
  )
}

// ─── LayoutBlock ──────────────────────────────────────────────────────────────

interface BlockProps {
  section: LayoutSection
  rows: DreCategoryRow[]
  months: string[]
  subtotalsByMonth: Map<string, DreMonthSubtotals>
  collapsedParents: Set<string>
  toggleParent: (id: string) => void
  openDrillDown: (categoryId: string, categoryName: string, month: string) => void
  openDrillDownTotal: (categoryId: string, categoryName: string) => void
  nCols: number
}

function LayoutBlock({ section, rows, months, subtotalsByMonth, collapsedParents, toggleParent, openDrillDown, openDrillDownTotal, nCols }: BlockProps) {
  const blocks = useMemo(() => buildBlocks(rows, section.types), [rows, section.types])

  const subtotalTotal = months.reduce((s, m) => {
    const sub = subtotalsByMonth.get(m)
    return s + (sub ? (sub[section.subtotalKey] as number) : 0)
  }, 0)
  const subtotalAvg = months.length > 0 ? subtotalTotal / months.length : 0

  return (
    <>
      {blocks.map(block => (
        <TypeBlock
          key={block.type}
          block={block}
          months={months}
          collapsedParents={collapsedParents}
          toggleParent={toggleParent}
          openDrillDown={openDrillDown}
          openDrillDownTotal={openDrillDownTotal}
          nCols={nCols}
        />
      ))}

      <tr className={cn('border-y', section.keyMetric ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50')}>
        <td className={cn(
          'sticky left-0 px-4 py-2 text-xs font-semibold',
          section.keyMetric ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-700',
        )}>
          {section.subtotalLabel}
        </td>
        {months.map(m => {
          const sub = subtotalsByMonth.get(m)
          const value = sub ? (sub[section.subtotalKey] as number) : 0
          return <Num key={m} value={value} bold inverted={section.keyMetric} />
        })}
        {/* Total */}
        <Num value={subtotalTotal} bold inverted={section.keyMetric} />
        {/* Média */}
        <Num value={subtotalAvg} bold inverted={section.keyMetric} />
      </tr>
    </>
  )
}

// ─── TypeBlock ────────────────────────────────────────────────────────────────

interface TypeBlockProps {
  block: SectionBlock
  months: string[]
  collapsedParents: Set<string>
  toggleParent: (id: string) => void
  openDrillDown: (categoryId: string, categoryName: string, month: string) => void
  openDrillDownTotal: (categoryId: string, categoryName: string) => void
  nCols: number
}

function TypeBlock({ block, months, collapsedParents, toggleParent, openDrillDown, openDrillDownTotal, nCols }: TypeBlockProps) {
  return (
    <>
      <tr className="bg-slate-100/70 border-t border-slate-200">
        <td colSpan={nCols} className="sticky left-0 bg-slate-100/70 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {DRE_TYPE_LABELS[block.type]}
        </td>
      </tr>

      {block.parents.map(parent => (
        <ParentBlock
          key={parent.parentId}
          parent={parent}
          months={months}
          isCollapsed={collapsedParents.has(parent.parentId)}
          onToggle={() => toggleParent(parent.parentId)}
          openDrillDown={openDrillDown}
          openDrillDownTotal={openDrillDownTotal}
        />
      ))}
    </>
  )
}

// ─── ParentBlock ──────────────────────────────────────────────────────────────

interface ParentBlockProps {
  parent: ParentNode
  months: string[]
  isCollapsed: boolean
  onToggle: () => void
  openDrillDown: (categoryId: string, categoryName: string, month: string) => void
  openDrillDownTotal: (categoryId: string, categoryName: string) => void
}

function ParentBlock({ parent, months, isCollapsed, onToggle, openDrillDown, openDrillDownTotal }: ParentBlockProps) {
  const parentByMonth = useMemo(() => {
    const result: Record<string, number> = {}
    months.forEach(m => {
      result[m] = parent.children.reduce((s, c) => s + (c.byMonth[m] ?? 0), 0)
    })
    return result
  }, [parent.children, months])

  const parentTotal = months.reduce((s, m) => s + (parentByMonth[m] ?? 0), 0)
  const parentAvg   = months.length > 0 ? parentTotal / months.length : 0

  const hasSingleChild =
    parent.children.length === 1 && parent.children[0].categoryName === parent.parentName

  const singleChild = hasSingleChild ? parent.children[0] : null

  return (
    <>
      {/* Parent row */}
      <tr className="border-b border-slate-100">
        <td className="sticky left-0 bg-background px-4 py-[3px] text-xs font-medium text-foreground">
          <div className="flex items-center gap-1 pl-2">
            {!hasSingleChild && (
              <button
                onClick={onToggle}
                className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
                aria-label={isCollapsed ? 'Expandir' : 'Recolher'}
              >
                {isCollapsed
                  ? <ChevronRight className="h-3 w-3" />
                  : <ChevronDown className="h-3 w-3" />
                }
              </button>
            )}
            {parent.parentCode && (
              <span className="text-muted-foreground/50 font-mono text-[10px] shrink-0">
                {parent.parentCode}
              </span>
            )}
            <span className="truncate">{parent.parentName}</span>
          </div>
        </td>
        {months.map(m => {
          const v = parentByMonth[m] ?? 0
          return (
            <Num
              key={m}
              value={v}
              bold
              light
              onClick={singleChild ? () => openDrillDown(singleChild.categoryId, singleChild.categoryName, m) : undefined}
            />
          )
        })}
        <td className="px-3 py-[3px] text-right tabular-nums text-xs font-semibold border-l border-slate-100 text-muted-foreground/50">
          {parentTotal === 0 ? '—' : fmtNum(parentTotal)}
        </td>
        <td className="px-3 py-[3px] text-right tabular-nums text-xs font-semibold text-muted-foreground/40">
          {parentAvg === 0 ? '—' : fmtNum(parentAvg)}
        </td>
      </tr>

      {/* Child rows */}
      {!isCollapsed && !hasSingleChild && parent.children.map(child => {
        const childTotal = months.reduce((s, m) => s + (child.byMonth[m] ?? 0), 0)
        const childAvg   = months.length > 0 ? childTotal / months.length : 0

        return (
          <tr key={child.categoryId} className="border-b border-slate-50">
            <td className="sticky left-0 bg-background px-4 py-[3px] text-xs text-muted-foreground">
              <div className="flex items-center gap-1 pl-8">
                {child.categoryCode && (
                  <span className="text-muted-foreground/30 font-mono text-[10px] shrink-0">
                    {child.categoryCode}
                  </span>
                )}
                <span className="truncate">{child.categoryName}</span>
              </div>
            </td>
            {months.map(m => {
              const v = child.byMonth[m] ?? 0
              return (
                <Num
                  key={m}
                  value={v}
                  light
                  onClick={() => openDrillDown(child.categoryId, child.categoryName, m)}
                />
              )
            })}
            <td
              className={cn(
                'px-3 py-[3px] text-right tabular-nums text-xs border-l border-slate-100',
                childTotal !== 0
                  ? 'text-muted-foreground/60 cursor-pointer hover:text-foreground hover:underline underline-offset-2'
                  : 'text-muted-foreground/40',
              )}
              onClick={childTotal !== 0 ? () => openDrillDownTotal(child.categoryId, child.categoryName) : undefined}
            >
              {childTotal === 0 ? '—' : fmtNum(childTotal)}
            </td>
            <td className="px-3 py-[3px] text-right tabular-nums text-xs text-muted-foreground/30">
              {childAvg === 0 ? '—' : fmtNum(childAvg)}
            </td>
          </tr>
        )
      })}
    </>
  )
}
