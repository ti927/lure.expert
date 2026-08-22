'use client'

import { Fragment, useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Loader2, Target, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/states/empty-state'
import { PartialDataBanner } from '@/components/states/partial-data-banner'
import { Num } from '@/components/financial/num-cell'
import { DimFilter } from '@/components/transacoes-shared/dim-filter'
import { DrillDownDialog } from '@/components/transacoes-shared/drill-down-dialog'
import { BudgetDrillDownDialog } from '@/components/budget/budget-drilldown-dialog'
import type { SimpleDimensionItem } from '@/components/transacoes-shared/types'
import { cn } from '@/lib/utils'
import { fmtMoney, monthLabel } from '@/lib/format'
import { LAYOUT, BELOW_LAYOUT, buildBlocks, type LayoutSection } from '@/lib/dre-layout'
import { computeSubtotals, type SubtotalRow } from '@/lib/dre-calc'
import { DRE_TYPE_LABELS, type DrillDownTransaction, type LeafCategory } from '@/lib/dre-types'
import {
  BUDGET_REGIMES, BUDGET_REGIME_LABELS, CELL_MODES, CELL_MODE_LABELS,
  type BudgetRegime, type CellMode, type BudgetVsActualData, type BudgetVsActualRow,
  type BudgetVersionListItem, type BudgetDrillDownEntry,
} from '@/lib/budget-types'
import { getBudgetVsActual, getBudgetDrillDown } from '@/server/budget'
import { getDreDrillDown } from '@/server/dre'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'

const STORAGE_KEY = 'lure:orcamento:comparacao:filters'
const COL_W = 96
const TOTAL_COL_W = 104
const LABEL_W = 260

type Cell = { orcado: number; realizado: number }

/**
 * CONVENÇÃO DE SINAL: com `netAmount` (receita positiva, despesa negativa),
 * `realizado − orcado` já é "favorável quando positivo" dos dois lados —
 * gastar menos que o previsto dá variação positiva, faturar menos dá negativa.
 * Não inverter por tipo de conta.
 */
function cellValue(c: Cell, mode: CellMode): number {
  switch (mode) {
    case 'orcado':      return c.orcado
    case 'realizado':   return c.realizado
    case 'variacao':    return c.realizado - c.orcado
    case 'variacaoPct': return c.orcado === 0 ? 0 : ((c.realizado - c.orcado) / Math.abs(c.orcado)) * 100
  }
}

const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`

/** Mês corrente no formato YYYY-MM. */
function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * "Mês fechado" default = o mês anterior ao corrente. Não é "mês com dado":
 * um lançamento retardatário em novembro marcaria novembro como fechado e
 * truncaria a projeção.
 */
function defaultFechadoAte(fiscalYear: number): string {
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const py = prev.getFullYear()
  const pm = prev.getMonth() + 1
  if (py < fiscalYear) return `${fiscalYear - 1}-12`  // exercício ainda não começou
  if (py > fiscalYear) return `${fiscalYear}-12`      // exercício inteiro fechado
  return `${py}-${String(pm).padStart(2, '0')}`
}

interface Props {
  version: BudgetVersionListItem
  costCenters: CostCenter[]
  businessUnits: BusinessUnit[]
  legalEntities: LegalEntity[]
  leafCategories: LeafCategory[]
  contactOptions: SimpleDimensionItem[]
}

export function ComparacaoTab({
  version, costCenters, businessUnits, legalEntities, leafCategories, contactOptions,
}: Props) {
  const fy = version.fiscalYear

  const [regime, setRegime] = useState<BudgetRegime>('competencia')
  const [cellMode, setCellMode] = useState<CellMode>('variacao')
  const [fechadoAte, setFechadoAte] = useState(() => defaultFechadoAte(fy))
  const [selCc, setSelCc] = useState<string[]>([])
  const [selBu, setSelBu] = useState<string[]>([])
  const [selLe, setSelLe] = useState<string[]>([])
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())

  const [data, setData] = useState<BudgetVsActualData | null>(null)
  const [isPending, startTransition] = useTransition()

  const from = `${fy}-01-01`
  const to = `${fy}-12-31`

  const fetchData = useCallback((over: Partial<{
    regime: BudgetRegime; cc: string[]; bu: string[]; le: string[]
  }> = {}) => {
    const r = over.regime ?? regime
    const cc = over.cc ?? selCc
    const bu = over.bu ?? selBu
    const le = over.le ?? selLe

    startTransition(async () => {
      const d = await getBudgetVsActual({
        versionId: version.id,
        regime: r,
        from, to,
        costCenterIds: cc.length ? cc : undefined,
        businessUnitIds: bu.length ? bu : undefined,
        legalEntityIds: le.length ? le : undefined,
      })
      setData(d)
    })
  }, [version.id, regime, selCc, selBu, selLe, from, to])

  // Restaura preferências e carrega
  useEffect(() => {
    let saved: { regime?: BudgetRegime; cellMode?: CellMode; fechadoAte?: string } | null = null
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) saved = JSON.parse(raw)
    } catch { /* ignora */ }

    if (saved?.regime) setRegime(saved.regime)
    if (saved?.cellMode) setCellMode(saved.cellMode)
    if (saved?.fechadoAte) setFechadoAte(saved.fechadoAte)
    fetchData({ regime: saved?.regime })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version.id])

  const persist = useCallback((patch: Partial<{ regime: BudgetRegime; cellMode: CellMode; fechadoAte: string }>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ regime, cellMode, fechadoAte, ...patch }))
    } catch { /* ignora */ }
  }, [regime, cellMode, fechadoAte])

  // ── Drill-down duplo ──
  const [txDrill, setTxDrill] = useState<{ title: string; subtitle: string } | null>(null)
  const [txData, setTxData] = useState<DrillDownTransaction[] | null>(null)
  const [budgetDrill, setBudgetDrill] = useState<{ title: string; subtitle: string } | null>(null)
  const [budgetData, setBudgetData] = useState<BudgetDrillDownEntry[] | null>(null)
  const [isDrilling, startDrill] = useTransition()

  const dimArgs = useMemo(() => ({
    costCenterIds: selCc.length ? selCc : undefined,
    businessUnitIds: selBu.length ? selBu : undefined,
    legalEntityIds: selLe.length ? selLe : undefined,
  }), [selCc, selBu, selLe])

  function monthRange(month: string): { from: string; to: string } {
    const [y, m] = month.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
  }

  function openDrill(categoryId: string, categoryName: string, month: string | null) {
    const range = month ? monthRange(month) : { from, to }
    const subtitle = month ? monthLabel(month) : `Ano de ${fy}`

    // A célula abre o drill-down daquilo que ela está mostrando. Nos modos de
    // variação, o que interessa é o que aconteceu de fato — para ver o orçado,
    // troque o modo da célula para Orçado.
    if (cellMode === 'orcado') {
      setBudgetDrill({ title: categoryName, subtitle })
      setBudgetData(null)
      startDrill(async () => {
        setBudgetData(await getBudgetDrillDown(version.id, categoryId, regime, range, dimArgs))
      })
    } else {
      setTxDrill({ title: categoryName, subtitle })
      setTxData(null)
      startDrill(async () => {
        const r = await getDreDrillDown(categoryId, month ?? '', dimArgs, range, regime)
        setTxData(r.transactions)
      })
    }
  }

  // ── Derivados ──
  const months = useMemo(() => data?.months ?? [], [data])
  const rows = useMemo(() => data?.rows ?? [], [data])
  const nowMonth = currentMonth()

  const subtotalsOrcado = useMemo(() => {
    const src: SubtotalRow[] = rows.map(r => ({ month: r.month, categoryType: r.categoryType, netAmount: r.orcado }))
    return new Map(months.map(m => [m, computeSubtotals(m, src)]))
  }, [rows, months])

  const subtotalsRealizado = useMemo(() => {
    const src: SubtotalRow[] = rows.map(r => ({ month: r.month, categoryType: r.categoryType, netAmount: r.realizado }))
    return new Map(months.map(m => [m, computeSubtotals(m, src)]))
  }, [rows, months])

  /** Projeção: realizado dos meses fechados + orçado dos restantes. O mês corrente nunca é dividido. */
  const subtotalsProjecao = useMemo(() => {
    const src: SubtotalRow[] = rows.map(r => ({
      month: r.month,
      categoryType: r.categoryType,
      netAmount: r.month <= fechadoAte ? r.realizado : r.orcado,
    }))
    return new Map(months.map(m => [m, computeSubtotals(m, src)]))
  }, [rows, months, fechadoAte])

  const allParentIds = useMemo(() => new Set(rows.map(r => r.parentId)), [rows])
  const isFullyExpanded = collapsedParents.size === 0

  const coveragePct = useMemo(() => {
    const c = data?.coverage
    if (!c || c.total === 0) return null
    return {
      costCenter: c.costCenter / c.total,
      businessUnit: c.businessUnit / c.total,
      legalEntity: c.legalEntity / c.total,
    }
  }, [data])

  const lowCoverage = useMemo(() => {
    if (!coveragePct) return null
    const warn: string[] = []
    if (selCc.length && coveragePct.costCenter < 0.9) warn.push(`centro de custo em ${Math.round(coveragePct.costCenter * 100)}%`)
    if (selBu.length && coveragePct.businessUnit < 0.9) warn.push(`unidade de negócio em ${Math.round(coveragePct.businessUnit * 100)}%`)
    if (selLe.length && coveragePct.legalEntity < 0.9) warn.push(`entidade jurídica em ${Math.round(coveragePct.legalEntity * 100)}%`)
    return warn.length ? warn : null
  }, [coveragePct, selCc, selBu, selLe])

  const nCols = months.length + 5   // rótulo + meses + 4 colunas fixas
  const hasDimFilters = selCc.length > 0 || selBu.length > 0 || selLe.length > 0

  // ── Renderização de uma linha de valores ──
  function renderCells(byMonth: Record<string, Cell>, opts: {
    bold?: boolean; light?: boolean; inverted?: boolean
    onCell?: (month: string) => void
    onTotal?: () => void
  } = {}) {
    const totals = months.reduce<Cell>((acc, m) => {
      const c = byMonth[m]
      if (c) { acc.orcado += c.orcado; acc.realizado += c.realizado }
      return acc
    }, { orcado: 0, realizado: 0 })

    const realizadoYtd = months
      .filter(m => m <= nowMonth)
      .reduce((s, m) => s + (byMonth[m]?.realizado ?? 0), 0)

    const projecao = months.reduce((s, m) => {
      const c = byMonth[m]
      if (!c) return s
      return s + (m <= fechadoAte ? c.realizado : c.orcado)
    }, 0)

    const varProj = projecao - totals.orcado
    const isPct = cellMode === 'variacaoPct'

    return (
      <>
        {months.map(m => {
          const c = byMonth[m] ?? { orcado: 0, realizado: 0 }
          return (
            <Num
              key={m}
              value={cellValue(c, cellMode)}
              format={isPct ? fmtPct : undefined}
              bold={opts.bold}
              light={opts.light}
              inverted={opts.inverted}
              title={`Orçado ${fmtMoney(c.orcado)} · Realizado ${fmtMoney(c.realizado)}`}
              onClick={opts.onCell ? () => opts.onCell!(m) : undefined}
            />
          )
        })}
        <Num value={totals.orcado} bold={opts.bold} light={opts.light} inverted={opts.inverted}
          className="border-l border-slate-200" onClick={opts.onTotal} />
        <Num value={realizadoYtd} bold={opts.bold} light={opts.light} inverted={opts.inverted} />
        <Num value={projecao} bold={opts.bold} light={opts.light} inverted={opts.inverted} />
        <Num value={varProj} bold={opts.bold} light={opts.light} inverted={opts.inverted}
          className="border-l border-slate-200" />
      </>
    )
  }

  function renderSection(section: LayoutSection) {
    const blocks = buildBlocks(rows, section.types, (r: BudgetVsActualRow) => ({
      orcado: r.orcado, realizado: r.realizado,
    }))

    const subtotalByMonth: Record<string, Cell> = {}
    for (const m of months) {
      subtotalByMonth[m] = {
        orcado: (subtotalsOrcado.get(m)?.[section.subtotalKey] as number) ?? 0,
        realizado: (subtotalsRealizado.get(m)?.[section.subtotalKey] as number) ?? 0,
      }
    }
    // A projeção dos subtotais roda a cascata sobre as linhas mistas, para ficar
    // consistente com as linhas de detalhe por construção.
    const projSubtotal = months.reduce(
      (s, m) => s + ((subtotalsProjecao.get(m)?.[section.subtotalKey] as number) ?? 0), 0)
    const orcadoSubtotal = months.reduce((s, m) => s + subtotalByMonth[m].orcado, 0)
    const realizadoYtdSubtotal = months.filter(m => m <= nowMonth)
      .reduce((s, m) => s + subtotalByMonth[m].realizado, 0)
    const isPct = cellMode === 'variacaoPct'

    return (
      <Fragment key={section.subtotalKey}>
        {blocks.map(block => (
          <Fragment key={block.type}>
            <tr className="bg-slate-100/70 border-t border-slate-200">
              <td colSpan={nCols} className="sticky left-0 bg-slate-100/70 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {DRE_TYPE_LABELS[block.type]}
              </td>
            </tr>

            {block.parents.map(parent => {
              const isCollapsed = collapsedParents.has(parent.parentId)
              const parentByMonth: Record<string, Cell> = {}
              for (const m of months) {
                parentByMonth[m] = parent.children.reduce<Cell>((acc, c) => {
                  const cell = c.byMonth[m]
                  if (cell) { acc.orcado += cell.orcado; acc.realizado += cell.realizado }
                  return acc
                }, { orcado: 0, realizado: 0 })
              }

              return (
                <Fragment key={parent.parentId}>
                  <tr className="border-b border-slate-100">
                    <td className="sticky left-0 bg-background px-4 py-[3px] text-xs font-medium text-foreground">
                      <div className="flex items-center gap-1 pl-2">
                        <button
                          onClick={() => setCollapsedParents(prev => {
                            const n = new Set(prev)
                            if (n.has(parent.parentId)) n.delete(parent.parentId); else n.add(parent.parentId)
                            return n
                          })}
                          className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
                          aria-label={isCollapsed ? 'Expandir' : 'Recolher'}
                        >
                          {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                        {parent.parentCode && (
                          <span className="text-muted-foreground/50 font-mono text-[10px] shrink-0">{parent.parentCode}</span>
                        )}
                        <span className="truncate">{parent.parentName}</span>
                      </div>
                    </td>
                    {renderCells(parentByMonth, { bold: true, light: true })}
                  </tr>

                  {!isCollapsed && parent.children.map(child => (
                    <tr key={child.categoryId} className="border-b border-slate-50">
                      <td className="sticky left-0 bg-background px-4 py-[3px] text-xs text-muted-foreground">
                        <div className="flex items-center gap-1 pl-8">
                          {child.categoryCode && (
                            <span className="text-muted-foreground/30 font-mono text-[10px] shrink-0">{child.categoryCode}</span>
                          )}
                          <span className="truncate">{child.categoryName}</span>
                        </div>
                      </td>
                      {renderCells(child.byMonth, {
                        light: true,
                        onCell: m => openDrill(child.categoryId, child.categoryName, m),
                        onTotal: () => openDrill(child.categoryId, child.categoryName, null),
                      })}
                    </tr>
                  ))}
                </Fragment>
              )
            })}

            {/* subtotal da seção */}
          </Fragment>
        ))}

        <tr className={cn('border-y', section.keyMetric ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50')}>
          <td className={cn(
            'sticky left-0 px-4 py-2 text-xs font-semibold',
            section.keyMetric ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-700',
          )}>
            {section.subtotalLabel}
          </td>
          {months.map(m => (
            <Num key={m} value={cellValue(subtotalByMonth[m], cellMode)}
              format={isPct ? fmtPct : undefined} bold inverted={section.keyMetric}
              title={`Orçado ${fmtMoney(subtotalByMonth[m].orcado)} · Realizado ${fmtMoney(subtotalByMonth[m].realizado)}`} />
          ))}
          <Num value={orcadoSubtotal} bold inverted={section.keyMetric} className="border-l border-slate-200" />
          <Num value={realizadoYtdSubtotal} bold inverted={section.keyMetric} />
          <Num value={projSubtotal} bold inverted={section.keyMetric} />
          <Num value={projSubtotal - orcadoSubtotal} bold inverted={section.keyMetric} className="border-l border-slate-200" />
        </tr>
      </Fragment>
    )
  }

  // ── Render ──
  if (!data && isPending) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Barra de controles ── */}
      <div className="shrink-0 px-6 pb-3 flex flex-wrap gap-2 items-center">
        <div className="inline-flex rounded-md border p-0.5">
          {BUDGET_REGIMES.map(r => (
            <button
              key={r}
              onClick={() => { setRegime(r); persist({ regime: r }); fetchData({ regime: r }) }}
              className={cn(
                'h-7 px-2.5 rounded text-xs font-medium transition-colors',
                regime === r ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
              title={r === 'competencia' ? 'Compara com a DRE (data de competência)' : 'Compara com o Fluxo (data de caixa)'}
            >
              {BUDGET_REGIME_LABELS[r]}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-md border p-0.5">
          {CELL_MODES.map(m => (
            <button
              key={m}
              onClick={() => { setCellMode(m); persist({ cellMode: m }) }}
              className={cn(
                'h-7 px-2.5 rounded text-xs font-medium transition-colors',
                cellMode === m ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {CELL_MODE_LABELS[m]}
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-border mx-0.5" />

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Fechado até
          <input
            type="month"
            value={fechadoAte}
            onChange={e => { setFechadoAte(e.target.value); persist({ fechadoAte: e.target.value }) }}
            className="h-8 px-2 text-xs border rounded-md bg-background text-foreground"
            title="Meses até aqui entram na projeção como realizado; os seguintes, como orçado."
          />
        </label>

        <DimFilter label="Centro de Custo" allowNone
          options={costCenters.map(c => ({ id: c.id, name: c.name, code: c.code }))}
          selected={selCc} onChange={ids => { setSelCc(ids); fetchData({ cc: ids }) }} />
        <DimFilter label="Unidade de Negócio" allowNone
          options={businessUnits.map(b => ({ id: b.id, name: b.name, code: b.code }))}
          selected={selBu} onChange={ids => { setSelBu(ids); fetchData({ bu: ids }) }} />
        <DimFilter label="Entidade Jurídica" allowNone
          options={legalEntities.map(l => ({ id: l.id, name: l.name, code: l.code }))}
          selected={selLe} onChange={ids => { setSelLe(ids); fetchData({ le: ids }) }} />

        {hasDimFilters && (
          <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground gap-1"
            onClick={() => { setSelCc([]); setSelBu([]); setSelLe([]); fetchData({ cc: [], bu: [], le: [] }) }}>
            <X className="h-3 w-3" /> Limpar
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {rows.length > 0 && (
            <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground gap-1"
              onClick={() => setCollapsedParents(isFullyExpanded ? new Set(allParentIds) : new Set())}>
              {isFullyExpanded
                ? <><ChevronsUp className="h-3 w-3" /> Recolher todos</>
                : <><ChevronsDown className="h-3 w-3" /> Expandir todos</>}
            </Button>
          )}
          {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* ── Avisos de honestidade do número ── */}
      {(data?.semCategoria.count ?? 0) > 0 && (
        <div className="shrink-0 px-6 pb-2">
          <PartialDataBanner
            variant="warning"
            message={`${fmtMoney(Math.abs(data!.semCategoria.net))} em ${data!.semCategoria.count} transações sem categoria não entram nesta comparação.`}
          />
        </div>
      )}

      {lowCoverage && (
        <div className="shrink-0 px-6 pb-2">
          <PartialDataBanner
            variant="warning"
            message={`Cobertura baixa no realizado: ${lowCoverage.join(', ')}. Filtrar por uma dimensão mal preenchida faz a variação parecer melhor do que é.`}
          />
        </div>
      )}

      {/* ── Matriz ── */}
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-10">
          <EmptyState
            icon={<Target className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
            title={`Nada a comparar em ${fy}`}
            description="Lance previsões na aba Planejamento ou categorize transações do exercício para o expert montar a comparação."
          />
        </div>
      ) : (
        <div className={cn('flex-1 overflow-auto min-h-0 px-6', isPending && 'opacity-50 pointer-events-none')}>
          <table className="border-collapse"
            style={{ minWidth: LABEL_W + months.length * COL_W + 4 * TOTAL_COL_W, width: '100%' }}>
            <colgroup>
              <col style={{ width: LABEL_W, minWidth: LABEL_W }} />
              {months.map(m => <col key={m} style={{ width: COL_W, minWidth: COL_W }} />)}
              <col style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }} />
              <col style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }} />
              <col style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }} />
              <col style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }} />
            </colgroup>

            <thead className="sticky top-0 z-20 bg-background border-b border-slate-200 shadow-[0_1px_0_0_#e2e8f0]">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">
                  Conta <span className="text-muted-foreground/50">· {CELL_MODE_LABELS[cellMode]}</span>
                </th>
                {months.map(m => (
                  <th key={m} className={cn(
                    'text-right text-xs font-medium px-3 py-2 whitespace-nowrap',
                    m <= fechadoAte ? 'text-foreground' : 'text-muted-foreground/60',
                  )} title={m <= fechadoAte ? 'Mês fechado — entra na projeção como realizado' : 'Mês aberto — entra na projeção como orçado'}>
                    {monthLabel(m)}
                    {m === fechadoAte && <span className="ml-0.5 text-primary">•</span>}
                  </th>
                ))}
                <th className="text-right text-xs font-medium text-muted-foreground/60 px-3 py-2 whitespace-nowrap border-l border-slate-200">Orçado ano</th>
                <th className="text-right text-xs font-medium text-muted-foreground/60 px-3 py-2 whitespace-nowrap">Realizado YTD</th>
                <th className="text-right text-xs font-medium text-muted-foreground/60 px-3 py-2 whitespace-nowrap">Projeção ano</th>
                <th className="text-right text-xs font-medium text-muted-foreground/60 px-3 py-2 whitespace-nowrap border-l border-slate-200"
                  title="Projeção do ano − Orçado do ano">Var. proj.</th>
              </tr>
            </thead>

            <tbody>
              {LAYOUT.map(renderSection)}
              <tr>
                <td colSpan={nCols} className="py-2 px-4">
                  <div className="border-t-2 border-dashed border-slate-200" />
                </td>
              </tr>
              {renderSection(BELOW_LAYOUT)}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Rodapé ── */}
      <div className="shrink-0 px-6 py-2 flex items-center gap-4 text-[11px] text-muted-foreground border-t">
        <span>Variação positiva é favorável — vale para receita e para despesa.</span>
        {(data?.foraDoHorizonte.count ?? 0) > 0 && (
          <span className="text-amber-600">
            {fmtMoney(data!.foraDoHorizonte.total)} de orçado em {data!.foraDoHorizonte.count} ocorrências
            têm data de {regime === 'caixa' ? 'caixa' : 'competência'} fora de {fy}.
          </span>
        )}
        <Link href="/dre" className="ml-auto text-primary hover:underline">Conferir na DRE</Link>
      </div>

      {/* ── Drill-down do realizado ── */}
      {txDrill && (
        <DrillDownDialog
          open
          onOpenChange={o => { if (!o) { setTxDrill(null); setTxData(null) } }}
          title={txDrill.title}
          subtitle={txDrill.subtitle}
          data={txData}
          loading={isDrilling}
          onDataChange={setTxData}
          leafCategories={leafCategories}
          costCenters={costCenters}
          businessUnits={businessUnits}
          legalEntities={legalEntities}
          contacts={contactOptions}
        />
      )}

      {/* ── Drill-down do orçado ── */}
      {budgetDrill && (
        <BudgetDrillDownDialog
          open
          onOpenChange={o => { if (!o) { setBudgetDrill(null); setBudgetData(null) } }}
          title={budgetDrill.title}
          subtitle={budgetDrill.subtitle}
          data={budgetData}
          loading={isDrilling}
          edit={{
            versionId: version.id,
            fiscalYear: fy,
            readOnlyReason: version.status === 'arquivado'
              ? 'Versão arquivada — duplique-a para editar.'
              : null,
            leafCategories,
            costCenters,
            businessUnits,
            legalEntities,
            contactOptions,
            onSaved: () => { setBudgetDrill(null); setBudgetData(null); fetchData() },
          }}
        />
      )}
    </div>
  )
}
