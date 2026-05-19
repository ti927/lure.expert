'use client'

import { useState, useTransition, useMemo, useEffect } from 'react'
import {
  Check, ChevronsUpDown, X, Loader2, BarChart3,
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
import { EmptyState } from '@/components/states/empty-state'
import { cn } from '@/lib/utils'
import { getDreData, getDreDrillDown } from '@/server/dre'
import { classifyTransaction } from '@/server/transactions'
import type {
  DreData, DreMonthSubtotals, DreCategoryRow, DreType, DrillDownTransaction, LeafCategory,
} from '@/lib/dre-types'
import { DRE_TYPE_LABELS } from '@/lib/dre-types'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'

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

type ComboOption = {
  id: string
  name: string
  code?: string | null
  group?: string
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

// ─── DimCellCombobox (para o drill-down) ────────────────────────────────────

function DimCellCombobox({
  value, options, placeholder, onSelect,
}: {
  value: string | null
  options: ComboOption[]
  placeholder: string
  onSelect: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)

  const groups = useMemo(() => {
    const map = new Map<string, ComboOption[]>()
    options.forEach(opt => {
      const g = opt.group ?? ''
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(opt)
    })
    return map
  }, [options])

  const hasGroups = options.some(o => o.group)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'w-full text-left text-[11px] px-1.5 py-0.5 rounded hover:bg-slate-100 truncate leading-5',
          value ? 'text-foreground' : 'text-muted-foreground/35',
        )}>
          {value ?? placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar..." className="h-8 text-xs" />
          <CommandList onWheel={e => e.stopPropagation()}>
            <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
              Nenhum resultado.
            </CommandEmpty>
            {value && (
              <CommandItem
                value="__clear__"
                onSelect={() => { onSelect(null); setOpen(false) }}
                className="text-xs text-muted-foreground/70 italic"
              >
                — Limpar
              </CommandItem>
            )}
            {hasGroups ? (
              Array.from(groups.entries()).map(([groupName, opts]) => (
                <CommandGroup key={groupName} heading={groupName}>
                  {opts.map(opt => (
                    <CommandItem
                      key={opt.id}
                      value={`${opt.code ?? ''} ${opt.name} ${groupName}`}
                      onSelect={() => { onSelect(opt.id); setOpen(false) }}
                      className="text-xs"
                    >
                      {opt.code && (
                        <span className="text-muted-foreground/50 font-mono text-[10px] mr-1 shrink-0">{opt.code}</span>
                      )}
                      <span className="truncate">{opt.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))
            ) : (
              <CommandGroup>
                {Array.from(groups.get('') ?? []).map(opt => (
                  <CommandItem
                    key={opt.id}
                    value={`${opt.code ?? ''} ${opt.name}`}
                    onSelect={() => { onSelect(opt.id); setOpen(false) }}
                    className="text-xs"
                  >
                    {opt.code && (
                      <span className="text-muted-foreground/50 font-mono text-[10px] mr-1 shrink-0">{opt.code}</span>
                    )}
                    <span className="truncate">{opt.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Drill-down Dialog ────────────────────────────────────────────────────────

function DrillDownDialog({
  state, data, loading, onClose,
  leafCategories, costCenters, businessUnits, legalEntities,
}: {
  state: DrillDownState
  data: DrillDownTransaction[] | null
  loading: boolean
  onClose: () => void
  leafCategories: LeafCategory[]
  costCenters: CostCenter[]
  businessUnits: BusinessUnit[]
  legalEntities: LegalEntity[]
}) {
  const [localData, setLocalData] = useState<DrillDownTransaction[]>([])
  const [search, setSearch] = useState('')
  const [dirFilter, setDirFilter] = useState<'all' | 'inflow' | 'outflow'>('all')
  const [ddDateFrom, setDdDateFrom] = useState(state.dateRange?.from ?? '')
  const [ddDateTo, setDdDateTo]     = useState(state.dateRange?.to ?? '')
  const [ddCc, setDdCc] = useState('')
  const [ddBu, setDdBu] = useState('')
  const [ddLe, setDdLe] = useState('')

  useEffect(() => {
    if (data) setLocalData(data)
  }, [data])

  const categoryOptions = useMemo<ComboOption[]>(() =>
    leafCategories.map(c => ({
      id: c.id, name: c.name, code: c.code,
      group: DRE_TYPE_LABELS[c.type as DreType] ?? c.type,
    })), [leafCategories])

  const ccOptions = useMemo<ComboOption[]>(() =>
    costCenters.map(c => ({ id: c.id, name: c.name, code: c.code })), [costCenters])

  const buOptions = useMemo<ComboOption[]>(() =>
    businessUnits.map(b => ({ id: b.id, name: b.name, code: b.code })), [businessUnits])

  const leOptions = useMemo<ComboOption[]>(() =>
    legalEntities.map(l => ({ id: l.id, name: l.name, code: l.code })), [legalEntities])

  const filtered = useMemo(() => localData.filter(tx => {
    if (search && !tx.description.toLowerCase().includes(search.toLowerCase())) return false
    if (dirFilter !== 'all' && tx.direction !== dirFilter) return false
    if (ddDateFrom && tx.date.slice(0, 10) < ddDateFrom) return false
    if (ddDateTo && tx.date.slice(0, 10) > ddDateTo) return false
    if (ddCc && tx.costCenterId !== ddCc) return false
    if (ddBu && tx.businessUnitId !== ddBu) return false
    if (ddLe && tx.legalEntityId !== ddLe) return false
    return true
  }), [localData, search, dirFilter, ddDateFrom, ddDateTo, ddCc, ddBu, ddLe])

  const totalNet = filtered.reduce((s, t) => s + t.netAmount, 0)

  async function handleEdit(
    txId: string,
    field: 'categoryId' | 'costCenterId' | 'businessUnitId' | 'legalEntityId',
    newId: string | null,
  ) {
    const nameFields = {
      categoryId:     { nameKey: 'categoryName'     as const, options: categoryOptions },
      costCenterId:   { nameKey: 'costCenterName'   as const, options: ccOptions },
      businessUnitId: { nameKey: 'businessUnitName' as const, options: buOptions },
      legalEntityId:  { nameKey: 'legalEntityName'  as const, options: leOptions },
    }
    const { nameKey, options } = nameFields[field]
    const newName = newId ? (options.find(o => o.id === newId)?.name ?? null) : null

    const prev = localData
    setLocalData(d => d.map(tx =>
      tx.id === txId ? { ...tx, [field]: newId, [nameKey]: newName } : tx
    ))

    const result = await classifyTransaction(txId, { [field]: newId })
    if (result?.error) setLocalData(prev)
  }

  const hasSecondaryFilters = ddDateFrom || ddDateTo || ddCc || ddBu || ddLe

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="flex flex-col max-w-5xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {state.categoryName}
            <span className="font-normal text-muted-foreground ml-2">
              {state.dateRange
                ? `Total — ${monthLabel(state.dateRange.from.slice(0, 7))} a ${monthLabel(state.dateRange.to.slice(0, 7))}`
                : monthLabel(state.month)
              }
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Linha 1: busca + direção */}
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="text"
            placeholder="Buscar descrição..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 flex-1 text-xs px-2 border rounded-md bg-background text-foreground min-w-0"
          />
          <div className="flex items-center rounded-md border overflow-hidden shrink-0">
            {(['all', 'inflow', 'outflow'] as const).map(dir => (
              <button
                key={dir}
                onClick={() => setDirFilter(dir)}
                className={cn(
                  'px-2.5 py-1 text-xs',
                  dirFilter === dir
                    ? 'bg-slate-800 text-white'
                    : 'text-muted-foreground hover:bg-slate-50',
                )}
              >
                {dir === 'all' ? 'Todos' : dir === 'inflow' ? 'Entrada' : 'Saída'}
              </button>
            ))}
          </div>
        </div>

        {/* Linha 2: datas + dimensões */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">De:</span>
            <input
              type="date"
              value={ddDateFrom}
              onChange={e => setDdDateFrom(e.target.value)}
              className="h-7 text-xs px-2 border rounded-md bg-background text-foreground"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Até:</span>
            <input
              type="date"
              value={ddDateTo}
              onChange={e => setDdDateTo(e.target.value)}
              className="h-7 text-xs px-2 border rounded-md bg-background text-foreground"
            />
          </div>
          {costCenters.length > 0 && (
            <select
              value={ddCc}
              onChange={e => setDdCc(e.target.value)}
              className="h-7 text-xs px-2 border rounded-md bg-background text-foreground"
            >
              <option value="">Todos os C. Custo</option>
              {costCenters.map(cc => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
            </select>
          )}
          {businessUnits.length > 0 && (
            <select
              value={ddBu}
              onChange={e => setDdBu(e.target.value)}
              className="h-7 text-xs px-2 border rounded-md bg-background text-foreground"
            >
              <option value="">Todas as Un. Negócio</option>
              {businessUnits.map(bu => <option key={bu.id} value={bu.id}>{bu.name}</option>)}
            </select>
          )}
          {legalEntities.length > 0 && (
            <select
              value={ddLe}
              onChange={e => setDdLe(e.target.value)}
              className="h-7 text-xs px-2 border rounded-md bg-background text-foreground"
            >
              <option value="">Todas as Entidades</option>
              {legalEntities.map(le => <option key={le.id} value={le.id}>{le.name}</option>)}
            </select>
          )}
          {hasSecondaryFilters && (
            <button
              onClick={() => { setDdDateFrom(''); setDdDateTo(''); setDdCc(''); setDdBu(''); setDdLe('') }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Limpar filtros
            </button>
          )}
        </div>

        {loading && localData.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {localData.length === 0 ? 'Sem transações para exibir.' : 'Nenhuma transação corresponde aos filtros.'}
          </p>
        ) : (
          <div className="flex flex-col min-h-0 flex-1 gap-3">
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full border-collapse text-xs" style={{ minWidth: 820 }}>
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 font-medium pr-3 whitespace-nowrap w-[76px]">Data</th>
                    <th className="text-left py-1.5 font-medium min-w-[140px]">Descrição</th>
                    <th className="text-left py-1.5 font-medium pl-2 w-[160px]">Categoria</th>
                    <th className="text-left py-1.5 font-medium pl-2 w-[120px]">C. Custo</th>
                    <th className="text-left py-1.5 font-medium pl-2 w-[120px]">Un. Negócio</th>
                    <th className="text-left py-1.5 font-medium pl-2 w-[120px]">Entidade</th>
                    <th className="text-right py-1.5 font-medium pl-3 whitespace-nowrap w-[80px]">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(tx => (
                    <tr key={tx.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap">
                        {fmtDate(tx.date)}
                      </td>
                      <td className="py-1 text-foreground">{tx.description}</td>
                      <td className="py-1 pl-2">
                        <DimCellCombobox
                          value={tx.categoryName}
                          options={categoryOptions}
                          placeholder="—"
                          onSelect={id => handleEdit(tx.id, 'categoryId', id)}
                        />
                      </td>
                      <td className="py-1 pl-2">
                        <DimCellCombobox
                          value={tx.costCenterName}
                          options={ccOptions}
                          placeholder="—"
                          onSelect={id => handleEdit(tx.id, 'costCenterId', id)}
                        />
                      </td>
                      <td className="py-1 pl-2">
                        <DimCellCombobox
                          value={tx.businessUnitName}
                          options={buOptions}
                          placeholder="—"
                          onSelect={id => handleEdit(tx.id, 'businessUnitId', id)}
                        />
                      </td>
                      <td className="py-1 pl-2">
                        <DimCellCombobox
                          value={tx.legalEntityName}
                          options={leOptions}
                          placeholder="—"
                          onSelect={id => handleEdit(tx.id, 'legalEntityId', id)}
                        />
                      </td>
                      <td className={cn(
                        'py-1 pl-3 text-right tabular-nums font-medium whitespace-nowrap',
                        tx.netAmount > 0 ? 'text-emerald-700' : 'text-rose-600',
                      )}>
                        {fmtNum(tx.netAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t pt-2.5 text-xs shrink-0">
              <span className="text-muted-foreground">{filtered.length} transações</span>
              <span className={cn('font-semibold tabular-nums', totalNet >= 0 ? 'text-emerald-700' : 'text-rose-600')}>
                Total: {fmtNum(totalNet)}
              </span>
            </div>
          </div>
        )}
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
