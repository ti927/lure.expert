'use client'

import { useState, useTransition, useMemo } from 'react'
import { Check, ChevronsUpDown, X, Loader2, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { EmptyState } from '@/components/states/empty-state'
import { cn } from '@/lib/utils'
import { getDreData } from '@/server/dre'
import type { DreData, DreMonthSubtotals, DreCategoryRow, DreType } from '@/lib/dre-types'
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

// ─── Layout ───────────────────────────────────────────────────────────────────

const LAYOUT: LayoutSection[] = [
  {
    types: ['receita_operacional'],
    subtotalKey: 'receitaBruta',
    subtotalLabel: 'Receita Bruta',
  },
  {
    types: ['deducoes_tributarias', 'deducoes_operacionais'],
    subtotalKey: 'receitaLiquida',
    subtotalLabel: 'Receita Líquida',
  },
  {
    types: ['cpv'],
    subtotalKey: 'lucroBruto',
    subtotalLabel: 'Lucro Bruto',
  },
  {
    types: ['sga'],
    subtotalKey: 'ebitda',
    subtotalLabel: 'EBITDA',
  },
  {
    types: ['resultado_financeiro'],
    subtotalKey: 'lair',
    subtotalLabel: 'LAIR',
  },
  {
    types: ['ir'],
    subtotalKey: 'lucroLiquido',
    subtotalLabel: 'Lucro Líquido',
    keyMetric: true,
  },
]

const BELOW_LAYOUT: LayoutSection = {
  types: ['emprestimos_amortizacoes', 'investimentos_retiradas', 'transfer'],
  subtotalKey: 'variacaoCaixa',
  subtotalLabel: 'Variação de Caixa',
}

const PT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const COL_W = 96  // px per month column
const LABEL_W = 260

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${PT_MONTHS[m - 1]}/${String(y).slice(2)}`
}

function fmtNum(v: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
}

function buildBlocks(rows: DreCategoryRow[], types: DreType[]): SectionBlock[] {
  return types.map(type => {
    const parentMap = new Map<string, { parent: ParentNode; childMap: Map<string, ChildNode> }>()

    rows.filter(r => r.categoryType === type).forEach(row => {
      if (!parentMap.has(row.parentId)) {
        parentMap.set(row.parentId, {
          parent: {
            parentId: row.parentId,
            parentName: row.parentName,
            parentCode: row.parentCode,
            children: [],
          },
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
  label,
  options,
  selected,
  onChange,
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
          className={cn(
            'h-8 gap-1.5 text-xs font-normal',
            selected.length > 0 && 'border-primary/30 bg-primary/5',
          )}
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
                    onSelect={() => {
                      const next = checked
                        ? selected.filter(s => s !== opt.id)
                        : [...selected, opt.id]
                      onChange(next)
                    }}
                    className="text-xs"
                  >
                    <Check className={cn('mr-2 h-3 w-3 shrink-0', checked ? 'opacity-100' : 'opacity-0')} />
                    {opt.code && (
                      <span className="text-muted-foreground mr-1 font-mono text-[10px] shrink-0">
                        {opt.code}
                      </span>
                    )}
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
  value,
  bold,
  light,
  inverted,
}: {
  value: number
  bold?: boolean
  light?: boolean  // show faint dashes instead of zero
  inverted?: boolean  // for dark bg rows
}) {
  const isZero = value === 0
  let colorClass: string
  if (isZero) {
    colorClass = light ? 'text-muted-foreground/30' : 'text-muted-foreground/50'
  } else if (inverted) {
    colorClass = value > 0 ? 'text-emerald-300' : 'text-rose-300'
  } else {
    colorClass = value > 0 ? 'text-emerald-700' : 'text-rose-600'
  }

  return (
    <td className={cn('px-3 py-[3px] text-right tabular-nums text-xs', bold && 'font-semibold', colorClass)}>
      {isZero ? '—' : fmtNum(value)}
    </td>
  )
}

// ─── DreClient ────────────────────────────────────────────────────────────────

interface Props {
  initialData: DreData
  initialFrom: string  // YYYY-MM-DD
  initialTo: string    // YYYY-MM-DD
  costCenters: CostCenter[]
  businessUnits: BusinessUnit[]
  legalEntities: LegalEntity[]
}

export function DreClient({
  initialData,
  initialFrom,
  initialTo,
  costCenters,
  businessUnits,
  legalEntities,
}: Props) {
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()

  const [fromMonth, setFromMonth] = useState(initialFrom.slice(0, 7))
  const [toMonth, setToMonth]     = useState(initialTo.slice(0, 7))
  const [selCc, setSelCc]         = useState<string[]>([])
  const [selBu, setSelBu]         = useState<string[]>([])
  const [selLe, setSelLe]         = useState<string[]>([])

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
        from,
        to,
        costCenterIds: cc.length ? cc : undefined,
        businessUnitIds: bu.length ? bu : undefined,
        legalEntityIds: le.length ? le : undefined,
      })
      setData(d)
    })
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
          {/* Date range */}
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
            <Button
              size="sm"
              variant="secondary"
              className="h-8 text-xs"
              onClick={() => fetchData()}
            >
              Filtrar
            </Button>
          </div>

          {/* Dimension separador */}
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
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground gap-1"
              onClick={() => {
                setSelCc([])
                setSelBu([])
                setSelLe([])
                fetchData({ cc: [], bu: [], le: [] })
              }}
            >
              <X className="h-3 w-3" />
              Limpar
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
        <div
          className={cn(
            'flex-1 overflow-auto min-h-0',
            isPending && 'opacity-50 pointer-events-none',
          )}
        >
          <table
            className="border-collapse"
            style={{ minWidth: LABEL_W + months.length * COL_W, width: '100%' }}
          >
            <colgroup>
              <col style={{ width: LABEL_W, minWidth: LABEL_W }} />
              {months.map(m => <col key={m} style={{ width: COL_W, minWidth: COL_W }} />)}
            </colgroup>

            {/* Sticky header */}
            <thead className="sticky top-0 z-20 bg-background border-b border-slate-200 shadow-[0_1px_0_0_#e2e8f0]">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">
                  Conta
                </th>
                {months.map(m => (
                  <th
                    key={m}
                    className="text-right text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap"
                  >
                    {monthLabel(m)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {/* P&L sections */}
              {LAYOUT.map(section => (
                <LayoutBlock
                  key={section.subtotalKey}
                  section={section}
                  rows={rows}
                  months={months}
                  subtotalsByMonth={subtotalsByMonth}
                />
              ))}

              {/* Below-the-line separator */}
              <tr>
                <td colSpan={months.length + 1} className="py-2 px-4">
                  <div className="border-t-2 border-dashed border-slate-200" />
                </td>
              </tr>

              {/* Below-the-line */}
              <LayoutBlock
                section={BELOW_LAYOUT}
                rows={rows}
                months={months}
                subtotalsByMonth={subtotalsByMonth}
              />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── LayoutBlock ──────────────────────────────────────────────────────────────

function LayoutBlock({
  section,
  rows,
  months,
  subtotalsByMonth,
}: {
  section: LayoutSection
  rows: DreCategoryRow[]
  months: string[]
  subtotalsByMonth: Map<string, DreMonthSubtotals>
}) {
  const blocks = useMemo(() => buildBlocks(rows, section.types), [rows, section.types])

  return (
    <>
      {blocks.map(block => (
        <TypeBlock key={block.type} block={block} months={months} />
      ))}

      {/* Subtotal row */}
      <tr
        className={cn(
          'border-y',
          section.keyMetric
            ? 'border-slate-700 bg-slate-800'
            : 'border-slate-200 bg-slate-50',
        )}
      >
        <td
          className={cn(
            'sticky left-0 px-4 py-2 text-xs font-semibold',
            section.keyMetric
              ? 'bg-slate-800 text-white'
              : 'bg-slate-50 text-slate-700',
          )}
        >
          {section.subtotalLabel}
        </td>
        {months.map(m => {
          const sub = subtotalsByMonth.get(m)
          const value = sub ? (sub[section.subtotalKey] as number) : 0
          return (
            <Num
              key={m}
              value={value}
              bold
              inverted={section.keyMetric}
            />
          )
        })}
      </tr>
    </>
  )
}

// ─── TypeBlock ────────────────────────────────────────────────────────────────

function TypeBlock({ block, months }: { block: SectionBlock; months: string[] }) {
  return (
    <>
      {/* Section label */}
      <tr className="bg-slate-100/70 border-t border-slate-200">
        <td
          colSpan={months.length + 1}
          className="sticky left-0 bg-slate-100/70 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
        >
          {DRE_TYPE_LABELS[block.type]}
        </td>
      </tr>

      {block.parents.map(parent => (
        <ParentBlock key={parent.parentId} parent={parent} months={months} />
      ))}
    </>
  )
}

// ─── ParentBlock ──────────────────────────────────────────────────────────────

function ParentBlock({ parent, months }: { parent: ParentNode; months: string[] }) {
  const parentByMonth = useMemo(() => {
    const result: Record<string, number> = {}
    months.forEach(m => {
      result[m] = parent.children.reduce((s, c) => s + (c.byMonth[m] ?? 0), 0)
    })
    return result
  }, [parent.children, months])

  // Only show children rows when there are multiple, or when the child name differs from parent
  const showChildren =
    parent.children.length > 1 ||
    (parent.children.length === 1 && parent.children[0].categoryName !== parent.parentName)

  return (
    <>
      {/* Parent row */}
      <tr className="border-b border-slate-100">
        <td className="sticky left-0 bg-background px-4 py-[3px] text-xs font-medium text-foreground pl-6 whitespace-nowrap overflow-hidden text-ellipsis max-w-0">
          {parent.parentCode && (
            <span className="text-muted-foreground/50 mr-1.5 font-mono text-[10px]">
              {parent.parentCode}
            </span>
          )}
          {parent.parentName}
        </td>
        {months.map(m => {
          const v = parentByMonth[m] ?? 0
          return <Num key={m} value={v} bold light />
        })}
      </tr>

      {/* Child rows */}
      {showChildren && parent.children.map(child => (
        <tr key={child.categoryId} className="border-b border-slate-50">
          <td className="sticky left-0 bg-background px-4 py-[3px] text-xs text-muted-foreground pl-10 whitespace-nowrap overflow-hidden text-ellipsis max-w-0">
            {child.categoryCode && (
              <span className="text-muted-foreground/30 mr-1.5 font-mono text-[10px]">
                {child.categoryCode}
              </span>
            )}
            {child.categoryName}
          </td>
          {months.map(m => {
            const v = child.byMonth[m] ?? 0
            return <Num key={m} value={v} light />
          })}
        </tr>
      ))}
    </>
  )
}
