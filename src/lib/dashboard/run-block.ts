// Executa UM bloco do painel e devolve o dado pronto para desenhar.
//
// É o encontro das duas metades do desenho: blocos com `query` passam pelo
// MOTOR (escopo, isolamento e tetos de lá valem aqui de graça); `indicador` e
// `alertas` são as escotilhas que carregam a lógica clássica extraída para
// `/lib`. Três consumidores: o renderizador da 5.C, a ferramenta MCP
// `adicionar_bloco` (que executa uma vez e devolve as linhas) e o script de
// verificação.
//
// O PERÍODO é a parte com regra própria. No modo `herda_do_painel`, a janela
// declarada no bloco é ancorada no mês M do painel e SUBSTITUI as datas de
// `query.periodo` (o regime competência/caixa continua vindo de lá). No modo
// `proprio`, `query.periodo` vale literalmente.

import { format, startOfMonth, endOfMonth, subMonths, subDays, parseISO, differenceInCalendarDays } from 'date-fns'
import { runQuery } from '@/lib/query/engine'
import type { QueryScope } from '@/lib/query/scope'
import type { Periodo, QueryResult, QuerySpec } from '@/lib/query/spec'
import type { BlockSpec, PeriodoDoBloco } from './block-spec'
import { calcularKpisDoMes, pct } from './kpis'
import { calcularIndicadores, type FinancialIndicators } from './indicators'
import { gerarAlertas, type DashboardAlert } from './alerts'

export interface ContextoDoPainel {
  /** Mês de referência 'YYYY-MM'. Ausente ou inválido = mês corrente. */
  mes?: string
}

export type ResultadoDeBloco =
  | {
      tipo: 'kpi'
      valor: number
      anterior: number | null
      deltaPct: number | null
      formato: 'moeda' | 'inteiro' | 'percentual'
      menorEhMelhor: boolean
      meta?: number
      periodo: { de: string; ate: string } | { em: string }
    }
  | { tipo: 'serie'; visual: string; resultado: QueryResult }
  | { tipo: 'ranking'; visual: string; mostrarPercentual: boolean; resultado: QueryResult }
  | { tipo: 'composicao'; visual: string; resultado: QueryResult }
  | { tipo: 'indicador'; indicadores: FinancialIndicators; selecionados: readonly string[] }
  | { tipo: 'alertas'; alertas: DashboardAlert[] }
  | { tipo: 'texto'; markdown: string }

// ─── Janelas ─────────────────────────────────────────────────────────────────

const DATA_MINIMA = '1900-01-01'
const d = (x: Date) => format(x, 'yyyy-MM-dd')

/** 'YYYY-MM' → primeiro dia do mês; ausente ou inválido → mês corrente. */
function baseDoMes(mes?: string): Date {
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    return new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1)
  }
  return startOfMonth(new Date())
}

interface Janela { de: string; ate: string }

type PeriodoHerdado = Extract<PeriodoDoBloco, { modo: 'herda_do_painel' }>

function janelaHerdada(p: PeriodoHerdado, mes?: string): Janela {
  const base = baseDoMes(mes)
  const fim = endOfMonth(base)
  switch (p.janela) {
    case 'mes':
      return { de: d(startOfMonth(base)), ate: d(fim) }
    case 'ultimos_meses':
      return { de: d(startOfMonth(subMonths(base, (p.tamanho ?? 1) - 1))), ate: d(fim) }
    case 'ultimos_dias':
      return { de: d(subDays(fim, (p.tamanho ?? 1) - 1)), ate: d(fim) }
    case 'acumulado':
      return { de: DATA_MINIMA, ate: d(fim) }
  }
}

/** A janela imediatamente anterior, do mesmo tamanho. `null` = não comparável. */
function janelaHerdadaAnterior(p: PeriodoHerdado, mes?: string): Janela | null {
  const base = baseDoMes(mes)
  const fim = endOfMonth(base)
  switch (p.janela) {
    case 'mes': {
      const prev = subMonths(base, 1)
      return { de: d(startOfMonth(prev)), ate: d(endOfMonth(prev)) }
    }
    case 'ultimos_meses': {
      const n = p.tamanho ?? 1
      return {
        de: d(startOfMonth(subMonths(base, 2 * n - 1))),
        ate: d(endOfMonth(subMonths(base, n))),
      }
    }
    case 'ultimos_dias': {
      const n = p.tamanho ?? 1
      return { de: d(subDays(fim, 2 * n - 1)), ate: d(subDays(fim, n)) }
    }
    case 'acumulado':
      // "Desde o início até ontem-do-mês-anterior" não é comparação honesta
      // de janelas iguais — o saldo acumulado não tem período anterior.
      return null
  }
}

/** Espelho de `resolverPeriodo` do motor, para o comparativo do modo próprio. */
function janelaPropria(qp: Periodo): Janela {
  if (qp.tipo === 'intervalo') return { de: qp.de, ate: qp.ate }
  const hoje = new Date()
  const fim = endOfMonth(hoje)
  const ini = startOfMonth(subMonths(hoje, qp.meses - 1))
  return { de: d(ini), ate: d(fim) }
}

function janelaAnteriorDe(j: Janela): Janela {
  const dias = differenceInCalendarDays(parseISO(j.ate), parseISO(j.de)) + 1
  return {
    de: d(subDays(parseISO(j.de), dias)),
    ate: d(subDays(parseISO(j.de), 1)),
  }
}

/**
 * Resolve o período do bloco em períodos concretos do motor.
 * `anterior` só existe quando a comparação faz sentido.
 */
export function resolverPeriodos(
  p: PeriodoDoBloco,
  qp: Periodo,
  mes?: string,
): { atual: Periodo; anterior: Periodo | null } {
  if (p.modo === 'proprio') {
    const anterior = janelaAnteriorDe(janelaPropria(qp))
    return {
      atual: qp,
      anterior: { tipo: 'intervalo', de: anterior.de, ate: anterior.ate, regime: qp.regime },
    }
  }

  // Herdado: a âncora é o mês do painel.
  const regime = qp.regime
  const j = janelaHerdada(p, mes)
  const ant = janelaHerdadaAnterior(p, mes)
  return {
    atual: { tipo: 'intervalo', de: j.de, ate: j.ate, regime },
    anterior: ant ? { tipo: 'intervalo', de: ant.de, ate: ant.ate, regime } : null,
  }
}

// ─── Execução ────────────────────────────────────────────────────────────────

async function valorUnico(
  scope: QueryScope,
  query: QuerySpec,
  periodo: Periodo,
  medida: string,
): Promise<number> {
  const r = await runQuery(scope, { ...query, periodo, agruparPor: [], limite: 1 })
  return r.linhas[0]?.medidas[medida] ?? 0
}

export async function executarBloco(
  scope: QueryScope,
  spec: BlockSpec,
  ctx: ContextoDoPainel = {},
): Promise<ResultadoDeBloco> {
  switch (spec.tipo) {
    case 'texto':
      return { tipo: 'texto', markdown: spec.markdown }

    case 'indicador': {
      const indicadores = await calcularIndicadores(scope.organizationId, ctx.mes)
      return { tipo: 'indicador', indicadores, selecionados: spec.indicadores }
    }

    case 'alertas': {
      const [kpis, indicadores] = await Promise.all([
        calcularKpisDoMes(scope.organizationId, ctx.mes),
        calcularIndicadores(scope.organizationId, ctx.mes),
      ])
      return {
        tipo: 'alertas',
        alertas: gerarAlertas(kpis, indicadores, { regras: spec.regras, maximo: spec.maximo }),
      }
    }

    case 'kpi': {
      const medida = spec.query.medidas[0]
      const { atual, anterior } = resolverPeriodos(spec.periodo, spec.query.periodo, ctx.mes)
      const fator = spec.inverterSinal ? -1 : 1

      const valor = fator * await valorUnico(scope, spec.query, atual, medida)
      let valorAnterior: number | null = null
      let deltaPct: number | null = null
      if (spec.comparar && anterior) {
        valorAnterior = fator * await valorUnico(scope, spec.query, anterior, medida)
        deltaPct = pct(valor, valorAnterior)
      }

      // 'relativo' só sobrevive no modo próprio; o motor o resolve, mas o
      // relatório do bloco precisa da janela concreta.
      const periodoRelatado = atual.tipo === 'intervalo'
        ? { de: atual.de, ate: atual.ate }
        : janelaPropria(atual)

      return {
        tipo: 'kpi',
        valor,
        anterior: valorAnterior,
        deltaPct,
        formato: spec.formato,
        menorEhMelhor: spec.menorEhMelhor,
        meta: spec.meta,
        periodo: periodoRelatado,
      }
    }

    case 'serie':
    case 'ranking':
    case 'composicao': {
      const { atual } = resolverPeriodos(spec.periodo, spec.query.periodo, ctx.mes)
      const resultado = await runQuery(scope, { ...spec.query, periodo: atual })
      if (spec.tipo === 'ranking') {
        return { tipo: 'ranking', visual: spec.visual, mostrarPercentual: spec.mostrarPercentual, resultado }
      }
      if (spec.tipo === 'composicao') {
        return { tipo: 'composicao', visual: spec.visual, resultado }
      }
      return { tipo: 'serie', visual: spec.visual, resultado }
    }
  }
}
