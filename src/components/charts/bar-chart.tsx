'use client'

// Barras verticais — agrupadas, empilhadas ou o misto (stackId por série,
// como o gráfico de /fluxo: entrada real + projetada numa pilha, saída real +
// projetada noutra).

import {
  BarChart as RechartsBarChart,
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import {
  ChartContainer, ChartTooltipContent,
  GRADE, EIXO_X, EIXO_Y, CURSOR_BARRA, ALTURA_PADRAO,
} from './chart-container'
import { moedaCompacta, moedaCheia, corDaSerie, type ChartSeries } from './chart-theme'

export interface BarChartProps {
  data: Record<string, unknown>[]
  /** Chave do rótulo do eixo X em cada linha de `data`. */
  x: string
  series: ChartSeries[]
  height?: number
  /** Empilha TODAS as séries numa pilha só (séries com `stackId` próprio vencem). */
  empilhado?: boolean
  legenda?: boolean
  /** Tooltip esconde séries zeradas — útil quando real e projeção nunca coexistem. */
  ocultarZerosNoTooltip?: boolean
  formatoEixo?: (v: number) => string
  formatoValor?: (v: number) => string
}

export function BarChart({
  data, x, series,
  height = ALTURA_PADRAO,
  empilhado = false,
  legenda = false,
  ocultarZerosNoTooltip = false,
  formatoEixo = moedaCompacta,
  formatoValor = moedaCheia,
}: BarChartProps) {
  return (
    <ChartContainer height={height}>
      <RechartsBarChart data={data} barCategoryGap="35%" barGap={2}>
        <CartesianGrid {...GRADE} />
        <XAxis dataKey={x} {...EIXO_X} />
        <YAxis tickFormatter={formatoEixo} {...EIXO_Y} />
        <Tooltip
          content={<ChartTooltipContent formatoValor={formatoValor} ocultarZeros={ocultarZerosNoTooltip} />}
          cursor={CURSOR_BARRA}
        />
        {legenda && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={corDaSerie(s, i)}
            stackId={s.stackId ?? (empilhado ? 'pilha' : undefined)}
            radius={[3, 3, 0, 0]}
          />
        ))}
      </RechartsBarChart>
    </ChartContainer>
  )
}
