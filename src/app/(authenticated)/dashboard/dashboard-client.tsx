'use client'

import { useMemo } from 'react'
import { KPICard } from '@/components/financial/kpi-card'
import { EmptyState } from '@/components/states/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardKPIs, CashFlowDay } from '@/server/dashboard'
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
import { BarChart2 } from 'lucide-react'

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

interface DashboardClientProps {
  kpis: DashboardKPIs
  cashFlow: CashFlowDay[]
}

export function DashboardClient({ kpis, cashFlow }: DashboardClientProps) {
  const weeklyData  = useMemo(() => groupByWeek(cashFlow), [cashFlow])
  const hasChart    = cashFlow.length > 0

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
    </div>
  )
}
