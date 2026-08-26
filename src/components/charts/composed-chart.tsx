'use client'

// Combinado — cada série declara o próprio traço (`visual`). O caso que o
// motiva: realizado em barra + orçado em linha, no mesmo eixo.

import {
  ComposedChart as RechartsComposedChart,
  Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import {
  ChartContainer, ChartTooltipContent,
  GRADE, EIXO_X, EIXO_Y, CURSOR_BARRA, ALTURA_PADRAO,
} from './chart-container'
import { moedaCompacta, moedaCheia, corDaSerie, type ChartSeries } from './chart-theme'

export interface ComposedChartProps {
  data: Record<string, unknown>[]
  x: string
  /** `visual` de cada série decide o traço; sem ele, barra. */
  series: ChartSeries[]
  height?: number
  legenda?: boolean
  formatoEixo?: (v: number) => string
  formatoValor?: (v: number) => string
}

export function ComposedChart({
  data, x, series,
  height = ALTURA_PADRAO,
  legenda = false,
  formatoEixo = moedaCompacta,
  formatoValor = moedaCheia,
}: ComposedChartProps) {
  return (
    <ChartContainer height={height}>
      <RechartsComposedChart data={data} barCategoryGap="35%" barGap={2}>
        <CartesianGrid {...GRADE} />
        <XAxis dataKey={x} {...EIXO_X} />
        <YAxis tickFormatter={formatoEixo} {...EIXO_Y} />
        <Tooltip
          content={<ChartTooltipContent formatoValor={formatoValor} />}
          cursor={CURSOR_BARRA}
        />
        {legenda && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => {
          const cor = corDaSerie(s, i)
          if (s.visual === 'linha') {
            return (
              <Line
                key={s.key} dataKey={s.key} name={s.label}
                stroke={cor} strokeWidth={2} dot={false} type="monotone"
              />
            )
          }
          if (s.visual === 'area') {
            return (
              <Area
                key={s.key} dataKey={s.key} name={s.label}
                stroke={cor} fill={cor} fillOpacity={0.2} strokeWidth={2} type="monotone"
              />
            )
          }
          return (
            <Bar
              key={s.key} dataKey={s.key} name={s.label}
              fill={cor} stackId={s.stackId} radius={[3, 3, 0, 0]}
            />
          )
        })}
      </RechartsComposedChart>
    </ChartContainer>
  )
}
