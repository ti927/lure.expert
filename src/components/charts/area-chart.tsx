'use client'

// Áreas — como o de linhas, mas com o volume pintado. `empilhado` soma as
// séries (composição no tempo).

import {
  AreaChart as RechartsAreaChart,
  Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import {
  ChartContainer, ChartTooltipContent,
  GRADE, EIXO_X, EIXO_Y, ALTURA_PADRAO,
} from './chart-container'
import { moedaCompacta, moedaCheia, corDaSerie, type ChartSeries } from './chart-theme'

export interface AreaChartProps {
  data: Record<string, unknown>[]
  x: string
  series: ChartSeries[]
  height?: number
  empilhado?: boolean
  legenda?: boolean
  formatoEixo?: (v: number) => string
  formatoValor?: (v: number) => string
}

export function AreaChart({
  data, x, series,
  height = ALTURA_PADRAO,
  empilhado = false,
  legenda = false,
  formatoEixo = moedaCompacta,
  formatoValor = moedaCheia,
}: AreaChartProps) {
  return (
    <ChartContainer height={height}>
      <RechartsAreaChart data={data}>
        <CartesianGrid {...GRADE} />
        <XAxis dataKey={x} {...EIXO_X} />
        <YAxis tickFormatter={formatoEixo} {...EIXO_Y} />
        <Tooltip content={<ChartTooltipContent formatoValor={formatoValor} />} />
        {legenda && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => {
          const cor = corDaSerie(s, i)
          return (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stroke={cor}
              fill={cor}
              fillOpacity={0.2}
              strokeWidth={2}
              stackId={empilhado ? 'pilha' : undefined}
              type="monotone"
            />
          )
        })}
      </RechartsAreaChart>
    </ChartContainer>
  )
}
