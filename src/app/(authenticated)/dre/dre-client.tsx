'use client'

import { Fragment, useState, useTransition, useMemo, useEffect, useCallback } from 'react'
import {
  X, Loader2, BarChart3, Target,
  ChevronRight, ChevronDown, ChevronsDown, ChevronsUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/states/empty-state'
import { cn } from '@/lib/utils'
import { getDreData, getDreDrillDown } from '@/server/dre'
import { getBudgetForPeriod, getBudgetDrillDown } from '@/server/budget'
import type {
  DreData, DreMonthSubtotals, DrillDownTransaction, LeafCategory,
} from '@/lib/dre-types'
import { DRE_TYPE_LABELS } from '@/lib/dre-types'
import type { LayoutSection, ParentNode, SectionBlock, BlockSourceRow } from '@/lib/dre-layout'
import { LAYOUT, BELOW_LAYOUT, buildBlocks } from '@/lib/dre-layout'
import { computeSubtotals, verticalShare, type SubtotalRow } from '@/lib/dre-calc'
import type { BudgetPeriodRow } from '@/lib/budget-read'
import type { BudgetVersionListItem, BudgetDrillDownEntry } from '@/lib/budget-types'
import { BUDGET_STATUS_LABELS } from '@/lib/budget-types'
import { BudgetDrillDownDialog } from '@/components/budget/budget-drilldown-dialog'
import { fmtNum, fmtPct, fmtPctSigned, monthLabel } from '@/lib/format'
import { Num } from '@/components/financial/num-cell'
import { DimFilter } from '@/components/transacoes-shared/dim-filter'
import { CellCombobox } from '@/components/transacoes-shared/cell-combobox'
import type { SimpleDimensionItem } from '@/components/transacoes-shared/types'
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

/** O par que cada célula da malha carrega. Sem orçamento, `orcado` é sempre 0. */
type Cell = { realizado: number; orcado: number }

const EMPTY_CELL: Cell = { realizado: 0, orcado: 0 }

/** Uma linha da malha: os metadados da categoria mais os dois valores do mês. */
interface CellRow extends BlockSourceRow {
  realizado: number
  orcado:    number
}

const COL_W = 96
const THIRD_COL_W = 66
const TOTAL_COL_W = 106
const LABEL_W = 260

const STORAGE_KEY = 'lure:dre:filters'

interface SavedFilters {
  fromMonth?: string
  toMonth?: string
  selCc?: string[]
  selBu?: string[]
  selLe?: string[]
  budgetOn?: boolean
  versionId?: string | null
}

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
 * Variação horizontal: o desvio do realizado sobre o orçado, em percentual.
 *
 * Com a convenção `netAmount` do projeto (receita positiva, despesa negativa),
 * `realizado − orçado` já é "favorável quando positivo" dos DOIS lados da DRE:
 * gastar menos que o previsto dá positivo, faturar menos dá negativo. Não
 * inverter por tipo de conta — é o erro mais provável deste módulo.
 *
 * Orçado zero devolve 0, que a célula renderiza como travessão. Nunca
 * `Infinity`, nunca "100%" inventado.
 */
function varPct(c: Cell): number {
  if (c.orcado === 0) return 0
  return ((c.realizado - c.orcado) / Math.abs(c.orcado)) * 100
}

const cellTitle = (c: Cell) => `Orçado ${fmtNum(c.orcado)} · Realizado ${fmtNum(c.realizado)}`

/**
 * A terceira coluna. Existe sempre e troca de significado:
 * sem orçamento é a análise vertical, com orçamento é o desvio sobre o orçado.
 *
 * A AV% vai em cinza — proporção não é julgamento, e pintá-la de verde
 * inventaria um sinal que a coluna do valor, ao lado, já diz. A Var%, sim, é
 * julgamento, e vai colorida por sinal.
 *
 * `signedAv` é para as linhas de subtotal, onde a AV% é margem e não consumo:
 * ali o sinal é o recado, e uma margem negativa não pode aparecer como positiva.
 */
function ThirdCell({ cell, base, budgetOn, signedAv, bold, light, inverted }: {
  cell: Cell
  base: number
  budgetOn: boolean
  signedAv?: boolean
  bold?: boolean
  light?: boolean
  inverted?: boolean
}) {
  if (budgetOn) {
    return (
      <Num
        value={varPct(cell)}
        format={fmtPctSigned}
        bold={bold}
        light={light}
        inverted={inverted}
        title={cellTitle(cell)}
        className="px-2"
      />
    )
  }
  return (
    <Num
      value={verticalShare(cell.realizado, base, signedAv)}
      format={fmtPct}
      tone="muted"
      bold={bold}
      light={light}
      inverted={inverted}
      className="px-2"
    />
  )
}

/** As células dos meses de uma linha. */
function MonthCells({
  months, cellAt, avBase, budgetOn, signedAv, bold, light, inverted, onValue, onBudget,
}: {
  months:   string[]
  cellAt:   (month: string) => Cell
  avBase:   AvBase
  budgetOn: boolean
  signedAv?: boolean
  bold?: boolean
  light?: boolean
  inverted?: boolean
  onValue?:  (month: string) => void
  onBudget?: (month: string) => void
}) {
  return (
    <>
      {months.map(m => {
        const c = cellAt(m)
        return (
          <Fragment key={m}>
            <Num
              value={c.realizado}
              bold={bold} light={light} inverted={inverted}
              className="border-l border-slate-200"
              onClick={onValue ? () => onValue(m) : undefined}
            />
            {budgetOn && (
              <Num
                value={c.orcado}
                bold={bold} light={light} inverted={inverted}
                title={cellTitle(c)}
                onClick={onBudget ? () => onBudget(m) : undefined}
              />
            )}
            <ThirdCell
              cell={c}
              base={avBase.byMonth[m] ?? 0}
              budgetOn={budgetOn}
              signedAv={signedAv}
              bold={bold} light={light} inverted={inverted}
            />
          </Fragment>
        )
      })}
    </>
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
  budgetVersions: BudgetVersionListItem[]
  contactOptions: SimpleDimensionItem[]
}

export function DreClient({
  initialData, initialFrom, initialTo,
  costCenters, businessUnits, legalEntities, leafCategories, budgetVersions, contactOptions,
}: Props) {
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()

  const [fromMonth, setFromMonth] = useState(initialFrom.slice(0, 7))
  const [toMonth, setToMonth]     = useState(initialTo.slice(0, 7))
  const [selCc, setSelCc]         = useState<string[]>([])
  const [selBu, setSelBu]         = useState<string[]>([])
  const [selLe, setSelLe]         = useState<string[]>([])

  // ── Orçamento ──
  const [budgetOn, setBudgetOn]     = useState(false)
  const [versionId, setVersionId]   = useState<string | null>(null)
  const [budgetRows, setBudgetRows] = useState<BudgetPeriodRow[]>([])

  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())

  /** A vigente do exercício do mês inicial; senão a do final; senão a mais recente. */
  const defaultVersionId = useCallback((fm: string, tm: string): string | null => {
    const anos = [Number(fm.slice(0, 4)), Number(tm.slice(0, 4))]
    for (const ano of anos) {
      const vigente = budgetVersions.find(v => v.fiscalYear === ano && v.isActive)
      if (vigente) return vigente.id
    }
    for (const ano of anos) {
      const qualquer = budgetVersions.find(v => v.fiscalYear === ano)
      if (qualquer) return qualquer.id
    }
    return budgetVersions[0]?.id ?? null
  }, [budgetVersions])

  const rangeOf = useCallback((fm: string, tm: string) => {
    const [y1, m1] = fm.split('-').map(Number)
    const [y2, m2] = tm.split('-').map(Number)
    const lastDay = new Date(y2, m2, 0).getDate()
    return {
      from: `${y1}-${String(m1).padStart(2, '0')}-01`,
      to:   `${y2}-${String(m2).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    }
  }, [])

  function fetchData(params: {
    fm?: string; tm?: string; cc?: string[]; bu?: string[]; le?: string[]
    on?: boolean; vid?: string | null
  } = {}) {
    const fm  = params.fm ?? fromMonth
    const tm  = params.tm ?? toMonth
    const cc  = params.cc ?? selCc
    const bu  = params.bu ?? selBu
    const le  = params.le ?? selLe
    const on  = params.on ?? budgetOn
    const vid = params.vid !== undefined ? params.vid : versionId

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        fromMonth: fm, toMonth: tm, selCc: cc, selBu: bu, selLe: le,
        budgetOn: on, versionId: vid,
      } satisfies SavedFilters))
    } catch {}

    const { from, to } = rangeOf(fm, tm)
    const dims = {
      costCenterIds: cc.length ? cc : undefined,
      businessUnitIds: bu.length ? bu : undefined,
      legalEntityIds: le.length ? le : undefined,
    }

    startTransition(async () => {
      // Os filtros de dimensão vão IDÊNTICOS para os dois lados. Aplicar em um
      // só é o que faz a variação parecer melhor do que é.
      const [d, b] = await Promise.all([
        getDreData({ from, to, ...dims }),
        on && vid ? getBudgetForPeriod(vid, { from, to }, dims) : Promise.resolve(null),
      ])
      setData(d)
      setBudgetRows(b?.rows ?? [])
    })
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return
      const p = JSON.parse(saved) as SavedFilters
      const validCcIds = new Set(costCenters.map(c => c.id))
      const validBuIds = new Set(businessUnits.map(b => b.id))
      const validLeIds = new Set(legalEntities.map(l => l.id))
      const fm = p.fromMonth ?? fromMonth
      const tm = p.toMonth ?? toMonth
      const cc = (p.selCc ?? []).filter(id => validCcIds.has(id))
      const bu = (p.selBu ?? []).filter(id => validBuIds.has(id))
      const le = (p.selLe ?? []).filter(id => validLeIds.has(id))
      // Versão salva que sumiu (excluída em /orcamento) volta para o default.
      const vid = p.versionId && budgetVersions.some(v => v.id === p.versionId)
        ? p.versionId
        : defaultVersionId(fm, tm)
      const on = !!p.budgetOn && !!vid

      setFromMonth(fm); setToMonth(tm)
      setSelCc(cc); setSelBu(bu); setSelLe(le)
      setVersionId(vid); setBudgetOn(on)

      const diffDate = fm !== initialFrom.slice(0, 7) || tm !== initialTo.slice(0, 7)
      const diffDims = cc.length > 0 || bu.length > 0 || le.length > 0
      if (diffDate || diffDims || on) fetchData({ fm, tm, cc, bu, le, on, vid })
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [drillDown, setDrillDown]         = useState<DrillDownState | null>(null)
  const [drillDownData, setDrillDownData] = useState<DrillDownTransaction[] | null>(null)
  const [isDrillLoading, startDrillTransition] = useTransition()

  // ── Drill-down do orçado ──
  const [budgetDrill, setBudgetDrill] = useState<{ title: string; subtitle: string } | null>(null)
  const [budgetDrillData, setBudgetDrillData] = useState<BudgetDrillDownEntry[] | null>(null)
  const [isBudgetDrilling, startBudgetDrill] = useTransition()

  function toggleParent(parentId: string) {
    setCollapsedParents(prev => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }

  const currentRange = useMemo(() => rangeOf(fromMonth, toMonth), [fromMonth, toMonth, rangeOf])

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
    openDrillDown(categoryId, categoryName, '', currentRange)
  }

  function closeDrillDown() {
    setDrillDown(null)
    setDrillDownData(null)
  }

  const dimArgs = useMemo(() => ({
    costCenterIds: selCc.length ? selCc : undefined,
    businessUnitIds: selBu.length ? selBu : undefined,
    legalEntityIds: selLe.length ? selLe : undefined,
  }), [selCc, selBu, selLe])

  /** Clique na subcoluna Orç. `month` nulo é a coluna Total. */
  function openBudgetDrill(categoryId: string, categoryName: string, month: string | null) {
    if (!versionId) return
    const range = month
      ? (() => {
          const [y, m] = month.split('-').map(Number)
          const last = new Date(y, m, 0).getDate()
          return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
        })()
      : currentRange

    setBudgetDrill({
      title: categoryName,
      subtitle: month
        ? monthLabel(month)
        : `${monthLabel(fromMonth)} a ${monthLabel(toMonth)}`,
    })
    setBudgetDrillData(null)
    startBudgetDrill(async () => {
      setBudgetDrillData(
        await getBudgetDrillDown(versionId, categoryId, 'competencia', range, dimArgs),
      )
    })
  }

  const subtotalsByMonth = useMemo(() => {
    const map = new Map<string, DreMonthSubtotals>()
    data.subtotals.forEach(s => map.set(s.month, s))
    return map
  }, [data.subtotals])

  const { months } = data

  /**
   * União realizado ∪ orçado por (categoria, mês).
   *
   * Categoria orçada e não realizada TEM de aparecer: "orcei R$ 10 mil em
   * marketing e não gastei nada" é a descoberta mais valiosa da tela, e a
   * interseção a esconderia.
   */
  const rows: CellRow[] = useMemo(() => {
    const merged = new Map<string, CellRow>()

    for (const r of data.rows) {
      merged.set(`${r.categoryId}:${r.month}`, {
        categoryId: r.categoryId, categoryName: r.categoryName, categoryCode: r.categoryCode,
        categoryType: r.categoryType, parentId: r.parentId, parentName: r.parentName,
        parentCode: r.parentCode, month: r.month,
        realizado: r.netAmount, orcado: 0,
      })
    }

    for (const b of budgetRows) {
      const key = `${b.categoryId}:${b.month}`
      const existing = merged.get(key)
      if (existing) { existing.orcado = b.orcado; continue }
      // Célula zerada dos DOIS lados não vira linha. O orçado tem ocorrências de
      // valor 0 por construção — `shapeMonthly` preenche com zero os meses de
      // buraco de uma série sazonal —, e sem esta guarda elas trariam para a DRE
      // categorias que não têm nada a mostrar.
      if (b.orcado === 0) continue
      merged.set(key, {
        categoryId: b.categoryId, categoryName: b.categoryName, categoryCode: b.categoryCode,
        categoryType: b.categoryType, parentId: b.parentId, parentName: b.parentName,
        parentCode: b.parentCode, month: b.month,
        realizado: 0, orcado: b.orcado,
      })
    }

    return Array.from(merged.values())
  }, [data.rows, budgetRows])

  /** A cascata do orçado, rodada no cliente sobre as mesmas linhas. */
  const subtotalsOrcado = useMemo(() => {
    if (!budgetOn) return new Map<string, DreMonthSubtotals>()
    const src: SubtotalRow[] = rows.map(r => ({
      month: r.month, categoryType: r.categoryType, netAmount: r.orcado,
    }))
    return new Map(months.map(m => [m, computeSubtotals(m, src)]))
  }, [budgetOn, rows, months])

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

  const allParentIds = useMemo(() => new Set(rows.map(r => r.parentId)), [rows])
  const isFullyExpanded = collapsedParents.size === 0

  function toggleAll() {
    setCollapsedParents(isFullyExpanded ? new Set(allParentIds) : new Set())
  }

  const selectedVersion = budgetVersions.find(v => v.id === versionId) ?? null

  /** Meses do período que caem fora do exercício da versão — ali não há orçado. */
  const mesesSemOrcado = useMemo(() => {
    if (!budgetOn || !selectedVersion) return []
    return months.filter(m => Number(m.slice(0, 4)) !== selectedVersion.fiscalYear)
  }, [budgetOn, selectedVersion, months])

  const versionOptions: SimpleDimensionItem[] = budgetVersions.map(v => ({
    id: v.id,
    name: `${v.name}${v.isActive ? ' · vigente' : ''}${v.status !== 'rascunho' ? ` · ${BUDGET_STATUS_LABELS[v.status]}` : ''}`,
    code: String(v.fiscalYear),
  }))

  const hasDimFilters = selCc.length > 0 || selBu.length > 0 || selLe.length > 0
  // rótulo + (2 ou 3 por mês) + (2 ou 3 no Total) + Média (só sem orçamento)
  const perMonth = budgetOn ? 3 : 2
  const nCols = months.length * perMonth + perMonth + (budgetOn ? 1 : 2)

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

          {/* ── Orçamento ── */}
          <div className="h-5 w-px bg-border mx-0.5" />

          <Button
            size="sm"
            variant={budgetOn ? 'secondary' : 'ghost'}
            disabled={budgetVersions.length === 0}
            title={budgetVersions.length === 0
              ? 'Crie uma versão de orçamento em Orçamento para comparar aqui.'
              : 'Mostra o orçado ao lado do realizado; a terceira coluna passa a ser o desvio.'}
            className={cn('h-8 text-xs gap-1.5', !budgetOn && 'text-muted-foreground')}
            onClick={() => {
              const vid = versionId ?? defaultVersionId(fromMonth, toMonth)
              const next = !budgetOn
              setBudgetOn(next)
              setVersionId(vid)
              fetchData({ on: next, vid })
            }}
          >
            <Target className="h-3 w-3" />
            Orçamento
          </Button>

          {budgetOn && budgetVersions.length > 0 && (
            <div className="w-60">
              <CellCombobox
                value={versionId}
                options={versionOptions}
                placeholder="Escolha a versão"
                onValueChange={id => { setVersionId(id); fetchData({ vid: id }) }}
              />
            </div>
          )}
        </div>

        {/* O orçado que não existe para parte do período — sem isto, colunas
            vazias parecem defeito. */}
        {mesesSemOrcado.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-600">
            {selectedVersion!.name} cobre o exercício de {selectedVersion!.fiscalYear}.
            {' '}{mesesSemOrcado.length === 1 ? 'O mês' : 'Os meses'} {mesesSemOrcado.map(monthLabel).join(', ')}
            {' '}{mesesSemOrcado.length === 1 ? 'fica' : 'ficam'} sem orçado.
          </p>
        )}
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
              // As colunas fixas somam o mesmo nos dois estados: com orçamento
              // são Total + Orç + Var%; sem, são Total + AV% + Média.
              minWidth: LABEL_W
                + months.length * (COL_W + THIRD_COL_W + (budgetOn ? COL_W : 0))
                + 2 * TOTAL_COL_W + THIRD_COL_W,
              width: '100%',
            }}
          >
            <colgroup>
              <col style={{ width: LABEL_W, minWidth: LABEL_W }} />
              {months.map(m => (
                <Fragment key={m}>
                  <col style={{ width: COL_W, minWidth: COL_W }} />
                  {budgetOn && <col style={{ width: COL_W, minWidth: COL_W }} />}
                  <col style={{ width: THIRD_COL_W, minWidth: THIRD_COL_W }} />
                </Fragment>
              ))}
              <col style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }} />
              {budgetOn && <col style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }} />}
              <col style={{ width: THIRD_COL_W, minWidth: THIRD_COL_W }} />
              {!budgetOn && <col style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }} />}
            </colgroup>

            <thead className="sticky top-0 z-20 bg-background border-b border-slate-200 shadow-[0_1px_0_0_#e2e8f0]">
              <tr>
                <th rowSpan={2} className="text-left text-xs font-medium text-muted-foreground px-4 py-2 align-bottom">
                  Conta
                </th>
                {months.map(m => (
                  <th key={m} colSpan={perMonth}
                    className="text-center text-xs font-medium text-muted-foreground px-3 pt-2 pb-0.5 whitespace-nowrap border-l border-slate-200">
                    {monthLabel(m)}
                  </th>
                ))}
                <th colSpan={perMonth}
                  className="text-center text-xs font-medium text-muted-foreground/60 px-3 pt-2 pb-0.5 whitespace-nowrap border-l border-slate-300">
                  Total
                </th>
                {!budgetOn && (
                  <th rowSpan={2}
                    className="text-right text-xs font-medium text-muted-foreground/60 px-3 py-2 whitespace-nowrap align-bottom">
                    Média/mês
                  </th>
                )}
              </tr>
              <tr>
                {months.map(m => (
                  <Fragment key={m}>
                    <SubHead className="border-l border-slate-200">{budgetOn ? 'Real' : 'Valor'}</SubHead>
                    {budgetOn && <SubHead>Orç</SubHead>}
                    <SubHead
                      narrow
                      title={budgetOn
                        ? 'Variação horizontal — desvio do realizado sobre o orçado'
                        : 'Análise vertical — participação na Receita Líquida do mês'}
                    >
                      {budgetOn ? 'Var%' : 'AV%'}
                    </SubHead>
                  </Fragment>
                ))}
                <SubHead className="border-l border-slate-300">{budgetOn ? 'Real' : 'Valor'}</SubHead>
                {budgetOn && <SubHead>Orç</SubHead>}
                <SubHead
                  narrow
                  title={budgetOn
                    ? 'Desvio do realizado sobre o orçado no período inteiro'
                    : 'Participação na Receita Líquida do período inteiro'}
                >
                  {budgetOn ? 'Var%' : 'AV%'}
                </SubHead>
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
                  subtotalsOrcado={subtotalsOrcado}
                  avBase={avBase}
                  budgetOn={budgetOn}
                  collapsedParents={collapsedParents}
                  toggleParent={toggleParent}
                  openDrillDown={openDrillDown}
                  openDrillDownTotal={openDrillDownTotal}
                  openBudgetDrill={openBudgetDrill}
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
                subtotalsOrcado={subtotalsOrcado}
                avBase={avBase}
                budgetOn={budgetOn}
                collapsedParents={collapsedParents}
                toggleParent={toggleParent}
                openDrillDown={openDrillDown}
                openDrillDownTotal={openDrillDownTotal}
                openBudgetDrill={openBudgetDrill}
                nCols={nCols}
              />
            </tbody>
          </table>
        </div>
      )}

      {/* ── Rodapé do orçamento ── */}
      {budgetOn && (
        <div className="shrink-0 px-6 py-2 flex items-center gap-4 text-[11px] text-muted-foreground border-t">
          <span>Variação positiva é favorável — vale para receita e para despesa.</span>
        </div>
      )}

      {/* ── Drill-down do orçado, com edição do lançamento ── */}
      {budgetDrill && selectedVersion && (
        <BudgetDrillDownDialog
          open
          onOpenChange={o => { if (!o) { setBudgetDrill(null); setBudgetDrillData(null) } }}
          title={budgetDrill.title}
          subtitle={budgetDrill.subtitle}
          data={budgetDrillData}
          loading={isBudgetDrilling}
          edit={{
            versionId: selectedVersion.id,
            fiscalYear: selectedVersion.fiscalYear,
            readOnlyReason: selectedVersion.status === 'arquivado'
              ? 'Versão arquivada — duplique-a para editar.'
              : null,
            leafCategories,
            costCenters,
            businessUnits,
            legalEntities,
            contactOptions,
            // Editar aqui muda o orçado da malha: recarrega os dois.
            onSaved: () => { setBudgetDrill(null); setBudgetDrillData(null); fetchData() },
          }}
        />
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
          contacts={contactOptions}
        />
      )}
    </div>
  )
}

// ─── SubHead ──────────────────────────────────────────────────────────────────

function SubHead({ children, className, title, narrow }: {
  children: React.ReactNode
  className?: string
  title?: string
  narrow?: boolean
}) {
  return (
    <th
      title={title}
      className={cn(
        'text-right text-[10px] font-normal text-muted-foreground/50 pb-1.5 whitespace-nowrap',
        narrow ? 'px-2' : 'px-3',
        className,
      )}
    >
      {children}
    </th>
  )
}

// ─── LayoutBlock ──────────────────────────────────────────────────────────────

interface BlockProps {
  section: LayoutSection
  rows: CellRow[]
  months: string[]
  subtotalsByMonth: Map<string, DreMonthSubtotals>
  subtotalsOrcado: Map<string, DreMonthSubtotals>
  avBase: AvBase
  budgetOn: boolean
  collapsedParents: Set<string>
  toggleParent: (id: string) => void
  openDrillDown: (categoryId: string, categoryName: string, month: string) => void
  openDrillDownTotal: (categoryId: string, categoryName: string) => void
  openBudgetDrill: (categoryId: string, categoryName: string, month: string | null) => void
  nCols: number
}

function LayoutBlock({
  section, rows, months, subtotalsByMonth, subtotalsOrcado, avBase, budgetOn,
  collapsedParents, toggleParent, openDrillDown, openDrillDownTotal, openBudgetDrill, nCols,
}: BlockProps) {
  const blocks = useMemo(
    () => buildBlocks(rows, section.types, (r: CellRow) => ({ realizado: r.realizado, orcado: r.orcado })),
    [rows, section.types],
  )

  const subtotalAt = (m: string): Cell => ({
    realizado: (subtotalsByMonth.get(m)?.[section.subtotalKey] as number) ?? 0,
    orcado:    (subtotalsOrcado.get(m)?.[section.subtotalKey] as number) ?? 0,
  })

  const subtotalTotal = months.reduce<Cell>((acc, m) => {
    const c = subtotalAt(m)
    return { realizado: acc.realizado + c.realizado, orcado: acc.orcado + c.orcado }
  }, { ...EMPTY_CELL })
  const subtotalAvg = months.length > 0 ? subtotalTotal.realizado / months.length : 0

  return (
    <>
      {blocks.map(block => (
        <TypeBlock
          key={block.type}
          block={block}
          months={months}
          avBase={avBase}
          budgetOn={budgetOn}
          collapsedParents={collapsedParents}
          toggleParent={toggleParent}
          openDrillDown={openDrillDown}
          openDrillDownTotal={openDrillDownTotal}
          openBudgetDrill={openBudgetDrill}
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
        <MonthCells
          months={months}
          cellAt={subtotalAt}
          avBase={avBase}
          budgetOn={budgetOn}
          signedAv
          bold
          inverted={section.keyMetric}
        />
        {/* Total */}
        <Num value={subtotalTotal.realizado} bold inverted={section.keyMetric} className="border-l border-slate-300" />
        {budgetOn && <Num value={subtotalTotal.orcado} bold inverted={section.keyMetric} title={cellTitle(subtotalTotal)} />}
        <ThirdCell cell={subtotalTotal} base={avBase.total} budgetOn={budgetOn} signedAv bold inverted={section.keyMetric} />
        {!budgetOn && <Num value={subtotalAvg} bold inverted={section.keyMetric} />}
      </tr>
    </>
  )
}

// ─── TypeBlock ────────────────────────────────────────────────────────────────

interface TypeBlockProps {
  block: SectionBlock<Cell>
  months: string[]
  avBase: AvBase
  budgetOn: boolean
  collapsedParents: Set<string>
  toggleParent: (id: string) => void
  openDrillDown: (categoryId: string, categoryName: string, month: string) => void
  openDrillDownTotal: (categoryId: string, categoryName: string) => void
  openBudgetDrill: (categoryId: string, categoryName: string, month: string | null) => void
  nCols: number
}

function TypeBlock({
  block, months, avBase, budgetOn, collapsedParents, toggleParent,
  openDrillDown, openDrillDownTotal, openBudgetDrill, nCols,
}: TypeBlockProps) {
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
          budgetOn={budgetOn}
          isCollapsed={collapsedParents.has(parent.parentId)}
          onToggle={() => toggleParent(parent.parentId)}
          openDrillDown={openDrillDown}
          openDrillDownTotal={openDrillDownTotal}
          openBudgetDrill={openBudgetDrill}
        />
      ))}
    </>
  )
}

// ─── ParentBlock ──────────────────────────────────────────────────────────────

interface ParentBlockProps {
  parent: ParentNode<Cell>
  months: string[]
  avBase: AvBase
  budgetOn: boolean
  isCollapsed: boolean
  onToggle: () => void
  openDrillDown: (categoryId: string, categoryName: string, month: string) => void
  openDrillDownTotal: (categoryId: string, categoryName: string) => void
  openBudgetDrill: (categoryId: string, categoryName: string, month: string | null) => void
}

function ParentBlock({
  parent, months, avBase, budgetOn, isCollapsed, onToggle,
  openDrillDown, openDrillDownTotal, openBudgetDrill,
}: ParentBlockProps) {
  const parentByMonth = useMemo(() => {
    const result: Record<string, Cell> = {}
    months.forEach(m => {
      result[m] = parent.children.reduce<Cell>((acc, c) => {
        const cell = c.byMonth[m]
        if (cell) { acc.realizado += cell.realizado; acc.orcado += cell.orcado }
        return acc
      }, { ...EMPTY_CELL })
    })
    return result
  }, [parent.children, months])

  const parentTotal = months.reduce<Cell>((acc, m) => {
    const c = parentByMonth[m] ?? EMPTY_CELL
    return { realizado: acc.realizado + c.realizado, orcado: acc.orcado + c.orcado }
  }, { ...EMPTY_CELL })
  const parentAvg = months.length > 0 ? parentTotal.realizado / months.length : 0

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
        <MonthCells
          months={months}
          cellAt={m => parentByMonth[m] ?? EMPTY_CELL}
          avBase={avBase}
          budgetOn={budgetOn}
          bold
          light
          onValue={singleChild ? m => openDrillDown(singleChild.categoryId, singleChild.categoryName, m) : undefined}
          onBudget={singleChild ? m => openBudgetDrill(singleChild.categoryId, singleChild.categoryName, m) : undefined}
        />
        <td className="px-3 py-[3px] text-right tabular-nums text-xs font-semibold border-l border-slate-300 text-muted-foreground/50">
          {parentTotal.realizado === 0 ? '—' : fmtNum(parentTotal.realizado)}
        </td>
        {budgetOn && (
          <td className="px-3 py-[3px] text-right tabular-nums text-xs font-semibold text-muted-foreground/50">
            {parentTotal.orcado === 0 ? '—' : fmtNum(parentTotal.orcado)}
          </td>
        )}
        <ThirdCell cell={parentTotal} base={avBase.total} budgetOn={budgetOn} bold light />
        {!budgetOn && (
          <td className="px-3 py-[3px] text-right tabular-nums text-xs font-semibold text-muted-foreground/40">
            {parentAvg === 0 ? '—' : fmtNum(parentAvg)}
          </td>
        )}
      </tr>

      {/* Child rows */}
      {!isCollapsed && !hasSingleChild && parent.children.map(child => {
        const childTotal = months.reduce<Cell>((acc, m) => {
          const c = child.byMonth[m]
          if (c) { acc.realizado += c.realizado; acc.orcado += c.orcado }
          return acc
        }, { ...EMPTY_CELL })
        const childAvg = months.length > 0 ? childTotal.realizado / months.length : 0

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
            <MonthCells
              months={months}
              cellAt={m => child.byMonth[m] ?? EMPTY_CELL}
              avBase={avBase}
              budgetOn={budgetOn}
              light
              onValue={m => openDrillDown(child.categoryId, child.categoryName, m)}
              onBudget={m => openBudgetDrill(child.categoryId, child.categoryName, m)}
            />
            <td
              className={cn(
                'px-3 py-[3px] text-right tabular-nums text-xs border-l border-slate-300',
                childTotal.realizado !== 0
                  ? 'text-muted-foreground/60 cursor-pointer hover:text-foreground hover:underline underline-offset-2'
                  : 'text-muted-foreground/40',
              )}
              onClick={childTotal.realizado !== 0 ? () => openDrillDownTotal(child.categoryId, child.categoryName) : undefined}
            >
              {childTotal.realizado === 0 ? '—' : fmtNum(childTotal.realizado)}
            </td>
            {budgetOn && (
              <td
                className={cn(
                  'px-3 py-[3px] text-right tabular-nums text-xs',
                  childTotal.orcado !== 0
                    ? 'text-muted-foreground/60 cursor-pointer hover:text-foreground hover:underline underline-offset-2'
                    : 'text-muted-foreground/40',
                )}
                onClick={childTotal.orcado !== 0 ? () => openBudgetDrill(child.categoryId, child.categoryName, null) : undefined}
              >
                {childTotal.orcado === 0 ? '—' : fmtNum(childTotal.orcado)}
              </td>
            )}
            <ThirdCell cell={childTotal} base={avBase.total} budgetOn={budgetOn} light />
            {!budgetOn && (
              <td className="px-3 py-[3px] text-right tabular-nums text-xs text-muted-foreground/30">
                {childAvg === 0 ? '—' : fmtNum(childAvg)}
              </td>
            )}
          </tr>
        )
      })}
    </>
  )
}
