// Os 7 indicadores financeiros — o miolo de `getFinancialIndicators`, que
// MUDOU DE CASA na 5.B: o bloco `indicador` do painel e o bloco `alertas`
// precisam calculá-los fora de uma sessão HTTP. `server/dashboard.ts` é casca.
//
// Indicador NÃO é agregação do motor: são regras com limiares (liquidez,
// cobertura, endividamento). Forçá-los para dentro do engine exigiria que o
// SQL soubesse o que é "liquidez baixa" — por isso eles são a escotilha do
// block-spec, não uma query.

import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { resolveMonthRange, TIPOS_FORA_DO_RESULTADO } from './kpis'

type Exec = Pick<typeof db, 'execute'>

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

const lista = (tipos: readonly string[]) =>
  sql.join(tipos.map(t => sql`${t}`), sql`, `)

const TIPOS_DRE_EBITDA = [
  'receita_operacional', 'deducoes_tributarias', 'deducoes_operacionais', 'cpv', 'sga',
] as const

export async function calcularIndicadores(
  organizationId: string,
  referenceMonth?: string,
  exec: Exec = db,
): Promise<FinancialIndicators> {
  const { curFrom, curTo, from12m } = resolveMonthRange(referenceMonth)

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
    exec.execute<DreRow>(sql`
      SELECT
        COALESCE(SUM(CASE WHEN c.type = 'receita_operacional'
          THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
          ELSE 0 END), 0)::text AS receita_bruta,
        COALESCE(SUM(CASE WHEN c.type IN (${lista(TIPOS_DRE_EBITDA)})
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
    exec.execute<BpRow>(sql`
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
        AND t.date::date <= ${curTo}::date
    `),
    exec.execute<Lucro12mRow>(sql`
      SELECT
        COALESCE(SUM(CASE WHEN c.type NOT IN (${lista(TIPOS_FORA_DO_RESULTADO)})
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
