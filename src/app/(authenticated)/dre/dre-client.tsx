'use client'

import { useState, useTransition, useMemo } from 'react'
import {
  Check, ChevronsUpDown, X, Loader2, BarChart3,
  ChevronRight, ChevronDown,
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
import type {
  DreData, DreMonthSubtotals, DreCategoryRow, DreType, DrillDownTransaction,
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

function DrillDownDialog({
  state,
  data,
  loading,
  onClose,
}: {
  state: DrillDownState
  data: DrillDownTransaction[] | null
  loading: boolean
  onClose: () => void
}) {
  const totalNet = data ? data.reduce((s, t) => s + t.netAmount, 0) : 0

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {state.categoryName}
            <span className="font-normal text-muted-foreground ml-2">
              {monthLabel(state.month)}
            </span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sem transações para exibir.
          </p>
        ) : (
          <div className="flex flex-col min-h-0 flex-1 gap-3">
            <div className="overflow-y-auto flex-1 min-h-0">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 font-medium pr-3 whitespace-nowrap">Data</th>
                    <th className="text-left py-1.5 font-medium">Descrição</th>
                    <th className="text-right py-1.5 font-medium pl-3 whitespace-nowrap">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(tx => (
                    <tr key={tx.id} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                        {fmtDate(tx.date)}
                      </td>
                      <td className="py-1.5 text-foreground">{tx.description}</td>
                      <td className={cn(
                        'py-1.5 pl-3 text-right tabular-nums font-medium',
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
              <span className="text-muted-foreground">{data.length} transações</span>
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
}

export function DreClient({
  initialData, initialFrom, initialTo, costCenters, businessUnits, legalEntities,
}: Props) {
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()

  // Filters
  const [fromMonth, setFromMonth] = useState(initialFrom.slice(0, 7))
  const [toMonth, setToMonth]     = useState(initialTo.slice(0, 7))
  const [selCc, setSelCc]         = useState<string[]>([])
  const [selBu, setSelBu]         = useState<string[]>([])
  const [selLe, setSelLe]         = useState<string[]>([])

  // Collapse state — parentId → collapsed
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())

  // Drill-down state
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null)
  const [drillDownData, setDrillDownData] = useState<DrillDownTransaction[] | null>(null)
  const [isDrillLoading, startDrillTransition] = useTransition()

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

  function openDrillDown(categoryId: string, categoryName: string, month: string) {
    setDrillDown({ categoryId, categoryName, month })
    setDrillDownData(null)
    startDrillTransition(async () => {
      const result = await getDreDrillDown(categoryId, month, {
        costCenterIds: selCc.length ? selCc : undefined,
        businessUnitIds: selBu.length ? selBu : undefined,
        legalEntityIds: selLe.length ? selLe : undefined,
      })
      setDrillDownData(result.transactions)
    })
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
          {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
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
            style={{ minWidth: LABEL_W + months.length * COL_W, width: '100%' }}
          >
            <colgroup>
              <col style={{ width: LABEL_W, minWidth: LABEL_W }} />
              {months.map(m => <col key={m} style={{ width: COL_W, minWidth: COL_W }} />)}
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
                />
              ))}

              <tr>
                <td colSpan={months.length + 1} className="py-2 px-4">
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
}

function LayoutBlock({ section, rows, months, subtotalsByMonth, collapsedParents, toggleParent, openDrillDown }: BlockProps) {
  const blocks = useMemo(() => buildBlocks(rows, section.types), [rows, section.types])

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
}

function TypeBlock({ block, months, collapsedParents, toggleParent, openDrillDown }: TypeBlockProps) {
  return (
    <>
      <tr className="bg-slate-100/70 border-t border-slate-200">
        <td colSpan={months.length + 1} className="sticky left-0 bg-slate-100/70 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
}

function ParentBlock({ parent, months, isCollapsed, onToggle, openDrillDown }: ParentBlockProps) {
  const parentByMonth = useMemo(() => {
    const result: Record<string, number> = {}
    months.forEach(m => {
      result[m] = parent.children.reduce((s, c) => s + (c.byMonth[m] ?? 0), 0)
    })
    return result
  }, [parent.children, months])

  const hasSingleChild =
    parent.children.length === 1 && parent.children[0].categoryName === parent.parentName

  // If single leaf with same name, parent row IS the drill-down target
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
      </tr>

      {/* Child rows — hidden when collapsed */}
      {!isCollapsed && !hasSingleChild && parent.children.map(child => (
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
        </tr>
      ))}
    </>
  )
}
