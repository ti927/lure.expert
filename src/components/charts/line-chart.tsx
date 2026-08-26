'use client'

// Linhas — evolução de uma ou mais medidas no tempo.

import {
  LineChart as RechartsLineChart,
  Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import {
  ChartContainer, ChartTooltipContent,
  GRADE, EIXO_X, EIXO_Y, ALTURA_PADRAO,
} from './chart-container'
import { moedaCompacta, moedaCheia, corDaSerie, type ChartSeries } from './chart-theme'

export interface LineChartProps {
  data: Record<string, unknown>[]
  x: string
  series: ChartSeries[]
  height?: number
  legenda?: boolean
  formatoEixo?: (v: number) => string
  formatoValor?: (v: number) => string
}

export function LineChart({
  data, x, series,
  height = ALTURA_PADRAO,
  legenda = false,
  formatoEixo = moedaCompacta,
  formatoValor = moedaCheia,
}: LineChartProps) {
  return (
    <ChartContainer height={height}>
      <RechartsLineChart data={data}>
        <CartesianGrid {...GRADE} />
        <XAxis dataKey={x} {...EIXO_X} />
        <YAxis tickFormatter={formatoEixo} {...EIXO_Y} />
        <Tooltip content={<ChartTooltipContent formatoValor={formatoValor} />} />
        {legenda && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stroke={corDaSerie(s, i)}
            strokeWidth={2}
            dot={false}
            type="monotone"
          />
        ))}
      </RechartsLineChart>
    </ChartContainer>
  )
}
