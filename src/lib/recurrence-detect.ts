// Detecção de recorrências — o que se repete no extrato.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ISTO MUDOU DE CASA
//
// Nasceu dentro de `server/fluxo.ts` para alimentar a projeção de 90 dias do
// `/fluxo`. Aquela projeção MORREU em 26/ago: adivinhar o futuro pela média dos
// intervalos passados era um substituto para o orçamento, e o orçamento existe
// desde a Fase 9 — com data de competência, data de caixa, versão e responsável.
// Uma projeção paralela, derivada de outra regra, só teria como resultado dois
// futuros diferentes na mesma tela.
//
// O que NÃO morreu é o outro consumidor: em `/orcamento`, "aceitar recorrências
// detectadas" (Sessão 9.5) usa esta lista para SUGERIR lançamentos a orçar. Ali
// a recorrência não prevê nada — ela preenche um formulário, e quem decide o
// valor, a categoria e os meses é a pessoa. É o oposto de substituir o
// orçamento: é atalho para escrevê-lo.
//
// Como o único chamador virou `server/budget.ts`, a função saiu de um arquivo
// `'use server'` (onde todo export é um endpoint HTTP) e virou função de `/lib`,
// que recebe a organização em vez de descobri-la pela sessão — e por isso pode
// ser exercitada direto contra o banco por um script.
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE A DETECÇÃO É, E O QUE ELA NÃO É
//
// Ela agrupa por DESCRIÇÃO normalizada, não por plano de contas — então não
// sabe categoria, e é por isso que `/orcamento` exige que o cliente escolha uma.
// A janela é de 180 dias, o intervalo aceito vai de 7 a 40 dias (semanal a
// mensal folgado), e exige ao menos 2 ocorrências.

import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { format, addDays, parseISO } from 'date-fns'

type Exec = Pick<typeof db, 'execute'>

export type RecorrenciaDetectada = {
  descricao: string
  direction: 'inflow' | 'outflow'
  valorMedio: number
  ultimaData: string
  /** Sempre FUTURA: a última ocorrência avançada pelo intervalo até passar de hoje. */
  proximaData: string
  intervaloMedioDias: number
  ocorrencias: number
}

type RecRow = {
  descricao: string
  direction: string
  avg_amount: string
  occurrences: string
  last_date: string
  avg_interval_days: string
  next_date: string
}

/**
 * As descrições que se repetem nos últimos 180 dias, com o intervalo médio e a
 * próxima data provável.
 *
 * Ordenadas por valor médio decrescente e limitadas a 20 — a lista existe para
 * ser lida por uma pessoa que vai decidir uma a uma, não para ser exaustiva.
 */
export async function detectarRecorrencias(
  organizationId: string,
  exec: Exec = db,
): Promise<RecorrenciaDetectada[]> {
  const today  = new Date()
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  const recRows = await exec.execute<RecRow>(sql`
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
  `)

  const recorrencias: RecorrenciaDetectada[] = []

  for (const r of recRows) {
    const intervalDias = Number(r.avg_interval_days)
    if (!intervalDias || intervalDias < 1) continue

    // A próxima data que o SQL calcula pode já ter passado (a última ocorrência
    // é de 80 dias atrás num ciclo de 30). Avança em passos inteiros de
    // intervalo até cair no futuro — quem consome precisa de uma data para
    // orçar, e uma data vencida não serve para lançamento nenhum.
    const tomorrow = addDays(today0, 1)
    let nextDate = parseISO(String(r.next_date))
    if (nextDate < tomorrow) {
      const msPerInterval = intervalDias * 86_400_000
      const stepsNeeded   = Math.ceil((tomorrow.getTime() - nextDate.getTime()) / msPerInterval)
      nextDate = addDays(nextDate, stepsNeeded * intervalDias)
    }
    if (nextDate < tomorrow) continue

    recorrencias.push({
      descricao:          String(r.descricao),
      direction:          r.direction as 'inflow' | 'outflow',
      valorMedio:         Number(r.avg_amount),
      ultimaData:         String(r.last_date),
      proximaData:        format(nextDate, 'yyyy-MM-dd'),
      intervaloMedioDias: intervalDias,
      ocorrencias:        Number(r.occurrences),
    })
  }

  return recorrencias
}
