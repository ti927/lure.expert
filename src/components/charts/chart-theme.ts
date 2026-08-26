// O vocabulário de cor e formato dos gráficos.
//
// Duas famílias que NÃO se misturam:
// - SEMÂNTICAS: entrada/saída carregam juízo (verde ganha, rosa perde) e vêm
//   das variáveis que o produto inteiro já usa.
// - CATEGÓRICAS (--chart-1..8): fatias e séries sem juízo de valor — top 5
//   UENs, composição por centro de custo. Rose fica fora da paleta de
//   propósito: fatia de pizza não pode parecer prejuízo.
//
// Tudo referencia CSS variables, então o modo escuro troca a paleta sem que
// nenhum componente saiba disso.

/** Paleta categórica, na ordem de atribuição às séries/fatias. */
export const CHART_PALETTE = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
  'hsl(var(--chart-7))',
  'hsl(var(--chart-8))',
] as const

/** Cor categórica cíclica — a 9ª série volta para a 1ª cor. */
export function corCategorica(indice: number): string {
  return CHART_PALETTE[((indice % CHART_PALETTE.length) + CHART_PALETTE.length) % CHART_PALETTE.length]
}

/** Semânticas de fluxo — as mesmas do resto do produto. */
export const COR_ENTRADA = 'hsl(var(--color-positive))'
export const COR_SAIDA = 'hsl(var(--color-negative))'

/** Versões claras — projeção ao lado do realizado (padrão de /fluxo). */
export const COR_ENTRADA_PROJETADA = 'hsl(var(--color-positive-soft))'
export const COR_SAIDA_PROJETADA = 'hsl(var(--color-negative-soft))'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Valor por extenso — tooltip. */
export function moedaCheia(v: number): string {
  return brl.format(v)
}

/** Valor compacto — eixo Y (R$ 1.2M / R$ 45k / R$ 120). */
export function moedaCompacta(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}k`
  return `R$ ${value.toFixed(0)}`
}

/**
 * Uma série de dados num gráfico. `label` é o que aparece em legenda e
 * tooltip — os componentes passam `name={label}` ao Recharts, então nenhum
 * consumidor precisa de formatter de legenda próprio.
 */
export interface ChartSeries {
  /** A chave do campo em cada linha de `data`. */
  key: string
  /** Rótulo humano — legenda e tooltip. */
  label: string
  /** Cor CSS. Sem ela, entra a categórica pela posição da série. */
  cor?: string
  /** Barras com o mesmo `stackId` empilham (padrão de /fluxo: real + projeção). */
  stackId?: string
  /** Só no gráfico combinado: como desenhar esta série. */
  visual?: 'barra' | 'linha' | 'area'
}

/** Resolve a cor de uma série: a declarada, senão a categórica da posição. */
export function corDaSerie(serie: ChartSeries, indice: number): string {
  return serie.cor ?? corCategorica(indice)
}
