// Os 4 KPIs do mês — o miolo de `getDashboardKPIs`, que MUDOU DE CASA na 5.B
// (não foi copiado): fora de `'use server'` para ser exercitável por script e
// consumível pelo bloco `alertas` do painel, que precisa dos números para
// avaliar as regras. `server/dashboard.ts` virou casca.

import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns'

type Exec = Pick<typeof db, 'execute'>

// ─── As listas de tipos que definem cada número ──────────────────────────────
//
// São a semântica dos KPIs desde a Fase 5 original, agora como arrays
// exportados: o painel padrão da 5.B monta os blocos de KPI a partir DESTAS
// listas — duas cópias divergiriam em silêncio na primeira mudança de plano.

/** Os 6 tipos que "Despesas" soma. */
export const TIPOS_DESPESA = [
  'deducoes_tributarias', 'deducoes_operacionais', 'cpv', 'sga',
  'resultado_financeiro', 'ir',
] as const

/** O que fica FORA do resultado: transferências, BP e movimentos de capital. */
export const TIPOS_FORA_DO_RESULTADO = [
  'transfer',
  'ativo_circulante', 'ativo_nao_circulante',
  'passivo_circulante', 'passivo_nao_circulante', 'patrimonio_liquido',
  'emprestimos_amortizacoes', 'investimentos_retiradas',
] as const

/** Os 7 tipos que compõem o Lucro Líquido (15 tipos − os 8 fora do resultado). */
export const TIPOS_RESULTADO = ['receita_operacional', ...TIPOS_DESPESA] as const

/**
 * Os 8 tipos que o Top 5 trata como "despesa" no sentido coloquial — os 6 da
 * DRE mais as saídas de capital que o dono também sente como gasto.
 */
export const TIPOS_SAIDA_CAIXA = [
  ...TIPOS_DESPESA, 'emprestimos_amortizacoes', 'investimentos_retiradas',
] as const

const lista = (tipos: readonly string[]) =>
  sql.join(tipos.map(t => sql`${t}`), sql`, `)

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type KPIValue = {
  current: number
  previous: number
  delta: number | null
}

export type DashboardKPIs = {
  receita: KPIValue
  despesas: KPIValue
  lucroLiquido: KPIValue
  saldoCaixa: number
  hasData: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve uma referência de mês ('YYYY-MM' ou undefined) em todos os marcos
 * usados pelas leituras do dashboard. Inválido ou ausente cai no mês corrente.
 */
export function resolveMonthRange(referenceMonth?: string) {
  let base: Date
  if (referenceMonth && /^\d{4}-\d{2}$/.test(referenceMonth)) {
    const y = Number(referenceMonth.slice(0, 4))
    const m = Number(referenceMonth.slice(5, 7))
    base = new Date(y, m - 1, 1)
  } else {
    base = new Date()
  }
  return {
    curFrom:  format(startOfMonth(base),                'yyyy-MM-dd'),
    curTo:    format(endOfMonth(base),                  'yyyy-MM-dd'),
    prevFrom: format(startOfMonth(subMonths(base, 1)),  'yyyy-MM-dd'),
    prevTo:   format(endOfMonth(subMonths(base, 1)),    'yyyy-MM-dd'),
    from12m:  format(startOfMonth(subMonths(base, 11)), 'yyyy-MM-dd'),
  }
}

export function pct(a: number, b: number): number | null {
  return b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null
}

// ─── O cálculo ───────────────────────────────────────────────────────────────

export async function calcularKpisDoMes(
  organizationId: string,
  referenceMonth?: string,
  exec: Exec = db,
): Promise<DashboardKPIs> {
  const { curFrom, curTo, prevFrom, prevTo } = resolveMonthRange(referenceMonth)

  type MonthRow = { receita: string; despesas: string; lucro: string; tx_count: string }
  type BalRow   = { saldo: string }

  const monthQuery = (from: string, to: string) => exec.execute<MonthRow>(sql`
    SELECT
      COALESCE(SUM(CASE WHEN c.type = 'receita_operacional'
        THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
        ELSE 0 END), 0)::text AS receita,
      COALESCE(SUM(CASE WHEN c.type IN (${lista(TIPOS_DESPESA)})
        THEN (CASE WHEN t.direction = 'outflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
        ELSE 0 END), 0)::text AS despesas,
      COALESCE(SUM(CASE WHEN c.type NOT IN (${lista(TIPOS_FORA_DO_RESULTADO)})
        THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
        ELSE 0 END), 0)::text AS lucro,
      COUNT(*)::text AS tx_count
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND t.date::date >= ${from}::date
      AND t.date::date <= ${to}::date
  `)

  const [curRows, prevRows, balRows] = await Promise.all([
    monthQuery(curFrom, curTo),
    monthQuery(prevFrom, prevTo),
    exec.execute<BalRow>(sql`
      SELECT COALESCE(SUM(
        CASE WHEN direction = 'inflow' THEN amount::numeric ELSE -amount::numeric END
      ), 0)::text AS saldo
      FROM transactions
      WHERE organization_id = ${organizationId}::uuid
        AND status NOT IN ('pending', 'duplicate')
        AND COALESCE(effective_date, date)::date <= ${curTo}::date
    `),
  ])

  const cur  = curRows[0]  ?? { receita: '0', despesas: '0', lucro: '0', tx_count: '0' }
  const prev = prevRows[0] ?? { receita: '0', despesas: '0', lucro: '0', tx_count: '0' }

  const rc = Number(cur.receita),  rp = Number(prev.receita)
  const dc = Number(cur.despesas), dp = Number(prev.despesas)
  const lc = Number(cur.lucro),    lp = Number(prev.lucro)

  return {
    receita:      { current: rc, previous: rp, delta: pct(rc, rp) },
    despesas:     { current: dc, previous: dp, delta: pct(dc, dp) },
    lucroLiquido: { current: lc, previous: lp, delta: pct(lc, lp) },
    saldoCaixa:   Number(balRows[0]?.saldo ?? 0),
    hasData:      Number(cur.tx_count) + Number(prev.tx_count) > 0,
  }
}
