'use client'

// Pizza e rosca — composição de um total. Usa a paleta categórica na ordem;
// para ranking, prefira `HorizontalBarChart` (leitura melhor com 5+ itens).

import {
  PieChart as RechartsPieChart,
  Pie, Cell, Tooltip, Legend,
} from 'recharts'
import { ChartContainer, ALTURA_PADRAO } from './chart-container'
import { moedaCheia, corCategorica } from './chart-theme'

export interface FatiaDePizza {
  nome: string
  valor: number
  /** Cor explícita; sem ela, a categórica pela posição. */
  cor?: string
}

export interface PieChartProps {
  data: FatiaDePizza[]
  height?: number
  /** Rosca (furo no meio) — o padrão do bloco `composicao`. */
  rosca?: boolean
  legenda?: boolean
  formatoValor?: (v: number) => string
}

function PieTooltipContent({
  active, payload, total, formatoValor,
}: {
  active?: boolean
  payload?: { name?: string | number; value?: number | string; payload?: { fill?: string } }[]
  total: number
  formatoValor: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  const valor = Number(entry.value ?? 0)
  const pct = total > 0 ? (valor / total) * 100 : 0
  const cor = entry.payload?.fill
  return (
    <div className="bg-background border border-border rounded-md shadow-md px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: cor }} />
        <span className="text-muted-foreground">{String(entry.name)}:</span>
        <span className="font-medium tabular-nums text-foreground">
          {formatoValor(valor)}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">({pct.toFixed(0)}%)</span>
      </div>
    </div>
  )
}

export function PieChart({
  data,
  height = ALTURA_PADRAO,
  rosca = false,
  legenda = true,
  formatoValor = moedaCheia,
}: PieChartProps) {
  const total = data.reduce((s, d) => s + d.valor, 0)

  return (
    <ChartContainer height={height}>
      <RechartsPieChart>
        <Pie
          data={data}
          dataKey="valor"
          nameKey="nome"
          innerRadius={rosca ? '55%' : 0}
          outerRadius="80%"
          paddingAngle={rosca ? 2 : 0}
          strokeWidth={rosca ? 0 : 1}
          stroke="hsl(var(--background))"
        >
          {data.map((fatia, i) => (
            <Cell key={fatia.nome} fill={fatia.cor ?? corCategorica(i)} />
          ))}
        </Pie>
        <Tooltip content={<PieTooltipContent total={total} formatoValor={formatoValor} />} />
        {legenda && <Legend wrapperStyle={{ fontSize: 12 }} />}
      </RechartsPieChart>
    </ChartContainer>
  )
}
