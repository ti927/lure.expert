// As 8 regras de alerta do dashboard — extraídas do `useMemo` de
// `dashboard-client.tsx` na 5.B (movidas, não copiadas: o cliente passou a
// importar daqui). O ganho não é estético: como função pura em `/lib`, as
// regras viram o bloco `alertas` do painel e ficam legíveis pelo MCP.
//
// Client-safe: nada de `@/db` — só recebe números e devolve alertas. Os tipos
// entram por `import type`, que é apagado na compilação.

import type { DashboardKPIs } from './kpis'
import type { FinancialIndicators } from './indicators'

export type DashboardAlert = {
  id:       string
  severity: 'critical' | 'warning'
  message:  string
  action?:  { label: string; href: string }
}

export type IndicatorStatus = 'good' | 'warn' | 'bad' | 'neutral'

export function indicatorStatus(value: number | null, good: number, warn: number): IndicatorStatus {
  if (value === null) return 'neutral'
  if (value >= good) return 'good'
  if (value >= warn) return 'warn'
  return 'bad'
}

/** Para indicadores onde "menor é melhor" (ex: Endividamento Geral). */
export function indicatorStatusInverse(value: number | null, goodMax: number, warnMax: number): IndicatorStatus {
  if (value === null) return 'neutral'
  if (value <= goodMax) return 'good'
  if (value <= warnMax) return 'warn'
  return 'bad'
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Avalia as 8 regras sobre os números do mês.
 *
 * `regras` restringe quais avaliar (o bloco `alertas` escolhe); `maximo` corta
 * a lista depois de ordenar por severidade — o padrão 6 é o da tela de sempre.
 */
export function gerarAlertas(
  kpis: DashboardKPIs,
  indicators: FinancialIndicators,
  opts: { regras?: readonly string[]; maximo?: number } = {},
): DashboardAlert[] {
  const { regras, maximo = 6 } = opts
  if (!kpis.hasData) return []

  const ebitdaStatus  = indicatorStatus(indicators.margemEbitda, 15, 5)
  const dcsrStatus    = indicatorStatus(indicators.coberturaServicoDivida, 1.5, 1.0)
  const liquidezStatus = indicatorStatus(indicators.liquidezCorrente, 1.5, 1.0)
  const endividStatus = indicatorStatusInverse(indicators.endividamentoGeral, 0.5, 0.7)

  const result: DashboardAlert[] = []

  // Saldo em caixa negativo
  if (kpis.saldoCaixa < 0) {
    result.push({
      id: 'saldo-negativo',
      severity: 'critical',
      message: `Saldo em caixa negativo (${brl.format(kpis.saldoCaixa)}).`,
      action: { label: 'Ver transações', href: '/transacoes' },
    })
  }

  // Resultado líquido negativo
  if (kpis.lucroLiquido.current < 0) {
    result.push({
      id: 'lucro-negativo',
      severity: 'warning',
      message: `Resultado líquido do mês negativo (${brl.format(kpis.lucroLiquido.current)}).`,
      action: { label: 'Ver DRE', href: '/dre' },
    })
  }

  // Despesas crescendo muito
  if (kpis.despesas.delta !== null && kpis.despesas.delta > 30) {
    result.push({
      id: 'despesas-alta',
      severity: kpis.despesas.delta > 50 ? 'critical' : 'warning',
      message: `Despesas cresceram ${kpis.despesas.delta.toFixed(0)}% em relação ao mês anterior.`,
      action: { label: 'Analisar', href: '/transacoes' },
    })
  }

  // Receita caindo muito
  if (kpis.receita.delta !== null && kpis.receita.delta < -20) {
    result.push({
      id: 'receita-queda',
      severity: kpis.receita.delta < -40 ? 'critical' : 'warning',
      message: `Receita caiu ${Math.abs(kpis.receita.delta).toFixed(0)}% em relação ao mês anterior.`,
      action: { label: 'Ver DRE', href: '/dre' },
    })
  }

  // Margem EBITDA crítica
  if (ebitdaStatus === 'bad' && indicators.margemEbitda !== null) {
    result.push({
      id: 'ebitda-baixo',
      severity: indicators.margemEbitda < 0 ? 'critical' : 'warning',
      message: `Margem EBITDA em ${indicators.margemEbitda.toFixed(1)}% — abaixo do mínimo recomendável de 5%.`,
      action: { label: 'Ver DRE', href: '/dre' },
    })
  }

  // Cobertura do serviço da dívida insuficiente
  if (dcsrStatus === 'bad' && indicators.coberturaServicoDivida !== null) {
    result.push({
      id: 'cobertura-divida',
      severity: 'critical',
      message: `Cobertura do serviço da dívida em ${indicators.coberturaServicoDivida.toFixed(2)}x — resultado operacional não cobre os empréstimos do mês.`,
      action: { label: 'Ver DRE', href: '/dre' },
    })
  }

  // Liquidez corrente crítica
  if (liquidezStatus === 'bad' && indicators.liquidezCorrente !== null) {
    result.push({
      id: 'liquidez-corrente',
      severity: 'critical',
      message: `Liquidez Corrente em ${indicators.liquidezCorrente.toFixed(2)}x — ativo circulante insuficiente para cobrir o passivo de curto prazo.`,
      action: { label: 'Ver Balanço', href: '/balanco' },
    })
  }

  // Endividamento elevado
  if (endividStatus === 'bad' && indicators.endividamentoGeral !== null) {
    result.push({
      id: 'endividamento',
      severity: 'warning',
      message: `Endividamento Geral em ${(indicators.endividamentoGeral * 100).toFixed(1)}% — alavancagem acima do limite recomendável.`,
      action: { label: 'Ver Balanço', href: '/balanco' },
    })
  }

  const filtrado = regras ? result.filter(a => regras.includes(a.id)) : result

  return filtrado
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))
    .slice(0, maximo)
}
