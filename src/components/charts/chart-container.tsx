'use client'

// A moldura comum de todo gráfico Recharts do produto, extraída de
// `dashboard-client.tsx` e `fluxo-client.tsx` na Fase 5.A (o princípio 8:
// quando duas telas precisam do mesmo componente, ele MUDA de casa).
//
// O Recharts inspeciona o TIPO dos filhos diretos (CartesianGrid, XAxis...),
// então não dá para embrulhá-los em componentes próprios — viram objetos de
// props para espalhar (`{...EIXO_X}`), que é a forma de padronizar sem quebrar
// essa inspeção.

import { ResponsiveContainer } from 'recharts'
import { moedaCheia } from './chart-theme'

export const ALTURA_PADRAO = 280

export function ChartContainer({
  height = ALTURA_PADRAO,
  children,
}: {
  height?: number
  children: React.ReactElement
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      {children}
    </ResponsiveContainer>
  )
}

// ─── Defaults de eixo e grade (espalhar nas tags do Recharts) ────────────────

export const GRADE = {
  strokeDasharray: '3 3',
  vertical: false,
  stroke: 'hsl(var(--border))',
} as const

export const EIXO_X = {
  tick: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' },
  axisLine: false,
  tickLine: false,
} as const

export const EIXO_Y = {
  tick: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' },
  axisLine: false,
  tickLine: false,
  width: 72,
} as const

export const CURSOR_BARRA = { fill: 'hsl(var(--muted))', opacity: 0.5 } as const

// ─── Tooltip ─────────────────────────────────────────────────────────────────

interface TooltipEntry {
  name?: string | number
  value?: number | string
  color?: string
  dataKey?: string | number
}

/**
 * Conteúdo de tooltip padrão. O rótulo de cada linha é o `name` da série —
 * que os gráficos desta pasta preenchem com `ChartSeries.label` — então o
 * mapeamento chave→humano acontece uma vez só, na declaração da série.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  formatoValor = moedaCheia,
  ocultarZeros = false,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string
  formatoValor?: (v: number) => string
  ocultarZeros?: boolean
}) {
  if (!active || !payload?.length) return null
  const itens = payload.filter((p) => {
    const v = Number(p.value ?? 0)
    return ocultarZeros ? v !== 0 : true
  })
  if (!itens.length) return null

  return (
    <div className="bg-background border border-border rounded-md shadow-md px-3 py-2 text-sm">
      {label !== undefined && <p className="font-medium text-foreground mb-1.5">{label}</p>}
      {itens.map((entry) => (
        <div key={String(entry.dataKey ?? entry.name)} className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-muted-foreground">{String(entry.name)}:</span>
          <span className="font-medium tabular-nums" style={{ color: entry.color }}>
            {formatoValor(Number(entry.value ?? 0))}
          </span>
        </div>
      ))}
    </div>
  )
}
