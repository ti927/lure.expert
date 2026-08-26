'use server'

import { getAuthContext } from '@/lib/auth-context'

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { categories } from '@/db/schema'
import { eq, and, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { subDays, format, parseISO } from 'date-fns'
import type { DrillDownTransaction } from '@/lib/dre-types'
import { runQuery } from '@/lib/query/engine'
import { scopeFromSession } from '@/lib/query/scope'
import {
  calcularKpisDoMes, resolveMonthRange, TIPOS_SAIDA_CAIXA,
  type DashboardKPIs, type KPIValue,
} from '@/lib/dashboard/kpis'
import { calcularIndicadores, type FinancialIndicators } from '@/lib/dashboard/indicators'

// KPIs, indicadores e as listas de tipos MUDARAM DE CASA na 5.B para
// `src/lib/dashboard/` — o bloco de painel precisa deles fora de uma sessão
// HTTP. Aqui ficaram as cascas e o que é específico da tela (drill-down, que
// assina URLs pelo Storage).
export type { DashboardKPIs, KPIValue, FinancialIndicators }

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

/**
 * Os 4 KPIs do mês.
 *
 * O cálculo MUDOU DE CASA na 5.B para `lib/dashboard/kpis.ts` — o bloco
 * `alertas` do painel precisa dos mesmos números fora de uma sessão HTTP, e
 * duas cópias divergiriam na primeira mudança de regra. Aqui ficou a casca que
 * resolve a organização ativa.
 */
export async function getDashboardKPIs(referenceMonth?: string): Promise<DashboardKPIs> {
  const { organizationId } = await getAuthContext()
  return calcularKpisDoMes(organizationId, referenceMonth)
}

/**
 * Os 7 indicadores financeiros.
 *
 * Miolo em `lib/dashboard/indicators.ts` desde a 5.B, pelo mesmo motivo dos
 * KPIs: o bloco `indicador` do painel o consome direto.
 */
export async function getFinancialIndicators(referenceMonth?: string): Promise<FinancialIndicators> {
  const { organizationId } = await getAuthContext()
  return calcularIndicadores(organizationId, referenceMonth)
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
//
// `TIPOS_SAIDA_CAIXA` mudou de casa para `lib/dashboard/kpis.ts` na 5.B: o bloco
// de ranking do painel padrão monta o filtro a partir da MESMA lista.

/**
 * Top N categorias de despesa do mês.
 *
 * Passou a ser uma consulta do motor na Fase 1.3, e o `limite` deixou de estar
 * cravado no SQL — era literalmente `LIMIT 5`, e foi esse detalhe que motivou o
 * motor inteiro: trocar `agruparPor` para `unidade_de_negocio` agora responde
 * "top 5 UENs" sem função nova.
 *
 * Mudança de fonte junto: lê `transaction_lines` em vez de `transactions`, o que
 * corrige a atribuição de lançamentos rateados (a soma não muda, porque a
 * natureza não é rateada, mas a contagem passa a ser de lançamentos e não de
 * partes).
 */
export async function getTopExpenseCategories(
  referenceMonth?: string,
  limite = 5,
): Promise<TopExpenseCategory[]> {
  const { userId, organizationId } = await getAuthContext()
  const { curFrom, curTo } = resolveMonthRange(referenceMonth)

  const scope = await scopeFromSession(userId, organizationId)
  const resultado = await runQuery(scope, {
    fonte:      'realizado',
    medidas:    ['saidas', 'contagem'],
    agruparPor: ['categoria'],
    periodo:    { tipo: 'intervalo', de: curFrom, ate: curTo, regime: 'caixa' },
    // `direcao` filtra LINHAS, não só a medida. Sem ele, uma categoria que só
    // teve entrada no mês apareceria na lista com R$ 0,00 de saída, ocupando
    // uma das cinco vagas — a query original filtrava `direction = 'outflow'`
    // e por isso nunca a via.
    filtros: {
      direcao: 'outflow',
      tiposDeCategoria: [...TIPOS_SAIDA_CAIXA],
      visibilidade: 'caixa',
      excluirBalanco: true,
    },
    ordenarPor: [{ por: 'saidas', direcao: 'desc' }],
    limite,
  })

  const ids = resultado.linhas.map(l => l.chaves[0].id).filter((x): x is string => !!x)
  if (ids.length === 0) return []

  // A hierarquia que a tela mostra não é agregação — vem do plano de contas.
  const parent = alias(categories, 'parent')
  const hierarquia = await db
    .select({
      id: categories.id, name: categories.name, code: categories.code, type: categories.type,
      parentId: parent.id, parentName: parent.name, parentCode: parent.code,
    })
    .from(categories)
    .leftJoin(parent, eq(categories.parentId, parent.id))
    .where(and(eq(categories.organizationId, organizationId), inArray(categories.id, ids)))

  const porId = new Map(hierarquia.map(h => [h.id, h]))

  return resultado.linhas
    .map((l): TopExpenseCategory | null => {
      const id = l.chaves[0].id
      const h = id ? porId.get(id) : undefined
      if (!id || !h) return null
      return {
        categoryId:   id,
        categoryName: h.name,
        categoryCode: h.code,
        categoryType: h.type,
        parentId:     h.parentId,
        parentName:   h.parentName,
        parentCode:   h.parentCode,
        total:        l.medidas.saidas,
        txCount:      l.medidas.contagem,
      }
    })
    .filter((x): x is TopExpenseCategory => x !== null)
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

/**
 * Movimentação diária dos 90 dias que terminam no mês de referência.
 *
 * Migrada para o motor na Fase 1.3. Sem filtro de tipo — o gráfico mostra o
 * caixa como ele é, incluindo transferências e contas patrimoniais, então
 * `excluirBalanco` vai explicitamente `false` e a visibilidade fica em `todas`.
 * Os padrões do motor são mais restritivos que isso, e herdá-los mudaria o
 * gráfico em silêncio.
 *
 * O teto de 500 linhas do motor cabe: 90 dias.
 */
export async function getCashFlowChart(referenceMonth?: string): Promise<CashFlowDay[]> {
  const { userId, organizationId } = await getAuthContext()

  const { curTo } = resolveMonthRange(referenceMonth)
  const fromDate = format(subDays(parseISO(curTo), 89), 'yyyy-MM-dd')

  const scope = await scopeFromSession(userId, organizationId)
  const resultado = await runQuery(scope, {
    fonte:      'realizado',
    medidas:    ['entradas', 'saidas'],
    agruparPor: ['dia'],
    periodo:    { tipo: 'intervalo', de: fromDate, ate: curTo, regime: 'caixa' },
    filtros:    { excluirBalanco: false, visibilidade: 'todas' },
    ordenarPor: [{ por: 'dia', direcao: 'asc' }],
    limite:     500,
  })

  return resultado.linhas
    .filter(l => l.chaves[0].id !== null)
    .map(l => ({
      date:    l.chaves[0].id as string,
      inflow:  l.medidas.entradas,
      outflow: l.medidas.saidas,
    }))
}

