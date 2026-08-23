'use server'

import { db } from '@/db'
import { memberships } from '@/db/schema'
import { sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { eq, and, isNotNull } from 'drizzle-orm'
import { DEFAULT_USD_BRL } from '@/lib/ai-pricing'

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

export interface ConsumoMes {
  mes:        string   // 'YYYY-MM'
  chamadas:   number
  tokensIn:   number
  tokensOut:  number
  custoUsd:   number
}

export interface ConsumoPorTipo {
  tipo:      string
  chamadas:  number
  tokensIn:  number
  tokensOut: number
  custoUsd:  number
}

export interface ConsumoResumo {
  mesAtual:      ConsumoMes | null
  meses:         ConsumoMes[]
  porTipo:       ConsumoPorTipo[]
  totalUsd:      number
  taxaUsdBrl:    number
  /** Alguma chamada usou modelo fora da tabela de preços — o total está subestimado. */
  temPrecoDesconhecido: boolean
  primeiroRegistro: string | null
}

/**
 * Consumo de IA da organização, lido de `agent_events`.
 *
 * A tabela existia desde a Fase 1 com a coluna `cost_usd` comentada como "base
 * para análise interna de custo por cliente" — e **nunca teve um leitor**. Esta
 * é a primeira função que a consulta.
 *
 * Usa o índice `idx_agent_events_org_time` que já existe. Filtra por
 * `cost_usd IS NOT NULL` porque a tabela também recebe eventos sem custo (a
 * Fase 3 vai gravar preview e confirmação de MCP ali).
 */
export async function getConsumoIa(meses = 12): Promise<ConsumoResumo> {
  const { organizationId } = await getAuthContext()

  const porMes = await db.execute<{
    mes: string; chamadas: number; t_in: number; t_out: number; usd: string
  }>(sql`
    SELECT
      TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM')  AS mes,
      COUNT(*)::int                                        AS chamadas,
      COALESCE(SUM(tokens_input), 0)::int                  AS t_in,
      COALESCE(SUM(tokens_output), 0)::int                 AS t_out,
      COALESCE(SUM(cost_usd), 0)::text                     AS usd
    FROM agent_events
    WHERE organization_id = ${organizationId}::uuid
      AND cost_usd IS NOT NULL
      AND created_at >= DATE_TRUNC('month', now()) - (${meses}::int - 1) * INTERVAL '1 month'
    GROUP BY 1
    ORDER BY 1 DESC
  `)

  const porTipo = await db.execute<{
    tipo: string; chamadas: number; t_in: number; t_out: number; usd: string
  }>(sql`
    SELECT
      type                                  AS tipo,
      COUNT(*)::int                         AS chamadas,
      COALESCE(SUM(tokens_input), 0)::int   AS t_in,
      COALESCE(SUM(tokens_output), 0)::int  AS t_out,
      COALESCE(SUM(cost_usd), 0)::text      AS usd
    FROM agent_events
    WHERE organization_id = ${organizationId}::uuid
      AND cost_usd IS NOT NULL
      AND created_at >= DATE_TRUNC('month', now())
    GROUP BY 1
    ORDER BY 5 DESC
  `)

  const geral = await db.execute<{ usd: string; desconhecido: boolean; primeiro: string | null }>(sql`
    SELECT
      COALESCE(SUM(cost_usd), 0)::text                                     AS usd,
      COALESCE(BOOL_OR(payload->>'precoDesconhecido' = 'true'), false)     AS desconhecido,
      MIN(created_at)::date::text                                          AS primeiro
    FROM agent_events
    WHERE organization_id = ${organizationId}::uuid
      AND cost_usd IS NOT NULL
  `)

  const linhas: ConsumoMes[] = porMes.map(r => ({
    mes: r.mes, chamadas: Number(r.chamadas),
    tokensIn: Number(r.t_in), tokensOut: Number(r.t_out),
    custoUsd: Number(r.usd),
  }))

  const mesCorrente = new Date().toISOString().slice(0, 7)

  return {
    mesAtual: linhas.find(l => l.mes === mesCorrente) ?? null,
    meses:    linhas,
    porTipo:  porTipo.map(r => ({
      tipo: r.tipo, chamadas: Number(r.chamadas),
      tokensIn: Number(r.t_in), tokensOut: Number(r.t_out),
      custoUsd: Number(r.usd),
    })),
    totalUsd:   Number(geral[0]?.usd ?? 0),
    taxaUsdBrl: DEFAULT_USD_BRL,
    temPrecoDesconhecido: geral[0]?.desconhecido === true,
    primeiroRegistro: geral[0]?.primeiro ?? null,
  }
}
