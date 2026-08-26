'use client'

// Barras horizontais — o padrão honesto para ranking ("top 5 UENs"): a pizza
// de 5 fatias parecidas esconde a ordem; a barra a mostra.

import {
  BarChart as RechartsBarChart,
  Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import {
  ChartContainer, CURSOR_BARRA, ALTURA_PADRAO,
} from './chart-container'
import { moedaCompacta, moedaCheia, corCategorica, CHART_PALETTE } from './chart-theme'

export interface BarraDeRanking {
  nome: string
  valor: number
  cor?: string
}

export interface HorizontalBarChartProps {
  data: BarraDeRanking[]
  height?: number
  /** Uma cor só para todas as barras (ranking de uma medida). */
  cor?: string
  /** Cada barra com uma cor da paleta — para quando a barra é uma categoria. */
  coresCategoricas?: boolean
  /** Largura reservada aos rótulos do eixo. */
  larguraRotulo?: number
  formatoEixo?: (v: number) => string
  formatoValor?: (v: number) => string
}

function RankingTooltipContent({
  active, payload, label, formatoValor,
}: {
  active?: boolean
  payload?: { value?: number | string; payload?: { fill?: string } }[]
  label?: string
  formatoValor: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="bg-background border border-border rounded-md shadow-md px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{label}:</span>
        <span className="font-medium tabular-nums text-foreground">
          {formatoValor(Number(entry.value ?? 0))}
        </span>
      </div>
    </div>
  )
}

export function HorizontalBarChart({
  data,
  height = ALTURA_PADRAO,
  cor = CHART_PALETTE[0],
  coresCategoricas = false,
  larguraRotulo = 140,
  formatoEixo = moedaCompacta,
  formatoValor = moedaCheia,
}: HorizontalBarChartProps) {
  return (
    <ChartContainer height={height}>
      <RechartsBarChart data={data} layout="vertical" barCategoryGap="25%">
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
        <XAxis
          type="number"
          tickFormatter={formatoEixo}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="nome"
          width={larguraRotulo}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={<RankingTooltipContent formatoValor={formatoValor} />}
          cursor={CURSOR_BARRA}
        />
        <Bar dataKey="valor" radius={[0, 3, 3, 0]}>
          {data.map((item, i) => (
            <Cell key={item.nome} fill={item.cor ?? (coresCategoricas ? corCategorica(i) : cor)} />
          ))}
        </Bar>
      </RechartsBarChart>
    </ChartContainer>
  )
}
