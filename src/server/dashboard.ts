'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships } from '@/db/schema'
import { eq, and, isNotNull, sql } from 'drizzle-orm'
import { startOfMonth, endOfMonth, subMonths, subDays, format } from 'date-fns'

async function getAuthContext() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!membership) redirect('/onboarding')

  return { userId: user.id, organizationId: membership.organizationId }
}

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

export type CashFlowDay = {
  date: string
  inflow: number
  outflow: number
}

const expenseTypes = sql.raw(
  `'deducoes_tributarias','deducoes_operacionais','cpv','sga','resultado_financeiro','ir'`
)
const bpAndTransferTypes = sql.raw(
  `'transfer','ativo_circulante','ativo_nao_circulante','passivo_circulante','passivo_nao_circulante','patrimonio_liquido','emprestimos_amortizacoes','investimentos_retiradas'`
)

function pct(a: number, b: number): number | null {
  return b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null
}

export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  const { organizationId } = await getAuthContext()

  const now      = new Date()
  const curFrom  = format(startOfMonth(now), 'yyyy-MM-dd')
  const curTo    = format(endOfMonth(now),   'yyyy-MM-dd')
  const prevFrom = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
  const prevTo   = format(endOfMonth(subMonths(now, 1)),   'yyyy-MM-dd')

  type MonthRow = { receita: string; despesas: string; lucro: string; tx_count: string }
  type BalRow   = { saldo: string }

  const monthQuery = (from: string, to: string) => db.execute<MonthRow>(sql`
    SELECT
      COALESCE(SUM(CASE WHEN c.type = 'receita_operacional'
        THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
        ELSE 0 END), 0)::text AS receita,
      COALESCE(SUM(CASE WHEN c.type IN (${expenseTypes})
        THEN (CASE WHEN t.direction = 'outflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
        ELSE 0 END), 0)::text AS despesas,
      COALESCE(SUM(CASE WHEN c.type NOT IN (${bpAndTransferTypes})
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
    db.execute<BalRow>(sql`
      SELECT COALESCE(SUM(
        CASE WHEN direction = 'inflow' THEN amount::numeric ELSE -amount::numeric END
      ), 0)::text AS saldo
      FROM transactions
      WHERE organization_id = ${organizationId}::uuid
        AND status NOT IN ('pending', 'duplicate')
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

export type FinancialIndicators = {
  margemEbitda:           number | null
  liquidezCorrente:       number | null
  liquidezSeca:           number | null
  coberturaServicoDivida: number | null
  endividamentoGeral:     number | null   // proporção 0..1 (passivo / ativo)
  cicloFinanceiro:        number | null   // sempre null no MVP — requer AR/AP estruturados
  roe:                    number | null   // % anualizado
  meses12mDisponiveis:    number          // 1..12 — quantos meses entraram no lucro acumulado
}

export async function getFinancialIndicators(): Promise<FinancialIndicators> {
  const { organizationId } = await getAuthContext()

  const now     = new Date()
  const curFrom = format(startOfMonth(now), 'yyyy-MM-dd')
  const curTo   = format(endOfMonth(now),   'yyyy-MM-dd')
  const from12m = format(startOfMonth(subMonths(now, 11)), 'yyyy-MM-dd')

  const dreTypes = sql.raw(
    `'receita_operacional','deducoes_tributarias','deducoes_operacionais','cpv','sga'`
  )

  type DreRow      = { receita_bruta: string; ebitda: string; servico_divida: string }
  type BpRow       = {
    ativo_circ:        string
    ativo_nao_circ:    string
    passivo_circ:      string
    passivo_nao_circ:  string
    pl:                string
    estoque:           string
  }
  type Lucro12mRow = { lucro: string; meses: string }

  const [dreRows, bpRows, lucro12mRows] = await Promise.all([
    db.execute<DreRow>(sql`
      SELECT
        COALESCE(SUM(CASE WHEN c.type = 'receita_operacional'
          THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
          ELSE 0 END), 0)::text AS receita_bruta,
        COALESCE(SUM(CASE WHEN c.type IN (${dreTypes})
          THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
          ELSE 0 END), 0)::text AS ebitda,
        COALESCE(SUM(CASE WHEN c.type = 'emprestimos_amortizacoes' AND t.direction = 'outflow'
          THEN t.amount::numeric ELSE 0 END), 0)::text AS servico_divida
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.status NOT IN ('pending', 'duplicate')
        AND t.date::date >= ${curFrom}::date
        AND t.date::date <= ${curTo}::date
    `),
    db.execute<BpRow>(sql`
      SELECT
        COALESCE(SUM(CASE WHEN c.type = 'ativo_circulante'
          THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
          ELSE 0 END), 0)::text AS ativo_circ,
        COALESCE(SUM(CASE WHEN c.type = 'ativo_nao_circulante'
          THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
          ELSE 0 END), 0)::text AS ativo_nao_circ,
        COALESCE(SUM(CASE WHEN c.type = 'passivo_circulante'
          THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
          ELSE 0 END), 0)::text AS passivo_circ,
        COALESCE(SUM(CASE WHEN c.type = 'passivo_nao_circulante'
          THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
          ELSE 0 END), 0)::text AS passivo_nao_circ,
        COALESCE(SUM(CASE WHEN c.type = 'patrimonio_liquido'
          THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
          ELSE 0 END), 0)::text AS pl,
        COALESCE(SUM(CASE WHEN c.type = 'ativo_circulante'
          AND (c.name ILIKE '%estoque%' OR p.name ILIKE '%estoque%')
          THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
          ELSE 0 END), 0)::text AS estoque
      FROM transactions t
      JOIN categories c       ON t.category_id = c.id
      LEFT JOIN categories p  ON c.parent_id   = p.id
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.status NOT IN ('pending', 'duplicate')
    `),
    db.execute<Lucro12mRow>(sql`
      SELECT
        COALESCE(SUM(CASE WHEN c.type NOT IN (${bpAndTransferTypes})
          THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
          ELSE 0 END), 0)::text AS lucro,
        COUNT(DISTINCT date_trunc('month', t.date::date))::text AS meses
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.status NOT IN ('pending', 'duplicate')
        AND t.date::date >= ${from12m}::date
        AND t.date::date <= ${curTo}::date
    `),
  ])

  const dre  = dreRows[0]      ?? { receita_bruta: '0', ebitda: '0', servico_divida: '0' }
  const bp   = bpRows[0]       ?? { ativo_circ: '0', ativo_nao_circ: '0', passivo_circ: '0', passivo_nao_circ: '0', pl: '0', estoque: '0' }
  const luc  = lucro12mRows[0] ?? { lucro: '0', meses: '0' }

  const receitaBruta    = Number(dre.receita_bruta)
  const ebitda          = Number(dre.ebitda)
  const servicoDivida   = Number(dre.servico_divida)
  const ativoCirc       = Number(bp.ativo_circ)
  const ativoNaoCirc    = Number(bp.ativo_nao_circ)
  const passivoCirc     = Number(bp.passivo_circ)
  const passivoNaoCirc  = Number(bp.passivo_nao_circ)
  const plDireto        = Number(bp.pl)
  const estoque         = Number(bp.estoque)
  const lucro12m        = Number(luc.lucro)
  const meses12m        = Math.max(1, Math.min(12, Number(luc.meses) || 0))

  const ativoTotal      = ativoCirc + ativoNaoCirc
  const passivoTotal    = passivoCirc + passivoNaoCirc
  // PL: prioriza valores lançados em patrimonio_liquido; cai para Ativo − Passivo (identidade contábil) quando não há.
  const patrimonioLiquido = plDireto !== 0 ? plDireto : (ativoTotal - passivoTotal)

  // ROE anualizado: lucro acumulado dos últimos N meses (N = meses com dados, máx 12),
  // anualizado proporcionalmente quando há menos de 12 meses.
  const lucroAnualizado = lucro12m * (12 / meses12m)

  return {
    margemEbitda:           receitaBruta > 0   ? (ebitda / receitaBruta) * 100      : null,
    liquidezCorrente:       passivoCirc > 0    ? ativoCirc / passivoCirc            : null,
    liquidezSeca:           passivoCirc > 0    ? (ativoCirc - estoque) / passivoCirc : null,
    coberturaServicoDivida: servicoDivida > 0  ? ebitda / servicoDivida             : null,
    endividamentoGeral:     ativoTotal > 0     ? passivoTotal / ativoTotal          : null,
    cicloFinanceiro:        null,   // Requer AR/AP estruturados — Fase futura
    roe:                    patrimonioLiquido > 0 && Number(luc.meses) > 0
                              ? (lucroAnualizado / patrimonioLiquido) * 100
                              : null,
    meses12mDisponiveis:    meses12m,
  }
}

export async function getCashFlowChart(): Promise<CashFlowDay[]> {
  const { organizationId } = await getAuthContext()

  const toDate   = format(new Date(), 'yyyy-MM-dd')
  const fromDate = format(subDays(new Date(), 89), 'yyyy-MM-dd')

  type DayRow = { date: string; inflow: string; outflow: string }

  const rows = await db.execute<DayRow>(sql`
    SELECT
      t.date::date::text AS date,
      COALESCE(SUM(CASE WHEN t.direction = 'inflow'  THEN t.amount::numeric ELSE 0 END), 0)::text AS inflow,
      COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric ELSE 0 END), 0)::text AS outflow
    FROM transactions t
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND t.date::date >= ${fromDate}::date
      AND t.date::date <= ${toDate}::date
    GROUP BY t.date::date
    ORDER BY t.date::date ASC
  `)

  return rows.map(r => ({
    date:    String(r.date),
    inflow:  Number(r.inflow),
    outflow: Number(r.outflow),
  }))
}
