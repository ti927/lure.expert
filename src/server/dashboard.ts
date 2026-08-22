'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships } from '@/db/schema'
import { eq, and, isNotNull, sql } from 'drizzle-orm'
import { startOfMonth, endOfMonth, subMonths, subDays, format, parseISO } from 'date-fns'
import type { DrillDownTransaction } from '@/lib/dre-types'

// Resolve uma referência de mês ('YYYY-MM' ou undefined) em todos os marcos
// usados pelas server actions do dashboard. Quando referenceMonth é inválido
// ou undefined, cai pro mês corrente.
function resolveMonthRange(referenceMonth?: string) {
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

export type TopExpenseCategory = {
  // Categoria-folha (Filho, ou Pai-sem-filhos quando a transação está direto nela).
  categoryId:   string
  categoryName: string
  categoryCode: string | null
  categoryType: string
  // Contexto: Natureza Pai. Null quando a categoria-folha já é uma Pai-sem-filhos.
  parentId:     string | null
  parentName:   string | null
  parentCode:   string | null
  total:        number
  txCount:      number
}

const expenseTypes = sql.raw(
  `'deducoes_tributarias','deducoes_operacionais','cpv','sga','resultado_financeiro','ir'`
)
// Tipos que representam saída de caixa "operacional + não-operacional" — usado pelo Top 5
// (que inclui financiamentos/investimentos como "despesa" no sentido colloquial), mas
// exclui transfers e BP (ver bpAndTransferTypes para a contraparte).
const cashOutflowTypes = sql.raw(
  `'deducoes_tributarias','deducoes_operacionais','cpv','sga','resultado_financeiro','ir','emprestimos_amortizacoes','investimentos_retiradas'`
)
const bpAndTransferTypes = sql.raw(
  `'transfer','ativo_circulante','ativo_nao_circulante','passivo_circulante','passivo_nao_circulante','patrimonio_liquido','emprestimos_amortizacoes','investimentos_retiradas'`
)

function pct(a: number, b: number): number | null {
  return b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null
}

export async function getDashboardKPIs(referenceMonth?: string): Promise<DashboardKPIs> {
  const { organizationId } = await getAuthContext()

  const { curFrom, curTo, prevFrom, prevTo } = resolveMonthRange(referenceMonth)

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

export async function getFinancialIndicators(referenceMonth?: string): Promise<FinancialIndicators> {
  const { organizationId } = await getAuthContext()

  const { curFrom, curTo, from12m } = resolveMonthRange(referenceMonth)

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
        AND t.date::date <= ${curTo}::date
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

// Top 5 categorias-folha (Filho) com maior SAÍDA de caixa no mês.
// - Inclui tipos DRE de despesa (sga, cpv, etc.) + emprestimos + investimentos
//   (saídas não-operacionais que o usuário também considera "despesa")
// - Exclui receita, transfer e BP
// - Conta SÓ outflows (não neta com inflows — assim financiamentos com receivement +
//   pagamento no mesmo mês não somem do top)
// - Respeita hide_in_cashflow (mesmo critério de /fluxo)
// Quando uma transação está classificada direto numa Pai-sem-filhos, a própria Pai
// aparece como categoria-folha (parentId fica null).
export async function getTopExpenseCategories(referenceMonth?: string): Promise<TopExpenseCategory[]> {
  const { organizationId } = await getAuthContext()

  const { curFrom, curTo } = resolveMonthRange(referenceMonth)

  type Row = {
    cat_id:      string
    cat_name:    string
    cat_code:    string | null
    cat_type:    string
    parent_id:   string | null
    parent_name: string | null
    parent_code: string | null
    total:       string
    tx_count:    string
  }

  const rows = await db.execute<Row>(sql`
    SELECT
      c.id::text       AS cat_id,
      c.name           AS cat_name,
      c.code           AS cat_code,
      c.type           AS cat_type,
      p.id::text       AS parent_id,
      p.name           AS parent_name,
      p.code           AS parent_code,
      SUM(t.amount::numeric)::text AS total,
      COUNT(*)::text               AS tx_count
    FROM transactions t
    JOIN categories c           ON t.category_id = c.id
    LEFT JOIN categories p      ON c.parent_id   = p.id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND t.direction = 'outflow'
      AND COALESCE(t.effective_date, t.date)::date >= ${curFrom}::date
      AND COALESCE(t.effective_date, t.date)::date <= ${curTo}::date
      AND c.type IN (${cashOutflowTypes})
      AND COALESCE(c.hide_in_cashflow, false) = false
    GROUP BY c.id, c.name, c.code, c.type, p.id, p.name, p.code
    ORDER BY SUM(t.amount::numeric) DESC
    LIMIT 5
  `)

  return rows.map(r => ({
    categoryId:   r.cat_id,
    categoryName: r.cat_name,
    categoryCode: r.cat_code,
    categoryType: r.cat_type,
    parentId:     r.parent_id,
    parentName:   r.parent_name,
    parentCode:   r.parent_code,
    total:        Number(r.total),
    txCount:      Number(r.tx_count),
  }))
}

// Drill-down para qualquer conjunto de categoryIds + range de datas. Usado pelo card
// Top 5 categorias do dashboard, mas é genérico — não filtra por document_id (≠ /balanco).
export async function getDashboardCategoryDrillDown(
  categoryIds: string[],
  dateRange:   { from: string; to: string },
): Promise<{ transactions: DrillDownTransaction[] }> {
  const { organizationId } = await getAuthContext()

  if (categoryIds.length === 0) return { transactions: [] }

  type TxRow = {
    id:                   string
    date:                 string
    description:          string
    direction:            string
    amount:               string
    category_id:          string | null
    category_name:        string | null
    category_type:        string | null
    parent_category_id:   string | null
    parent_category_name: string | null
    parent_category_type: string | null
    cost_center_id:       string | null
    cost_center_name:     string | null
    business_unit_id:     string | null
    business_unit_name:   string | null
    legal_entity_id:      string | null
    legal_entity_name:    string | null
    contact_id:           string | null
    contact_name:         string | null
    allocation_id:        string | null
    is_allocated:         boolean
    account_id:           string | null
    account_name:         string | null
    account_type:         string | null
    account_number:       string | null
    data_source_id:       string | null
    ds_metadata:          Record<string, unknown> | null
  }

  const result = await db.execute<TxRow>(sql`
    SELECT
      t.transaction_id::text   AS id,
      t.allocation_id::text    AS allocation_id,
      t.is_allocated           AS is_allocated,
      t.date                   AS date,
      t.description            AS description,
      t.direction              AS direction,
      t.amount::numeric        AS amount,
      t.category_id::text      AS category_id,
      c.name                   AS category_name,
      c.type                   AS category_type,
      p.id::text               AS parent_category_id,
      p.name                   AS parent_category_name,
      p.type                   AS parent_category_type,
      t.cost_center_id::text   AS cost_center_id,
      cc.name                  AS cost_center_name,
      t.business_unit_id::text AS business_unit_id,
      bu.name                  AS business_unit_name,
      t.legal_entity_id::text  AS legal_entity_id,
      le.name                  AS legal_entity_name,
      t.contact_id::text       AS contact_id,
      ct.name                  AS contact_name,
      t.account_id             AS account_id,
      t.account_name           AS account_name,
      t.account_type           AS account_type,
      t.account_number         AS account_number,
      t.data_source_id::text   AS data_source_id,
      ds.metadata              AS ds_metadata
    FROM transaction_lines t
    LEFT JOIN categories c      ON t.category_id      = c.id
    LEFT JOIN categories p      ON c.parent_id        = p.id
    LEFT JOIN cost_centers cc   ON t.cost_center_id   = cc.id
    LEFT JOIN business_units bu ON t.business_unit_id = bu.id
    LEFT JOIN legal_entities le ON t.legal_entity_id  = le.id
    LEFT JOIN contacts ct       ON t.contact_id       = ct.id
    LEFT JOIN data_sources ds   ON t.data_source_id   = ds.id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.category_id IN (${sql.join(categoryIds.map(id => sql`${id}::uuid`), sql`, `)})
      AND t.status NOT IN ('pending', 'duplicate')
      AND COALESCE(t.effective_date, t.date)::date >= ${dateRange.from}::date
      AND COALESCE(t.effective_date, t.date)::date <= ${dateRange.to}::date
    ORDER BY t.date DESC, t.created_at DESC
  `)

  // Signed URLs em batch para customLogoPath
  const customLogoByDs = new Map<string, string>()
  for (const r of result) {
    const meta = (r.ds_metadata ?? {}) as Record<string, unknown>
    const path = typeof meta.customLogoPath === 'string' ? meta.customLogoPath : null
    if (path && r.data_source_id && !customLogoByDs.has(r.data_source_id)) {
      customLogoByDs.set(r.data_source_id, path)
    }
  }
  const supabase = createClient()
  const signedEntries = await Promise.all(
    Array.from(customLogoByDs.entries()).map(async ([dsId, path]) => {
      const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
      return [dsId, data?.signedUrl ?? null] as const
    })
  )
  const signedMap = new Map(signedEntries)

  const transactions: DrillDownTransaction[] = result.map(r => {
    const amount = Number(r.amount)
    const meta = (r.ds_metadata ?? {}) as Record<string, unknown>
    const autoLogo = typeof meta.institutionImageUrl === 'string' ? meta.institutionImageUrl : null
    const customLogo = r.data_source_id ? signedMap.get(r.data_source_id) ?? null : null
    const badge = (meta.customBadge as { text?: string } | undefined)?.text || null

    const parentId   = r.parent_category_id   ?? r.category_id   ?? null
    const parentName = r.parent_category_name ?? r.category_name ?? null
    const parentType = r.parent_category_type ?? r.category_type ?? null

    return {
      id:                 r.id,
      date:               String(r.date),
      description:        r.description,
      direction:          r.direction,
      amount,
      netAmount:          r.direction === 'inflow' ? amount : -amount,
      categoryId:         r.category_id ?? null,
      categoryName:       r.category_name ?? null,
      costCenterId:       r.cost_center_id ?? null,
      costCenterName:     r.cost_center_name ?? null,
      businessUnitId:     r.business_unit_id ?? null,
      businessUnitName:   r.business_unit_name ?? null,
      legalEntityId:      r.legal_entity_id ?? null,
      legalEntityName:    r.legal_entity_name ?? null,
      contactId:          r.contact_id ?? null,
      contactName:        r.contact_name ?? null,
      allocationId:       r.allocation_id ?? null,
      isAllocated:        r.is_allocated === true,
      accountId:          r.account_id ?? null,
      accountName:        r.account_name ?? null,
      accountType:        r.account_type ?? null,
      accountNumber:      r.account_number ?? null,
      connectionLogoUrl:  customLogo ?? autoLogo,
      connectionBadge:    badge,
      parentCategoryId:   parentId,
      parentCategoryName: parentName,
      parentCategoryType: parentType,
    }
  })

  return { transactions }
}

export async function getCashFlowChart(referenceMonth?: string): Promise<CashFlowDay[]> {
  const { organizationId } = await getAuthContext()

  const { curTo } = resolveMonthRange(referenceMonth)
  const toDate   = curTo
  const fromDate = format(subDays(parseISO(curTo), 89), 'yyyy-MM-dd')

  type DayRow = { date: string; inflow: string; outflow: string }

  const rows = await db.execute<DayRow>(sql`
    SELECT
      COALESCE(t.effective_date, t.date)::date::text AS date,
      COALESCE(SUM(CASE WHEN t.direction = 'inflow'  THEN t.amount::numeric ELSE 0 END), 0)::text AS inflow,
      COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric ELSE 0 END), 0)::text AS outflow
    FROM transactions t
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND COALESCE(t.effective_date, t.date)::date >= ${fromDate}::date
      AND COALESCE(t.effective_date, t.date)::date <= ${toDate}::date
    GROUP BY COALESCE(t.effective_date, t.date)::date
    ORDER BY COALESCE(t.effective_date, t.date)::date ASC
  `)

  return rows.map(r => ({
    date:    String(r.date),
    inflow:  Number(r.inflow),
    outflow: Number(r.outflow),
  }))
}

