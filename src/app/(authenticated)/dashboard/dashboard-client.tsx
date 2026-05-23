'use client'

import { useMemo, useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { KPICard } from '@/components/financial/kpi-card'
import { EmptyState } from '@/components/states/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardKPIs, CashFlowDay, FinancialIndicators, TopExpenseCategory } from '@/server/dashboard'
import { getDashboardCategoryDrillDown } from '@/server/dashboard'
import { format, parseISO, startOfWeek } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { BarChart2, TrendingUp, Droplets, ShieldCheck, Activity, Scale, Clock, Wallet, HelpCircle, PieChart, Loader2, AlertTriangle, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DrillDownDialog } from '@/components/transacoes-shared/drill-down-dialog'
import type { DrillDownTransaction, LeafCategory } from '@/lib/dre-types'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'

type DashboardAlert = {
  id:       string
  severity: 'critical' | 'warning'
  message:  string
  action?:  { label: string; href: string }
}

function AlertsSection({
  alerts,
  dismissedIds,
  onDismiss,
}: {
  alerts:       DashboardAlert[]
  dismissedIds: string[]
  onDismiss:    (id: string) => void
}) {
  const visible = alerts.filter(a => !dismissedIds.includes(a.id))
  if (visible.length === 0) return null

  return (
    <div className="space-y-2">
      {visible.map(alert => (
        <div
          key={alert.id}
          className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${
            alert.severity === 'critical'
              ? 'border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30'
              : 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30'
          }`}
        >
          <AlertTriangle
            className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
              alert.severity === 'critical' ? 'text-rose-600' : 'text-amber-600'
            }`}
            strokeWidth={1.75}
          />
          <p className={`flex-1 leading-snug ${
            alert.severity === 'critical'
              ? 'text-rose-800 dark:text-rose-200'
              : 'text-amber-800 dark:text-amber-200'
          }`}>
            {alert.message}
          </p>
          <div className="flex items-center gap-3 flex-shrink-0">
            {alert.action && (
              <Link
                href={alert.action.href}
                className="text-xs underline underline-offset-2 hover:no-underline text-muted-foreground"
              >
                {alert.action.label}
              </Link>
            )}
            <button
              type="button"
              onClick={() => onDismiss(alert.id)}
              aria-label="Dispensar alerta"
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

type WeekData = { label: string; inflow: number; outflow: number }

function groupByWeek(days: CashFlowDay[]): WeekData[] {
  const map = new Map<string, WeekData>()

  for (const day of days) {
    const date      = parseISO(day.date)
    const weekStart = startOfWeek(date, { weekStartsOn: 1 })
    const key       = format(weekStart, 'yyyy-MM-dd')
    const existing  = map.get(key)
    if (existing) {
      existing.inflow  += day.inflow
      existing.outflow += day.outflow
    } else {
      map.set(key, {
        label:   format(weekStart, "d/MM", { locale: ptBR }),
        inflow:  day.inflow,
        outflow: day.outflow,
      })
    }
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
}

function yFormatter(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `R$ ${(value / 1_000).toFixed(0)}k`
  return `R$ ${value.toFixed(0)}`
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-background border border-border rounded-md shadow-md px-3 py-2 text-sm">
      <p className="font-medium text-foreground mb-1.5">{label}</p>
      {payload.map(entry => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-muted-foreground">
            {entry.name === 'inflow' ? 'Entradas' : 'Saídas'}:
          </span>
          <span className="font-medium tabular-nums" style={{ color: entry.color }}>
            {brl.format(entry.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function legendFormatter(value: string): string {
  return value === 'inflow' ? 'Entradas' : 'Saídas'
}

type IndicatorStatus = 'good' | 'warn' | 'bad' | 'neutral'

function indicatorStatus(value: number | null, good: number, warn: number): IndicatorStatus {
  if (value === null) return 'neutral'
  if (value >= good) return 'good'
  if (value >= warn) return 'warn'
  return 'bad'
}

// Para indicadores onde "menor é melhor" (ex: Endividamento Geral).
function indicatorStatusInverse(value: number | null, goodMax: number, warnMax: number): IndicatorStatus {
  if (value === null) return 'neutral'
  if (value <= goodMax) return 'good'
  if (value <= warnMax) return 'warn'
  return 'bad'
}

const statusColor: Record<IndicatorStatus, string> = {
  good:    'bg-emerald-500',
  warn:    'bg-amber-500',
  bad:     'bg-rose-600',
  neutral: 'bg-muted-foreground/40',
}

const statusText: Record<IndicatorStatus, string> = {
  good:    'text-emerald-700 dark:text-emerald-400',
  warn:    'text-amber-600 dark:text-amber-400',
  bad:     'text-rose-600',
  neutral: 'text-muted-foreground',
}

interface IndicatorExplanation {
  formula:        string
  description:    string
  interpretation: string
}

interface IndicatorItemProps {
  icon:         React.ReactNode
  label:        string
  value:        number | null
  format:       (v: number) => string
  status:       IndicatorStatus
  hint:         string
  explanation?: IndicatorExplanation
}

function IndicatorItem({ icon, label, value, format: fmt, status, hint, explanation }: IndicatorItemProps) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          {explanation && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`Como é calculado: ${label}`}
                  className="text-muted-foreground/60 hover:text-muted-foreground transition-colors focus:outline-none focus-visible:text-muted-foreground"
                >
                  <HelpCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 text-sm">
                <p className="font-semibold text-foreground mb-2">{label}</p>
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1">Fórmula</p>
                    <p className="rounded bg-muted/40 px-2 py-1.5 font-mono text-xs text-foreground">{explanation.formula}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1">O que é</p>
                    <p className="text-xs text-foreground/80 leading-relaxed">{explanation.description}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1">Como interpretar</p>
                    <p className="text-xs text-foreground/80 leading-relaxed">{explanation.interpretation}</p>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <p className={`text-lg font-semibold tabular-nums leading-tight ${statusText[status]}`}>
          {value !== null ? fmt(value) : '—'}
        </p>
        <p className="text-xs text-muted-foreground/70 mt-0.5">{hint}</p>
      </div>
      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${statusColor[status]}`} />
    </div>
  )
}

interface DashboardClientProps {
  kpis:           DashboardKPIs
  cashFlow:       CashFlowDay[]
  indicators:     FinancialIndicators
  topExpenses:    TopExpenseCategory[]
  monthRange:     { from: string; to: string; label: string }
  selectedMonth:  string   // 'YYYY-MM'
  leafCategories: LeafCategory[]
  costCenters:    CostCenter[]
  businessUnits:  BusinessUnit[]
  legalEntities:  LegalEntity[]
}

interface DrillState {
  title:    string
  subtitle: string
  categoryIds: string[]
  dateRange:   { from: string; to: string }
}

export function DashboardClient({
  kpis, cashFlow, indicators,
  topExpenses, monthRange, selectedMonth, leafCategories, costCenters, businessUnits, legalEntities,
}: DashboardClientProps) {
  const router = useRouter()
  const [isNavPending, startNavTransition] = useTransition()
  const weeklyData  = useMemo(() => groupByWeek(cashFlow), [cashFlow])
  const hasChart    = cashFlow.length > 0

  const [drill, setDrill] = useState<DrillState | null>(null)
  const [drillData, setDrillData] = useState<DrillDownTransaction[] | null>(null)
  const [isDrillLoading, startDrillTransition] = useTransition()

  // Alertas — dismissal persistido por mês no localStorage
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`lure:dashboard:dismissed-alerts:${selectedMonth}`)
      setDismissedIds(stored ? (JSON.parse(stored) as string[]) : [])
    } catch { setDismissedIds([]) }
  }, [selectedMonth])

  function dismissAlert(id: string) {
    setDismissedIds(prev => {
      const next = [...prev, id]
      try { localStorage.setItem(`lure:dashboard:dismissed-alerts:${selectedMonth}`, JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }

  function handleMonthChange(newMonth: string) {
    if (!newMonth || !/^\d{4}-\d{2}$/.test(newMonth)) return
    startNavTransition(() => {
      router.push(`/dashboard?month=${newMonth}`)
    })
  }

  function openCategoryDrill(cat: TopExpenseCategory) {
    const title = cat.categoryCode ? `${cat.categoryCode} – ${cat.categoryName}` : cat.categoryName
    const subtitleParts = [monthRange.label]
    if (cat.parentName) subtitleParts.unshift(cat.parentName)
    setDrill({
      title,
      subtitle:    subtitleParts.join(' · '),
      categoryIds: [cat.categoryId],
      dateRange:   { from: monthRange.from, to: monthRange.to },
    })
    setDrillData(null)
    startDrillTransition(async () => {
      const result = await getDashboardCategoryDrillDown([cat.categoryId], { from: monthRange.from, to: monthRange.to })
      setDrillData(result.transactions)
    })
  }

  function closeDrill() {
    setDrill(null)
    setDrillData(null)
  }

  const maxTopExpense = topExpenses.length > 0 ? Math.max(...topExpenses.map(c => c.total)) : 0
  const totalTopExpenses = topExpenses.reduce((s, c) => s + c.total, 0)

  const ebitdaStatus       = indicatorStatus(indicators.margemEbitda,           15, 5)
  const liquidezStatus     = indicatorStatus(indicators.liquidezCorrente,        1.5, 1.0)
  const liquidezSecaStatus = indicatorStatus(indicators.liquidezSeca,            1.0, 0.7)
  const dcsrStatus         = indicatorStatus(indicators.coberturaServicoDivida,  1.5, 1.0)
  const endividStatus      = indicatorStatusInverse(indicators.endividamentoGeral, 0.5, 0.7)
  const roeStatus          = indicatorStatus(indicators.roe,                    15, 8)

  const alerts = useMemo<DashboardAlert[]>(() => {
    if (!kpis.hasData) return []
    const result: DashboardAlert[] = []

    // Saldo em caixa negativo
    if (kpis.saldoCaixa < 0) {
      result.push({
        id: 'saldo-negativo',
        severity: 'critical',
        message: `Saldo em caixa negativo (${brl.format(kpis.saldoCaixa)}).`,
        action: { label: 'Ver transações', href: '/transacoes' },
      })
    }

    // Resultado líquido negativo
    if (kpis.lucroLiquido.current < 0) {
      result.push({
        id: 'lucro-negativo',
        severity: 'warning',
        message: `Resultado líquido do mês negativo (${brl.format(kpis.lucroLiquido.current)}).`,
        action: { label: 'Ver DRE', href: '/dre' },
      })
    }

    // Despesas crescendo muito
    if (kpis.despesas.delta !== null && kpis.despesas.delta > 30) {
      result.push({
        id: 'despesas-alta',
        severity: kpis.despesas.delta > 50 ? 'critical' : 'warning',
        message: `Despesas cresceram ${kpis.despesas.delta.toFixed(0)}% em relação ao mês anterior.`,
        action: { label: 'Analisar', href: '/transacoes' },
      })
    }

    // Receita caindo muito
    if (kpis.receita.delta !== null && kpis.receita.delta < -20) {
      result.push({
        id: 'receita-queda',
        severity: kpis.receita.delta < -40 ? 'critical' : 'warning',
        message: `Receita caiu ${Math.abs(kpis.receita.delta).toFixed(0)}% em relação ao mês anterior.`,
        action: { label: 'Ver DRE', href: '/dre' },
      })
    }

    // Margem EBITDA crítica
    if (ebitdaStatus === 'bad' && indicators.margemEbitda !== null) {
      result.push({
        id: 'ebitda-baixo',
        severity: indicators.margemEbitda < 0 ? 'critical' : 'warning',
        message: `Margem EBITDA em ${indicators.margemEbitda.toFixed(1)}% — abaixo do mínimo recomendável de 5%.`,
        action: { label: 'Ver DRE', href: '/dre' },
      })
    }

    // Cobertura do serviço da dívida insuficiente
    if (dcsrStatus === 'bad' && indicators.coberturaServicoDivida !== null) {
      result.push({
        id: 'cobertura-divida',
        severity: 'critical',
        message: `Cobertura do serviço da dívida em ${indicators.coberturaServicoDivida.toFixed(2)}x — resultado operacional não cobre os empréstimos do mês.`,
        action: { label: 'Ver DRE', href: '/dre' },
      })
    }

    // Liquidez corrente crítica
    if (liquidezStatus === 'bad' && indicators.liquidezCorrente !== null) {
      result.push({
        id: 'liquidez-corrente',
        severity: 'critical',
        message: `Liquidez Corrente em ${indicators.liquidezCorrente.toFixed(2)}x — ativo circulante insuficiente para cobrir o passivo de curto prazo.`,
        action: { label: 'Ver Balanço', href: '/balanco' },
      })
    }

    // Endividamento elevado
    if (endividStatus === 'bad' && indicators.endividamentoGeral !== null) {
      result.push({
        id: 'endividamento',
        severity: 'warning',
        message: `Endividamento Geral em ${(indicators.endividamentoGeral * 100).toFixed(1)}% — alavancagem acima do limite recomendável.`,
        action: { label: 'Ver Balanço', href: '/balanco' },
      })
    }

    return result
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))
      .slice(0, 6)
  }, [kpis, indicators, ebitdaStatus, dcsrStatus, liquidezStatus, endividStatus])

  const allNull = indicators.margemEbitda           === null
    && indicators.liquidezCorrente        === null
    && indicators.liquidezSeca            === null
    && indicators.coberturaServicoDivida  === null
    && indicators.endividamentoGeral      === null
    && indicators.roe                     === null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <label htmlFor="dashboard-month" className="text-xs text-muted-foreground">
          Mês de referência
        </label>
        <input
          id="dashboard-month"
          type="month"
          value={selectedMonth}
          onChange={e => handleMonthChange(e.target.value)}
          disabled={isNavPending}
          className="h-8 rounded-md border border-input px-2 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        />
        {isNavPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPICard
          label="Receita do Mês"
          value={kpis.receita.current}
          delta={kpis.receita.delta ?? undefined}
        />
        <KPICard
          label="Despesas"
          value={kpis.despesas.current}
          colorizeValue
          delta={kpis.despesas.delta !== null ? -kpis.despesas.delta : undefined}
        />
        <KPICard
          label="Lucro Líquido"
          value={kpis.lucroLiquido.current}
          colorizeValue
          delta={kpis.lucroLiquido.delta ?? undefined}
        />
        <KPICard
          label="Saldo em Caixa"
          value={kpis.saldoCaixa}
          colorizeValue
        />
      </div>

      <AlertsSection alerts={alerts} dismissedIds={dismissedIds} onDismiss={dismissAlert} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold capitalize">
            Fluxo de Caixa — 90 dias até {monthRange.label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasChart ? (
            <EmptyState
              icon={<BarChart2 className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
              title="Sem movimentações no período"
              description="As movimentações dos últimos 90 dias aparecerão aqui assim que houver transações confirmadas."
            />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={weeklyData} barCategoryGap="35%" barGap={2}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="hsl(var(--border))"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={yFormatter}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  width={72}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }}
                />
                <Legend formatter={legendFormatter} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="inflow"  name="inflow"  fill="#059669" radius={[3, 3, 0, 0]} />
                <Bar dataKey="outflow" name="outflow" fill="#e11d48" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold capitalize">
            Top 5 Categorias de Despesa — {monthRange.label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topExpenses.length === 0 ? (
            <EmptyState
              icon={<PieChart className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
              title="Sem despesas classificadas no mês"
              description="Classifique as transações para ver as categorias com maior peso aqui."
            />
          ) : (
            <div className="space-y-2">
              {topExpenses.map(cat => {
                const pctOfTotal = totalTopExpenses > 0 ? (cat.total / totalTopExpenses) * 100 : 0
                const barPct     = maxTopExpense > 0 ? (cat.total / maxTopExpense) * 100 : 0
                return (
                  <button
                    key={cat.categoryId}
                    onClick={() => openCategoryDrill(cat)}
                    className="w-full group flex items-center gap-3 py-1.5 px-2 -mx-2 rounded hover:bg-muted/40 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground/90 truncate">
                        {cat.categoryCode && <span className="text-muted-foreground mr-1.5">{cat.categoryCode}</span>}
                        {cat.categoryName}
                      </div>
                      {cat.parentName && (
                        <div className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
                          {cat.parentName}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 max-w-[40%] h-2 rounded-full bg-muted overflow-hidden shrink-0">
                      <div
                        className="h-full bg-rose-500 group-hover:bg-rose-600 transition-colors rounded-full"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-foreground w-28 text-right shrink-0">
                      {brl.format(cat.total)}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground w-12 text-right shrink-0">
                      {pctOfTotal.toFixed(0)}%
                    </span>
                  </button>
                )
              })}
              <p className="text-xs text-muted-foreground/70 pt-2 border-t border-border/40">
                Percentual relativo ao total das 5 categorias listadas. Clique numa linha para ver as transações.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold capitalize">
            Indicadores Financeiros — {monthRange.label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {allNull ? (
            <p className="text-sm text-muted-foreground py-2">
              Sem dados suficientes para calcular indicadores. Classifique as transações do mês.
            </p>
          ) : (
            <div className="divide-y divide-border">
              <IndicatorItem
                icon={<TrendingUp className="h-4 w-4" strokeWidth={1.5} />}
                label="Margem EBITDA"
                value={indicators.margemEbitda}
                format={v => `${v.toFixed(1)}%`}
                status={ebitdaStatus}
                hint="Referência saudável: acima de 15%"
                explanation={{
                  formula:        'EBITDA ÷ Receita Bruta × 100',
                  description:    'Quanto da receita sobra após as despesas operacionais, antes de juros, impostos, depreciação e amortização.',
                  interpretation: 'Acima de 15% é considerado saudável. Abaixo de 5% indica margem muito apertada.',
                }}
              />
              <IndicatorItem
                icon={<Droplets className="h-4 w-4" strokeWidth={1.5} />}
                label="Liquidez Corrente"
                value={indicators.liquidezCorrente}
                format={v => `${v.toFixed(2)}x`}
                status={liquidezStatus}
                hint={indicators.liquidezCorrente === null ? 'Requer lançamentos de Balanço Patrimonial' : 'Referência saudável: acima de 1,5x'}
                explanation={{
                  formula:        'Ativo Circulante ÷ Passivo Circulante',
                  description:    'Quantas vezes os ativos de curto prazo cobrem as dívidas de curto prazo.',
                  interpretation: 'Acima de 1,5x indica folga. Abaixo de 1,0x pode haver dificuldade para honrar compromissos imediatos.',
                }}
              />
              <IndicatorItem
                icon={<Activity className="h-4 w-4" strokeWidth={1.5} />}
                label="Liquidez Seca"
                value={indicators.liquidezSeca}
                format={v => `${v.toFixed(2)}x`}
                status={liquidezSecaStatus}
                hint={indicators.liquidezSeca === null ? 'Requer Balanço Patrimonial' : 'Ativo Circulante menos estoque ÷ Passivo Circulante. Referência: acima de 1,0x'}
                explanation={{
                  formula:        '(Ativo Circulante − Estoque) ÷ Passivo Circulante',
                  description:    "Versão conservadora da Liquidez Corrente — exclui estoque, que nem sempre vira caixa rapidamente. Estoque é identificado por categorias com 'estoque' no nome.",
                  interpretation: 'Acima de 1,0x indica que, mesmo sem vender estoque, a empresa cobre o passivo de curto prazo.',
                }}
              />
              <IndicatorItem
                icon={<Scale className="h-4 w-4" strokeWidth={1.5} />}
                label="Endividamento Geral"
                value={indicators.endividamentoGeral !== null ? indicators.endividamentoGeral * 100 : null}
                format={v => `${v.toFixed(1)}%`}
                status={endividStatus}
                hint={indicators.endividamentoGeral === null ? 'Requer Balanço Patrimonial' : 'Passivo total ÷ Ativo total. Referência: abaixo de 50%'}
                explanation={{
                  formula:        '(Passivo Circ. + Passivo Não-Circ.) ÷ (Ativo Circ. + Ativo Não-Circ.) × 100',
                  description:    'Fatia da empresa financiada por capital de terceiros.',
                  interpretation: 'Abaixo de 50% é conservador. Acima de 70% indica alavancagem alta.',
                }}
              />
              <IndicatorItem
                icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.5} />}
                label="Cobertura do Serviço da Dívida"
                value={indicators.coberturaServicoDivida}
                format={v => `${v.toFixed(2)}x`}
                status={dcsrStatus}
                hint={indicators.coberturaServicoDivida === null ? 'Sem amortizações no mês' : 'Referência saudável: acima de 1,5x'}
                explanation={{
                  formula:        'EBITDA do mês ÷ Pagamentos de Empréstimos no mês',
                  description:    "Mede se o resultado operacional do mês cobre os pagamentos de principal e juros. Considera saídas classificadas em 'Empréstimos e Amortizações'.",
                  interpretation: 'Acima de 1,5x é confortável. Abaixo de 1,0x o operacional não cobre o serviço da dívida.',
                }}
              />
              <IndicatorItem
                icon={<Wallet className="h-4 w-4" strokeWidth={1.5} />}
                label="ROE — Retorno sobre Patrimônio"
                value={indicators.roe}
                format={v => `${v.toFixed(1)}% a.a.`}
                status={roeStatus}
                hint={
                  indicators.roe === null
                    ? 'Requer Balanço Patrimonial com Patrimônio Líquido positivo'
                    : indicators.meses12mDisponiveis < 12
                      ? `Anualizado a partir de ${indicators.meses12mDisponiveis} ${indicators.meses12mDisponiveis === 1 ? 'mês' : 'meses'} de dados. Referência: acima de 15% a.a.`
                      : 'Lucro 12m ÷ Patrimônio Líquido. Referência: acima de 15% a.a.'
                }
                explanation={{
                  formula:        'Lucro Líquido (12m anualizado) ÷ Patrimônio Líquido × 100',
                  description:    'Rentabilidade do capital próprio. Lucro dos últimos 12 meses anualizado proporcionalmente quando há menos de 12 meses de dados. Patrimônio Líquido vem de lançamentos diretos ou, na ausência, da identidade Ativo − Passivo.',
                  interpretation: 'Acima de 15% ao ano é bom. Abaixo de 8% sugere baixa rentabilidade do capital investido.',
                }}
              />
              <IndicatorItem
                icon={<Clock className="h-4 w-4" strokeWidth={1.5} />}
                label="Ciclo Financeiro"
                value={indicators.cicloFinanceiro}
                format={v => `${v.toFixed(0)} dias`}
                status="neutral"
                hint="Requer estrutura de Contas a Receber e Contas a Pagar (Fase futura)"
                explanation={{
                  formula:        'PMR + PME − PMP (em dias)',
                  description:    'Soma dos prazos médios de recebimento (PMR) e estoque (PME), menos o prazo médio de pagamento (PMP). Mede quantos dias o caixa fica preso entre comprar e receber.',
                  interpretation: 'Quanto menor, melhor. Indicador será habilitado quando o produto suportar Contas a Receber e a Pagar estruturados.',
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {drill && (
        <DrillDownDialog
          open
          onOpenChange={(o) => { if (!o) closeDrill() }}
          title={drill.title}
          subtitle={drill.subtitle}
          data={drillData}
          loading={isDrillLoading}
          onDataChange={setDrillData}
          leafCategories={leafCategories}
          costCenters={costCenters}
          businessUnits={businessUnits}
          legalEntities={legalEntities}
        />
      )}
    </div>
  )
}
