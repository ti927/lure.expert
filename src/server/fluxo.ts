'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships } from '@/db/schema'
import { eq, and, isNotNull, sql } from 'drizzle-orm'
import { format, addDays, subDays, startOfWeek, parseISO } from 'date-fns'

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

export type RecorrenciaDetectada = {
  descricao: string
  direction: 'inflow' | 'outflow'
  valorMedio: number
  ultimaData: string
  proximaData: string
  intervaloMedioDias: number
  ocorrencias: number
}

export type FluxoSemana = {
  label: string
  inflowReal: number
  outflowReal: number
  inflowProjetado: number
  outflowProjetado: number
  isProjected: boolean
}

export type FluxoData = {
  semanas: FluxoSemana[]
  recorrencias: RecorrenciaDetectada[]
  saldoAtual: number
  saldoProjetado30d: number
  saldoProjetado60d: number
  saldoProjetado90d: number
}

export async function getFluxoData(): Promise<FluxoData> {
  const { organizationId } = await getAuthContext()

  const today    = new Date()
  const today0   = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const todayStr = format(today0, 'yyyy-MM-dd')
  const hist60   = format(subDays(today0, 59), 'yyyy-MM-dd')

  type BalRow = { saldo: string }
  type DayRow = { date: string; inflow: string; outflow: string }
  type RecRow = {
    descricao: string
    direction: string
    avg_amount: string
    occurrences: string
    last_date: string
    avg_interval_days: string
    next_date: string
  }

  const [balRows, histRows, recRows] = await Promise.all([
    db.execute<BalRow>(sql`
      SELECT COALESCE(SUM(
        CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END
      ), 0)::text AS saldo
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.status NOT IN ('pending', 'duplicate')
        AND (c.id IS NULL OR c.hide_in_cashflow = false)
    `),

    db.execute<DayRow>(sql`
      SELECT
        COALESCE(t.effective_date, t.date)::date::text AS date,
        COALESCE(SUM(CASE WHEN t.direction = 'inflow'  THEN t.amount::numeric ELSE 0 END), 0)::text AS inflow,
        COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric ELSE 0 END), 0)::text AS outflow
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.status NOT IN ('pending', 'duplicate')
        AND COALESCE(t.effective_date, t.date)::date >= ${hist60}::date
        AND COALESCE(t.effective_date, t.date)::date <= ${todayStr}::date
        AND (c.id IS NULL OR c.hide_in_cashflow = false)
      GROUP BY COALESCE(t.effective_date, t.date)::date
      ORDER BY COALESCE(t.effective_date, t.date)::date ASC
    `),

    db.execute<RecRow>(sql`
      WITH deduped AS (
        SELECT DISTINCT ON (lower(trim(t.description)), t.direction, COALESCE(t.effective_date, t.date)::date)
          lower(trim(t.description)) AS desc_key,
          t.description,
          t.direction,
          t.amount::numeric AS amount,
          COALESCE(t.effective_date, t.date)::date AS tx_date
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.organization_id = ${organizationId}::uuid
          AND t.status NOT IN ('pending', 'duplicate')
          AND COALESCE(t.effective_date, t.date)::date >= CURRENT_DATE - INTERVAL '180 days'
          AND (c.id IS NULL OR c.hide_in_cashflow = false)
        ORDER BY lower(trim(t.description)), t.direction, COALESCE(t.effective_date, t.date)::date, t.amount::numeric DESC
      ),
      grouped AS (
        SELECT
          desc_key,
          MAX(description) AS descricao,
          direction,
          ROUND(AVG(amount)::numeric, 2) AS avg_amount,
          COUNT(*) AS occurrences,
          MAX(tx_date) AS last_date,
          MIN(tx_date) AS first_date
        FROM deduped
        GROUP BY desc_key, direction
        HAVING COUNT(*) >= 2
      ),
      intervals AS (
        SELECT *,
          ROUND(
            (last_date - first_date)::numeric / NULLIF((occurrences - 1)::numeric, 0)
          ) AS avg_days
        FROM grouped
        WHERE (last_date - first_date) > 0
      )
      SELECT
        descricao,
        direction,
        avg_amount::text,
        occurrences::text,
        last_date::text,
        avg_days::text AS avg_interval_days,
        (last_date + avg_days::integer)::text AS next_date
      FROM intervals
      WHERE avg_days BETWEEN 7 AND 40
        AND last_date >= CURRENT_DATE - INTERVAL '90 days'
      ORDER BY avg_amount DESC
      LIMIT 20
    `),
  ])

  const saldoAtual = Number(balRows[0]?.saldo ?? 0)

  // Build projected daily map (next 90 days) and recorrencias list
  const projMap = new Map<string, { inflow: number; outflow: number }>()
  const recorrencias: RecorrenciaDetectada[] = []

  for (const r of recRows) {
    const intervalDias = Number(r.avg_interval_days)
    if (!intervalDias || intervalDias < 1) continue

    // Advance next_date to first future occurrence
    const tomorrow = addDays(today0, 1)
    let nextDate = parseISO(String(r.next_date))
    if (nextDate < tomorrow) {
      const msPerInterval = intervalDias * 86_400_000
      const stepsNeeded   = Math.ceil((tomorrow.getTime() - nextDate.getTime()) / msPerInterval)
      nextDate = addDays(nextDate, stepsNeeded * intervalDias)
    }
    if (nextDate < tomorrow) continue

    const proximaData = format(nextDate, 'yyyy-MM-dd')
    recorrencias.push({
      descricao:         String(r.descricao),
      direction:         r.direction as 'inflow' | 'outflow',
      valorMedio:        Number(r.avg_amount),
      ultimaData:        String(r.last_date),
      proximaData,
      intervaloMedioDias: intervalDias,
      ocorrencias:       Number(r.occurrences),
    })

    // Generate all occurrences within the next 90 days
    let d = nextDate
    const proj90 = addDays(today0, 90)
    while (d <= proj90) {
      const key     = format(d, 'yyyy-MM-dd')
      const entry   = projMap.get(key) ?? { inflow: 0, outflow: 0 }
      if (r.direction === 'inflow') entry.inflow  += Number(r.avg_amount)
      else                          entry.outflow += Number(r.avg_amount)
      projMap.set(key, entry)
      d = addDays(d, intervalDias)
    }
  }

  // Build historical map
  const histMap = new Map<string, { inflow: number; outflow: number }>()
  for (const row of histRows) {
    histMap.set(String(row.date), {
      inflow:  Number(row.inflow),
      outflow: Number(row.outflow),
    })
  }

  // Aggregate into weekly buckets
  type WeekEntry = {
    label: string
    inflowReal: number
    outflowReal: number
    inflowProjetado: number
    outflowProjetado: number
    isProjected: boolean
  }

  const weekMap  = new Map<string, WeekEntry>()
  const thisWeek = format(startOfWeek(today0, { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const addToWeek = (d: Date, inflow: number, outflow: number, isProj: boolean) => {
    const wStart = startOfWeek(d, { weekStartsOn: 1 })
    const key    = format(wStart, 'yyyy-MM-dd')
    const entry  = weekMap.get(key) ?? {
      label:            format(wStart, 'd/MM'),
      inflowReal:       0,
      outflowReal:      0,
      inflowProjetado:  0,
      outflowProjetado: 0,
      isProjected:      key > thisWeek,
    }
    if (isProj) {
      entry.inflowProjetado  += inflow
      entry.outflowProjetado += outflow
    } else {
      entry.inflowReal  += inflow
      entry.outflowReal += outflow
    }
    weekMap.set(key, entry)
  }

  for (let i = 59; i >= 0; i--) {
    const d    = subDays(today0, i)
    const data = histMap.get(format(d, 'yyyy-MM-dd')) ?? { inflow: 0, outflow: 0 }
    addToWeek(d, data.inflow, data.outflow, false)
  }
  for (let i = 1; i <= 90; i++) {
    const d    = addDays(today0, i)
    const data = projMap.get(format(d, 'yyyy-MM-dd')) ?? { inflow: 0, outflow: 0 }
    addToWeek(d, data.inflow, data.outflow, true)
  }

  const semanas: FluxoSemana[] = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, w]) => ({
      label:            w.label,
      inflowReal:       w.inflowReal,
      outflowReal:      w.outflowReal,
      inflowProjetado:  w.inflowProjetado,
      outflowProjetado: w.outflowProjetado,
      isProjected:      w.isProjected,
    }))

  // Compute projected balances
  const projBalance = (days: number) => {
    let entrada = 0, saida = 0
    for (let i = 1; i <= days; i++) {
      const daily = projMap.get(format(addDays(today0, i), 'yyyy-MM-dd')) ?? { inflow: 0, outflow: 0 }
      entrada += daily.inflow
      saida   += daily.outflow
    }
    return saldoAtual + entrada - saida
  }

  return {
    semanas,
    recorrencias,
    saldoAtual,
    saldoProjetado30d: projBalance(30),
    saldoProjetado60d: projBalance(60),
    saldoProjetado90d: projBalance(90),
  }
}
