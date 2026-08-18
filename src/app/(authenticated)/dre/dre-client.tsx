'use client'

import { Fragment, useState, useTransition, useMemo, useEffect } from 'react'
import {
  X, Loader2, BarChart3,
  ChevronRight, ChevronDown, ChevronsDown, ChevronsUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/states/empty-state'
import { cn } from '@/lib/utils'
import { getDreData, getDreDrillDown } from '@/server/dre'
import type {
  DreData, DreMonthSubtotals, DreCategoryRow, DrillDownTransaction, LeafCategory,
} from '@/lib/dre-types'
import { DRE_TYPE_LABELS } from '@/lib/dre-types'
import type { LayoutSection, ParentNode, SectionBlock } from '@/lib/dre-layout'
import { LAYOUT, BELOW_LAYOUT, buildBlocks } from '@/lib/dre-layout'
import { verticalShare } from '@/lib/dre-calc'
import { fmtNum, fmtPct, monthLabel } from '@/lib/format'
import { Num } from '@/components/financial/num-cell'
import { DimFilter } from '@/components/transacoes-shared/dim-filter'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'
import { DrillDownDialog } from '@/components/transacoes-shared/drill-down-dialog'

// ─── Types ────────────────────────────────────────────────────────────────────

type DrillDownState = {
  categoryId: string
  categoryName: string
  month: string
  dateRange?: { from: string; to: string }
}

const COL_W = 96
const AV_COL_W = 62
const TOTAL_COL_W = 106
const LABEL_W = 260

/**
 * Base da análise vertical: a Receita Líquida de cada mês e a do período.
 *
 * A DRE clássica lê "esta conta consome X% da receita líquida". A base sai dos
 * subtotais que a tela já calcula — nenhum dado novo do servidor.
 */
interface AvBase {
  byMonth: Record<string, number>
  total:   number
}

/**
 * A célula de AV%. Sempre em cinza — proporção não é julgamento, e pintar de
 * verde ou vermelho inventaria um sinal que a coluna do valor, ao lado, já diz.
 *
 * `signed` é para as linhas de subtotal, onde a AV% é margem e não consumo:
 * ali o sinal é o recado, e uma margem negativa não pode aparecer como positiva.
 */
function AvCell({ value, base, signed, bold, light, inverted }: {
  value: number
  base: number
  signed?: boolean
  bold?: boolean
  light?: boolean
  inverted?: boolean
}) {
  return (
    <Num
      value={verticalShare(value, base, signed)}
      format={fmtPct}
      tone="muted"
      bold={bold}
      light={light}
      inverted={inverted}
      className="px-2"
    />
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

  const avBase: AvBase = useMemo(() => {
    const byMonth: Record<string, number> = {}
    let total = 0
    for (const m of months) {
      const v = subtotalsByMonth.get(m)?.receitaLiquida ?? 0
      byMonth[m] = v
      total += v
    }
    return { byMonth, total }
  }, [months, subtotalsByMonth])

  // rótulo + (valor + AV%) por mês + (Total + AV%) + Média
  const nCols = months.length * 2 + 4

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
            style={{
              minWidth: LABEL_W + months.length * (COL_W + AV_COL_W) + TOTAL_COL_W + AV_COL_W + TOTAL_COL_W,
              width: '100%',
            }}
          >
            <colgroup>
              <col style={{ width: LABEL_W, minWidth: LABEL_W }} />
              {months.map(m => (
                <Fragment key={m}>
                  <col style={{ width: COL_W, minWidth: COL_W }} />
                  <col style={{ width: AV_COL_W, minWidth: AV_COL_W }} />
                </Fragment>
              ))}
              <col style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }} />
              <col style={{ width: AV_COL_W, minWidth: AV_COL_W }} />
              <col style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }} />
            </colgroup>

            <thead className="sticky top-0 z-20 bg-background border-b border-slate-200 shadow-[0_1px_0_0_#e2e8f0]">
              <tr>
                <th rowSpan={2} className="text-left text-xs font-medium text-muted-foreground px-4 py-2 align-bottom">
                  Conta
                </th>
                {months.map(m => (
                  <th key={m} colSpan={2}
                    className="text-center text-xs font-medium text-muted-foreground px-3 pt-2 pb-0.5 whitespace-nowrap border-l border-slate-200">
                    {monthLabel(m)}
                  </th>
                ))}
                <th colSpan={2}
                  className="text-center text-xs font-medium text-muted-foreground/60 px-3 pt-2 pb-0.5 whitespace-nowrap border-l border-slate-300">
                  Total
                </th>
                <th rowSpan={2}
                  className="text-right text-xs font-medium text-muted-foreground/60 px-3 py-2 whitespace-nowrap align-bottom">
                  Média/mês
                </th>
              </tr>
              <tr>
                {months.map(m => (
                  <Fragment key={m}>
                    <th className="text-right text-[10px] font-normal text-muted-foreground/50 px-3 pb-1.5 whitespace-nowrap border-l border-slate-200">
                      Valor
                    </th>
                    <th className="text-right text-[10px] font-normal text-muted-foreground/50 px-2 pb-1.5 whitespace-nowrap"
                      title="Análise vertical — participação na Receita Líquida do mês">
                      AV%
                    </th>
                  </Fragment>
                ))}
                <th className="text-right text-[10px] font-normal text-muted-foreground/50 px-3 pb-1.5 whitespace-nowrap border-l border-slate-300">
                  Valor
                </th>
                <th className="text-right text-[10px] font-normal text-muted-foreground/50 px-2 pb-1.5 whitespace-nowrap"
                  title="Participação na Receita Líquida do período inteiro">
                  AV%
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
                  avBase={avBase}
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
                avBase={avBase}
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
          open
          onOpenChange={(o) => { if (!o) closeDrillDown() }}
          title={drillDown.categoryName}
          subtitle={drillDown.dateRange
            ? `Total — ${monthLabel(drillDown.dateRange.from.slice(0, 7))} a ${monthLabel(drillDown.dateRange.to.slice(0, 7))}`
            : monthLabel(drillDown.month)
          }
          data={drillDownData}
          loading={isDrillLoading}
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
  avBase: AvBase
  collapsedParents: Set<string>
  toggleParent: (id: string) => void
  openDrillDown: (categoryId: string, categoryName: string, month: string) => void
  openDrillDownTotal: (categoryId: string, categoryName: string) => void
  nCols: number
}

function LayoutBlock({ section, rows, months, subtotalsByMonth, avBase, collapsedParents, toggleParent, openDrillDown, openDrillDownTotal, nCols }: BlockProps) {
  const blocks = useMemo(() => buildBlocks(rows, section.types, r => r.netAmount), [rows, section.types])

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
          avBase={avBase}
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
          return (
            <Fragment key={m}>
              <Num value={value} bold inverted={section.keyMetric} className="border-l border-slate-200" />
              {/* Subtotal: a AV% é MARGEM, então vai com sinal. */}
              <AvCell value={value} base={avBase.byMonth[m] ?? 0} signed bold inverted={section.keyMetric} />
            </Fragment>
          )
        })}
        {/* Total */}
        <Num value={subtotalTotal} bold inverted={section.keyMetric} className="border-l border-slate-300" />
        <AvCell value={subtotalTotal} base={avBase.total} signed bold inverted={section.keyMetric} />
        {/* Média */}
        <Num value={subtotalAvg} bold inverted={section.keyMetric} />
      </tr>
    </>
  )
}

// ─── TypeBlock ────────────────────────────────────────────────────────────────

interface TypeBlockProps {
  block: SectionBlock<number>
  months: string[]
  avBase: AvBase
  collapsedParents: Set<string>
  toggleParent: (id: string) => void
  openDrillDown: (categoryId: string, categoryName: string, month: string) => void
  openDrillDownTotal: (categoryId: string, categoryName: string) => void
  nCols: number
}

function TypeBlock({ block, months, avBase, collapsedParents, toggleParent, openDrillDown, openDrillDownTotal, nCols }: TypeBlockProps) {
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
          avBase={avBase}
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
  parent: ParentNode<number>
  months: string[]
  avBase: AvBase
  isCollapsed: boolean
  onToggle: () => void
  openDrillDown: (categoryId: string, categoryName: string, month: string) => void
  openDrillDownTotal: (categoryId: string, categoryName: string) => void
}

function ParentBlock({ parent, months, avBase, isCollapsed, onToggle, openDrillDown, openDrillDownTotal }: ParentBlockProps) {
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
            <Fragment key={m}>
              <Num
                value={v}
                bold
                light
                className="border-l border-slate-200"
                onClick={singleChild ? () => openDrillDown(singleChild.categoryId, singleChild.categoryName, m) : undefined}
              />
              <AvCell value={v} base={avBase.byMonth[m] ?? 0} bold light />
            </Fragment>
          )
        })}
        <td className="px-3 py-[3px] text-right tabular-nums text-xs font-semibold border-l border-slate-300 text-muted-foreground/50">
          {parentTotal === 0 ? '—' : fmtNum(parentTotal)}
        </td>
        <AvCell value={parentTotal} base={avBase.total} bold light />
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
                <Fragment key={m}>
                  <Num
                    value={v}
                    light
                    className="border-l border-slate-200"
                    onClick={() => openDrillDown(child.categoryId, child.categoryName, m)}
                  />
                  <AvCell value={v} base={avBase.byMonth[m] ?? 0} light />
                </Fragment>
              )
            })}
            <td
              className={cn(
                'px-3 py-[3px] text-right tabular-nums text-xs border-l border-slate-300',
                childTotal !== 0
                  ? 'text-muted-foreground/60 cursor-pointer hover:text-foreground hover:underline underline-offset-2'
                  : 'text-muted-foreground/40',
              )}
              onClick={childTotal !== 0 ? () => openDrillDownTotal(child.categoryId, child.categoryName) : undefined}
            >
              {childTotal === 0 ? '—' : fmtNum(childTotal)}
            </td>
            <AvCell value={childTotal} base={avBase.total} light />
            <td className="px-3 py-[3px] text-right tabular-nums text-xs text-muted-foreground/30">
              {childAvg === 0 ? '—' : fmtNum(childAvg)}
            </td>
          </tr>
        )
      })}
    </>
  )
}
