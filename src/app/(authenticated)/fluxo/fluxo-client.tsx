'use client'

import { useMemo } from 'react'
import type { FluxoData } from '@/server/fluxo'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KPICard } from '@/components/financial/kpi-card'
import { EmptyState } from '@/components/states/empty-state'
import { TrendingUp } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function yFormatter(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `R$ ${(value / 1_000).toFixed(0)}k`
  return `R$ ${value.toFixed(0)}`
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { value: number; color: string; dataKey: string | number }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const items = payload.filter(p => p.value > 0)
  if (!items.length) return null
  return (
    <div className="bg-background border border-border rounded-md shadow-md px-3 py-2 text-sm">
      <p className="font-medium text-foreground mb-1.5">{label}</p>
      {items.map(entry => {
        const key    = String(entry.dataKey)
        const label2 = key.startsWith('inflow') ? 'Entradas' : 'Saídas'
        const suffix = key.endsWith('Projetado') ? ' (proj.)' : ''
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: entry.color }} />
            <span className="text-muted-foreground">{label2}{suffix}:</span>
            <span className="font-medium tabular-nums" style={{ color: entry.color }}>
              {brl.format(entry.value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

interface FluxoClientProps {
  data: FluxoData
}

export function FluxoClient({ data }: FluxoClientProps) {
  const hasHistorico  = data.semanas.some(s => s.inflowReal > 0 || s.outflowReal > 0)
  const hasProjecao   = data.recorrencias.length > 0

  const chartData = useMemo(() => data.semanas, [data.semanas])

  return (
    <div className="space-y-6">
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
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} barCategoryGap="35%" barGap={2}>
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
                  {/* Inflow: histórico (escuro) + projetado (claro) empilhados */}
                  <Bar dataKey="inflowReal"       fill="#059669" stackId="in" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="inflowProjetado"  fill="#6ee7b7" stackId="in" radius={[3, 3, 0, 0]} />
                  {/* Outflow: histórico (escuro) + projetado (claro) empilhados */}
                  <Bar dataKey="outflowReal"      fill="#e11d48" stackId="out" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="outflowProjetado" fill="#fca5a5" stackId="out" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
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
