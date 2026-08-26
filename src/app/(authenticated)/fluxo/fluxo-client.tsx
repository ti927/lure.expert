'use client'

import { useState, useTransition, useMemo, useEffect, Fragment } from 'react'
import {
  X, Loader2, TrendingUp, BarChart3,
  ChevronRight, ChevronDown, ChevronsUpDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KPICard } from '@/components/financial/kpi-card'
import { Num as NumCell } from '@/components/financial/num-cell'
import { EmptyState } from '@/components/states/empty-state'
import { DrillDownDialog } from '@/components/transacoes-shared/drill-down-dialog'
import { DimFilter } from '@/components/transacoes-shared/dim-filter'
import { cn } from '@/lib/utils'
import { monthLabel } from '@/lib/format'
import { BarChart } from '@/components/charts/bar-chart'
import {
  COR_ENTRADA, COR_SAIDA, COR_ENTRADA_PROJETADA, COR_SAIDA_PROJETADA,
} from '@/components/charts/chart-theme'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { FluxoData } from '@/server/fluxo'
import { getFluxoMensalData } from '@/server/fluxo-mensal'
import type { FluxoMensalData, FluxoMensalCategoryRow } from '@/server/fluxo-mensal'
import { getDreDrillDown } from '@/server/dre'
import type { DrillDownTransaction, LeafCategory } from '@/lib/dre-types'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'
import type { SimpleDimensionItem } from '@/components/transacoes-shared/types'

// ─── Tipos internos ───────────────────────────────────────────────────────────

type ChildNode = {
  categoryId:   string
  categoryName: string
  categoryCode: string
  byMonth:      Record<string, number>
  total:        number
}

type ParentNode = {
  parentId:   string
  parentName: string
  parentCode: string
  opexCapex:  string
  byMonth:    Record<string, number>
  total:      number
  children:   ChildNode[]
}

type DrillDownState = {
  categoryId:   string
  categoryName: string
  month:        string
  dateRange?:   { from: string; to: string }
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const COL_W       = 96
const TOTAL_COL_W = 106
const LABEL_W     = 280

// ─── Helpers ─────────────────────────────────────────────────────────────────

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

// ─── Num (célula de valor) ────────────────────────────────────────────────────
// O componente compartilhado vive em @/components/financial/num-cell. Aqui só
// fixamos o tom do zero, que nesta tela é um pouco mais forte que o da DRE.

function Num(props: Omit<React.ComponentProps<typeof NumCell>, 'zeroClassName'>) {
  return <NumCell {...props} zeroClassName="text-muted-foreground/30" />
}

// ─── FluxoCaixaCategoria ──────────────────────────────────────────────────────

interface CaixaCategoriaProps {
  initialData:   FluxoMensalData
  initialFrom:   string
  initialTo:     string
  costCenters:   CostCenter[]
  businessUnits: BusinessUnit[]
  legalEntities: LegalEntity[]
  leafCategories: LeafCategory[]
  contactOptions: SimpleDimensionItem[]
}

function FluxoCaixaCategoria({
  initialData, initialFrom, initialTo,
  costCenters, businessUnits, legalEntities, leafCategories, contactOptions,
}: CaixaCategoriaProps) {
  const [data,       setData]       = useState<FluxoMensalData>(initialData)
  const [isPending,  startTransition]      = useTransition()
  const [isDrillLoading, startDrillTransition] = useTransition()

  const [fromMonth, setFromMonth] = useState(initialFrom.slice(0, 7))
  const [toMonth,   setToMonth]   = useState(initialTo.slice(0, 7))
  const [selCc,     setSelCc]     = useState<string[]>([])
  const [selBu,     setSelBu]     = useState<string[]>([])
  const [selLe,     setSelLe]     = useState<string[]>([])

  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())
  const [drillDown,        setDrillDown]        = useState<DrillDownState | null>(null)
  const [drillDownData,    setDrillDownData]    = useState<DrillDownTransaction[] | null>(null)

  // Restaura filtros do localStorage no mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('lure:fluxo:mensal:filters')
      if (!saved) return
      const p = JSON.parse(saved) as {
        fromMonth?: string; toMonth?: string
        selCc?: string[]; selBu?: string[]; selLe?: string[]
      }
      const validCcIds = new Set(costCenters.map(c => c.id))
      const validBuIds = new Set(businessUnits.map(b => b.id))
      const validLeIds = new Set(legalEntities.map(l => l.id))
      const fm = p.fromMonth ?? fromMonth
      const tm = p.toMonth   ?? toMonth
      const cc = (p.selCc ?? []).filter(id => validCcIds.has(id))
      const bu = (p.selBu ?? []).filter(id => validBuIds.has(id))
      const le = (p.selLe ?? []).filter(id => validLeIds.has(id))
      setFromMonth(fm); setToMonth(tm)
      setSelCc(cc);     setSelBu(bu);     setSelLe(le)
      const diffDate = fm !== initialFrom.slice(0, 7) || tm !== initialTo.slice(0, 7)
      const diffDims = cc.length > 0 || bu.length > 0 || le.length > 0
      if (diffDate || diffDims) fetchData({ fm, tm, cc, bu, le })
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Datas ISO do intervalo atual
  const currentFrom = useMemo(() => {
    const [y1, m1] = fromMonth.split('-').map(Number)
    return `${y1}-${String(m1).padStart(2, '0')}-01`
  }, [fromMonth])

  const currentTo = useMemo(() => {
    const [y2, m2] = toMonth.split('-').map(Number)
    const lastDay = new Date(y2, m2, 0).getDate()
    return `${y2}-${String(m2).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  }, [toMonth])

  function fetchData(params: { fm?: string; tm?: string; cc?: string[]; bu?: string[]; le?: string[] } = {}) {
    const fm = params.fm ?? fromMonth
    const tm = params.tm ?? toMonth
    const cc = params.cc ?? selCc
    const bu = params.bu ?? selBu
    const le = params.le ?? selLe

    try {
      localStorage.setItem('lure:fluxo:mensal:filters', JSON.stringify({ fromMonth: fm, toMonth: tm, selCc: cc, selBu: bu, selLe: le }))
    } catch {}

    const [y1, m1] = fm.split('-').map(Number)
    const [y2, m2] = tm.split('-').map(Number)
    const from    = `${y1}-${String(m1).padStart(2, '0')}-01`
    const lastDay = new Date(y2, m2, 0).getDate()
    const to      = `${y2}-${String(m2).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    startTransition(async () => {
      const d = await getFluxoMensalData({
        from, to,
        costCenterIds:    cc.length ? cc : undefined,
        businessUnitIds:  bu.length ? bu : undefined,
        legalEntityIds:   le.length ? le : undefined,
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

  function openDrillDown(categoryId: string, categoryName: string, month: string, dateRange?: { from: string; to: string }) {
    setDrillDown({ categoryId, categoryName, month, dateRange })
    setDrillDownData(null)
    startDrillTransition(async () => {
      const result = await getDreDrillDown(categoryId, month, {
        costCenterIds:   selCc.length ? selCc : undefined,
        businessUnitIds: selBu.length ? selBu : undefined,
        legalEntityIds:  selLe.length ? selLe : undefined,
      }, dateRange)
      setDrillDownData(result.transactions)
    })
  }

  function closeDrillDown() {
    setDrillDown(null)
    setDrillDownData(null)
  }

  // Constrói árvore pai → filho a partir dos rows planos
  const parentNodes = useMemo<ParentNode[]>(() => {
    const map = new Map<string, { pNode: Omit<ParentNode, 'children' | 'byMonth' | 'total'>; childMap: Map<string, ChildNode> }>()

    data.rows.forEach((row: FluxoMensalCategoryRow) => {
      if (!map.has(row.parentId)) {
        map.set(row.parentId, {
          pNode:    { parentId: row.parentId, parentName: row.parentName, parentCode: row.parentCode, opexCapex: row.parentOpexCapex },
          childMap: new Map(),
        })
      }
      const entry = map.get(row.parentId)!
      if (!entry.childMap.has(row.categoryId)) {
        entry.childMap.set(row.categoryId, {
          categoryId:   row.categoryId,
          categoryName: row.categoryName,
          categoryCode: row.categoryCode,
          byMonth:      {},
          total:        0,
        })
      }
      const child = entry.childMap.get(row.categoryId)!
      child.byMonth[row.month] = (child.byMonth[row.month] ?? 0) + row.netAmount
    })

    return Array.from(map.values())
      .sort((a, b) => a.pNode.parentCode.localeCompare(b.pNode.parentCode))
      .map(({ pNode, childMap }) => {
        const children = Array.from(childMap.values())
          .sort((a, b) => a.categoryCode.localeCompare(b.categoryCode))
          .map(c => ({ ...c, total: Object.values(c.byMonth).reduce((s, v) => s + v, 0) }))

        const byMonth: Record<string, number> = {}
        children.forEach(child => {
          Object.entries(child.byMonth).forEach(([m, v]) => {
            byMonth[m] = (byMonth[m] ?? 0) + v
          })
        })
        const total = Object.values(byMonth).reduce((s, v) => s + v, 0)

        return { ...pNode, byMonth, total, children }
      })
  }, [data.rows])

  // Total líquido por mês (todas as categorias)
  const totalByMonth = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    data.rows.forEach(r => {
      map[r.month] = (map[r.month] ?? 0) + r.netAmount
    })
    return map
  }, [data.rows])

  const grandTotal = useMemo(
    () => data.months.reduce((s, m) => s + (totalByMonth[m] ?? 0), 0),
    [data.months, totalByMonth],
  )

  const opexParents  = useMemo(() => parentNodes.filter(p => p.opexCapex !== 'capex'), [parentNodes])
  const capexParents = useMemo(() => parentNodes.filter(p => p.opexCapex === 'capex'), [parentNodes])

  const totalOpexByMonth = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    opexParents.forEach(p => {
      Object.entries(p.byMonth).forEach(([m, v]) => { map[m] = (map[m] ?? 0) + v })
    })
    return map
  }, [opexParents])

  const totalCapexByMonth = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    capexParents.forEach(p => {
      Object.entries(p.byMonth).forEach(([m, v]) => { map[m] = (map[m] ?? 0) + v })
    })
    return map
  }, [capexParents])

  const opexTotal  = useMemo(() => data.months.reduce((s, m) => s + (totalOpexByMonth[m] ?? 0), 0), [data.months, totalOpexByMonth])
  const capexTotal = useMemo(() => data.months.reduce((s, m) => s + (totalCapexByMonth[m] ?? 0), 0), [data.months, totalCapexByMonth])

  const hasDimFilters = selCc.length > 0 || selBu.length > 0 || selLe.length > 0
  const { months } = data

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between mb-3">
          <CardTitle className="text-base font-semibold">Geração de Caixa por Categoria</CardTitle>
          <div className="flex items-center gap-2">
            {parentNodes.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground gap-1.5"
                onClick={() => {
                  const allCollapsed = parentNodes.every(p => collapsedParents.has(p.parentId))
                  setCollapsedParents(allCollapsed ? new Set() : new Set(parentNodes.map(p => p.parentId)))
                }}
              >
                <ChevronsUpDown className="h-3 w-3" />
                {parentNodes.every(p => collapsedParents.has(p.parentId)) ? 'Expandir todos' : 'Recolher todos'}
              </Button>
            )}
            {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {/* Filtros */}
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
      </CardHeader>

      <CardContent className="p-0">
        {data.rows.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <EmptyState
              icon={<BarChart3 className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
              title="Sem dados para o período"
              description="Categorize suas transações para que o expert monte o demonstrativo automaticamente."
            />
          </div>
        ) : (
          <div className={cn('overflow-auto max-h-[520px]', isPending && 'opacity-50 pointer-events-none')}>
            <table
              className="border-collapse"
              style={{ minWidth: LABEL_W + months.length * COL_W + TOTAL_COL_W, width: '100%' }}
            >
              <colgroup>
                <col style={{ width: LABEL_W, minWidth: LABEL_W }} />
                {months.map(m => <col key={m} style={{ width: COL_W, minWidth: COL_W }} />)}
                <col style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }} />
              </colgroup>

              <thead className="sticky top-0 z-20">
                <tr className="bg-slate-800">
                  <th className="text-left text-xs font-medium text-slate-200 px-4 py-2.5 rounded-tl-sm">
                    Natureza
                  </th>
                  {months.map(m => (
                    <th key={m} className="text-right text-xs font-medium text-slate-200 px-3 py-2.5 whitespace-nowrap">
                      {monthLabel(m)}
                    </th>
                  ))}
                  <th className="text-right text-xs font-medium text-slate-300/70 px-3 py-2.5 whitespace-nowrap border-l border-slate-600 rounded-tr-sm">
                    Total
                  </th>
                </tr>
              </thead>

              <tbody>
                {/* OPEX */}
                {opexParents.map(parent => {
                  const collapsed = collapsedParents.has(parent.parentId)
                  return (
                    <Fragment key={parent.parentId}>
                      <tr className="bg-slate-50 border-y border-slate-100 hover:bg-slate-100/80">
                        <td className="sticky left-0 bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-700">
                          <button
                            className="flex items-center gap-1 text-left hover:text-slate-900"
                            onClick={() => toggleParent(parent.parentId)}
                          >
                            {collapsed
                              ? <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
                              : <ChevronDown  className="h-3 w-3 shrink-0 text-slate-400" />
                            }
                            <span className="truncate">{parent.parentName}</span>
                          </button>
                        </td>
                        {months.map(m => (
                          <Num key={m} value={parent.byMonth[m] ?? 0} bold />
                        ))}
                        <Num value={parent.total} bold />
                      </tr>
                      {!collapsed && parent.children.map(child => (
                        <tr key={child.categoryId} className="hover:bg-muted/30 border-b border-border/30">
                          <td className="sticky left-0 bg-background px-4 py-1 text-xs text-foreground pl-10">
                            <span className="truncate block">{child.categoryName}</span>
                          </td>
                          {months.map(m => (
                            <Num
                              key={m}
                              value={child.byMonth[m] ?? 0}
                              onClick={() => openDrillDown(child.categoryId, child.categoryName, m)}
                            />
                          ))}
                          <Num
                            value={child.total}
                            onClick={() => openDrillDown(child.categoryId, child.categoryName, '', { from: currentFrom, to: currentTo })}
                          />
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}

                {/* Total OPEX */}
                {opexParents.length > 0 && (
                  <tr className="bg-slate-100 border-t-2 border-slate-300">
                    <td className="sticky left-0 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700">
                      Total OPEX
                    </td>
                    {months.map(m => (
                      <Num key={m} value={totalOpexByMonth[m] ?? 0} bold />
                    ))}
                    <Num value={opexTotal} bold />
                  </tr>
                )}

                {/* Separador entre OPEX e CAPEX */}
                {opexParents.length > 0 && capexParents.length > 0 && (
                  <tr>
                    <td colSpan={months.length + 2} className="p-0">
                      <div className="border-t-2 border-dashed border-slate-300/60" />
                    </td>
                  </tr>
                )}

                {/* CAPEX */}
                {capexParents.map(parent => {
                  const collapsed = collapsedParents.has(parent.parentId)
                  return (
                    <Fragment key={parent.parentId}>
                      <tr className="bg-slate-50 border-y border-slate-100 hover:bg-slate-100/80">
                        <td className="sticky left-0 bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-700">
                          <button
                            className="flex items-center gap-1 text-left hover:text-slate-900"
                            onClick={() => toggleParent(parent.parentId)}
                          >
                            {collapsed
                              ? <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
                              : <ChevronDown  className="h-3 w-3 shrink-0 text-slate-400" />
                            }
                            <span className="truncate">{parent.parentName}</span>
                          </button>
                        </td>
                        {months.map(m => (
                          <Num key={m} value={parent.byMonth[m] ?? 0} bold />
                        ))}
                        <Num value={parent.total} bold />
                      </tr>
                      {!collapsed && parent.children.map(child => (
                        <tr key={child.categoryId} className="hover:bg-muted/30 border-b border-border/30">
                          <td className="sticky left-0 bg-background px-4 py-1 text-xs text-foreground pl-10">
                            <span className="truncate block">{child.categoryName}</span>
                          </td>
                          {months.map(m => (
                            <Num
                              key={m}
                              value={child.byMonth[m] ?? 0}
                              onClick={() => openDrillDown(child.categoryId, child.categoryName, m)}
                            />
                          ))}
                          <Num
                            value={child.total}
                            onClick={() => openDrillDown(child.categoryId, child.categoryName, '', { from: currentFrom, to: currentTo })}
                          />
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}

                {/* Total CAPEX */}
                {capexParents.length > 0 && (
                  <tr className="bg-slate-100 border-t-2 border-slate-300">
                    <td className="sticky left-0 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700">
                      Total CAPEX
                    </td>
                    {months.map(m => (
                      <Num key={m} value={totalCapexByMonth[m] ?? 0} bold />
                    ))}
                    <Num value={capexTotal} bold />
                  </tr>
                )}

                {/* Separador antes do Total líquido */}
                <tr>
                  <td colSpan={months.length + 2} className="p-0">
                    <div className="border-t-2 border-dashed border-slate-300/60" />
                  </td>
                </tr>

                {/* Total líquido */}
                <tr className="bg-slate-800 border-t-2 border-slate-600">
                  <td className="sticky left-0 bg-slate-800 px-4 py-2 text-xs font-semibold text-white">
                    Total líquido
                  </td>
                  {months.map(m => (
                    <Num key={m} value={totalByMonth[m] ?? 0} bold inverted />
                  ))}
                  <Num value={grandTotal} bold inverted />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {drillDown && (
        <DrillDownDialog
          open
          onOpenChange={o => { if (!o) closeDrillDown() }}
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
    </Card>
  )
}

// ─── FluxoClient ──────────────────────────────────────────────────────────────
// O tooltip do gráfico mudou de casa na 5.A: é o padrão de
// `@/components/charts`, com o rótulo vindo da declaração da série.

interface FluxoClientProps {
  data:           FluxoData
  initialMensal:  FluxoMensalData
  initialFrom:    string
  initialTo:      string
  costCenters:    CostCenter[]
  businessUnits:  BusinessUnit[]
  legalEntities:  LegalEntity[]
  leafCategories: LeafCategory[]
  contactOptions: SimpleDimensionItem[]
}

export function FluxoClient({
  data, initialMensal, initialFrom, initialTo,
  costCenters, businessUnits, legalEntities, leafCategories, contactOptions,
}: FluxoClientProps) {
  const hasHistorico  = data.semanas.some(s => s.inflowReal > 0 || s.outflowReal > 0)
  const hasProjecao   = data.recorrencias.length > 0

  const chartData = useMemo(() => data.semanas, [data.semanas])

  return (
    <div className="space-y-6">
      {/* Nova seção: Geração de Caixa por Categoria */}
      <FluxoCaixaCategoria
        initialData={initialMensal}
        initialFrom={initialFrom}
        initialTo={initialTo}
        costCenters={costCenters}
        businessUnits={businessUnits}
        legalEntities={legalEntities}
        leafCategories={leafCategories}
        contactOptions={contactOptions}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPICard label="Saldo Atual"          value={data.saldoAtual}        colorizeValue />
        <KPICard label="Saldo Projetado 30d"  value={data.saldoProjetado30d} colorizeValue />
        <KPICard label="Saldo Projetado 60d"  value={data.saldoProjetado60d} colorizeValue />
        <KPICard label="Saldo Projetado 90d"  value={data.saldoProjetado90d} colorizeValue />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">
            Histórico (60d) e projeção (90d)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasHistorico && !hasProjecao ? (
            <EmptyState
              icon={<TrendingUp className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
              title="Sem dados de fluxo"
              description="Conecte seu banco ou importe um extrato para visualizar o fluxo de caixa."
            />
          ) : (
            <>
              <BarChart
                data={chartData}
                x="label"
                ocultarZerosNoTooltip
                series={[
                  { key: 'inflowReal',       label: 'Entradas',         cor: COR_ENTRADA,           stackId: 'in' },
                  { key: 'inflowProjetado',  label: 'Entradas (proj.)', cor: COR_ENTRADA_PROJETADA, stackId: 'in' },
                  { key: 'outflowReal',      label: 'Saídas',           cor: COR_SAIDA,             stackId: 'out' },
                  { key: 'outflowProjetado', label: 'Saídas (proj.)',   cor: COR_SAIDA_PROJETADA,   stackId: 'out' },
                ]}
              />
              <p className="text-xs text-muted-foreground/70 mt-2 text-center">
                Cores escuras = histórico real · cores claras = projeção baseada em recorrências
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Recorrências detectadas</CardTitle>
          {hasProjecao && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Transações que se repetem nos últimos 6 meses — base da projeção
            </p>
          )}
        </CardHeader>
        <CardContent>
          {!hasProjecao ? (
            <p className="text-sm text-muted-foreground py-2">
              Nenhuma recorrência detectada nos últimos 6 meses. Importe mais transações para habilitar a projeção.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs text-muted-foreground font-medium pb-2 pr-4">Descrição</th>
                    <th className="text-left text-xs text-muted-foreground font-medium pb-2 pr-4">Tipo</th>
                    <th className="text-right text-xs text-muted-foreground font-medium pb-2 pr-4">Valor médio</th>
                    <th className="text-right text-xs text-muted-foreground font-medium pb-2 pr-4">Próxima data</th>
                    <th className="text-right text-xs text-muted-foreground font-medium pb-2">Intervalo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.recorrencias.map((rec, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="py-2.5 pr-4 max-w-[220px]">
                        <span className="truncate block text-foreground text-sm">{rec.descricao}</span>
                        <span className="text-xs text-muted-foreground">{rec.ocorrencias}× nos últimos 6 meses</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          rec.direction === 'inflow'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-500',
                        )}>
                          {rec.direction === 'inflow' ? 'Entrada' : 'Saída'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums font-medium">
                        {brl.format(rec.valorMedio)}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                        {format(parseISO(rec.proximaData), 'dd/MM/yyyy', { locale: ptBR })}
                      </td>
                      <td className="py-2.5 text-right text-muted-foreground">
                        ~{rec.intervaloMedioDias}d
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
