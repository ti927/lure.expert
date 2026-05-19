'use client'

import { useMemo } from 'react'
import { KPICard } from '@/components/financial/kpi-card'
import { EmptyState } from '@/components/states/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardKPIs, CashFlowDay, FinancialIndicators } from '@/server/dashboard'
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
import { BarChart2, TrendingUp, Droplets, ShieldCheck } from 'lucide-react'

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

interface IndicatorItemProps {
  icon: React.ReactNode
  label: string
  value: number | null
  format: (v: number) => string
  status: IndicatorStatus
  hint: string
}

function IndicatorItem({ icon, label, value, format: fmt, status, hint }: IndicatorItemProps) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
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
  kpis: DashboardKPIs
  cashFlow: CashFlowDay[]
  indicators: FinancialIndicators
}

export function DashboardClient({ kpis, cashFlow, indicators }: DashboardClientProps) {
  const weeklyData  = useMemo(() => groupByWeek(cashFlow), [cashFlow])
  const hasChart    = cashFlow.length > 0

  const ebitdaStatus   = indicatorStatus(indicators.margemEbitda,           15, 5)
  const liquidezStatus = indicatorStatus(indicators.liquidezCorrente,        1.5, 1.0)
  const dcsrStatus     = indicatorStatus(indicators.coberturaServicoDivida,  1.5, 1.0)

  const allNull = indicators.margemEbitda === null
    && indicators.liquidezCorrente === null
    && indicators.coberturaServicoDivida === null

  return (
    <div className="space-y-6">
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Fluxo de Caixa — 90 dias</CardTitle>
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
          <CardTitle className="text-base font-semibold">Indicadores Financeiros — mês atual</CardTitle>
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
              />
              <IndicatorItem
                icon={<Droplets className="h-4 w-4" strokeWidth={1.5} />}
                label="Liquidez Corrente"
                value={indicators.liquidezCorrente}
                format={v => `${v.toFixed(2)}x`}
                status={liquidezStatus}
                hint={indicators.liquidezCorrente === null ? 'Requer lançamentos de Balanço Patrimonial' : 'Referência saudável: acima de 1,5x'}
              />
              <IndicatorItem
                icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.5} />}
                label="Cobertura do Serviço da Dívida"
                value={indicators.coberturaServicoDivida}
                format={v => `${v.toFixed(2)}x`}
                status={dcsrStatus}
                hint={indicators.coberturaServicoDivida === null ? 'Sem amortizações no mês' : 'Referência saudável: acima de 1,5x'}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
