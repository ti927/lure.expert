// Copiar do realizado e duplicar versão — o miolo dos aceleradores.
//
// Fora de 'use server' pelo mesmo motivo de `budget-scope.ts`: é aqui que mora
// o que pode dar errado em silêncio (um mês somado duas vezes, um percentual
// aplicado no lugar errado, uma duplicação que apaga os ajustes manuais da
// versão de origem). Fora do 'use server', tudo isso pode ser exercitado direto
// contra o banco, sem sessão HTTP. As actions em `@/server/budget` são invólucros
// finos: autenticação, validação e revalidatePath.
//
// SERVER-ONLY: importa `db`. Nenhum componente client deve importar deste
// arquivo — os tipos que a UI precisa moram em `budget-types.ts`.
//
// ─── O mapeamento de meses ───────────────────────────────────────────────────
//
// Cada mês de origem vira o mês de MESMO NÚMERO no exercício de destino:
// mar/2026 → mar/2028, independentemente de quantos anos separam os dois. Não é
// por posição na lista — se o período começa em julho, julho continua sendo
// julho. É por isso que o período de origem é limitado a 12 meses: com 13, dois
// janeiros disputariam o mesmo alvo.
//
// ─── O percentual ────────────────────────────────────────────────────────────
//
// `adjustmentPct` é aplicado UMA vez sobre cada valor mensal (8 → ×1,08). Não
// vira `adjustment_rate` na série: aquele é o reajuste que se acumula ao longo
// do ano e é outra coisa. A série copiada nasce em modo 'fixo' ou 'sazonal'.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { budgetSeries, budgetEntries } from '@/db/schema'
import { expandSeries, round2, lastDayOfMonth, type RecurrenceInput } from './budget-recurrence'
import { BP_TYPES } from './dre-types'
import { money, type BudgetTx } from './budget-scope'
import type { AmountMode, CopyActualsInput, CopyGranularity, CopyShape } from './budget-types'

/** Uma linha do realizado agregada por (categoria, direção, dimensões, mês). */
export interface ActualMonthRow {
  categoryId:       string
  categoryName:     string
  categoryCode:     string | null
  direction:        'inflow' | 'outflow'
  costCenterId:     string | null
  costCenterName:   string | null
  businessUnitId:   string | null
  businessUnitName: string | null
  legalEntityId:    string | null
  legalEntityName:  string | null
  month:            string   // 'YYYY-MM' de ORIGEM
  total:            number   // sempre positivo — o sinal vem de `direction`
}

export interface CopyShapeOptions {
  fiscalYear:    number
  shape:         CopyShape
  granularity:   CopyGranularity
  adjustmentPct: number
}

/** O lançamento que será criado. Espelha os campos de `budget_series`. */
export interface CopiedSeriesDraft {
  description:     string
  direction:       'inflow' | 'outflow'
  categoryId:      string
  categoryName:    string
  categoryCode:    string | null
  costCenterId:    string | null
  businessUnitId:  string | null
  legalEntityId:   string | null
  dimensionLabel:  string | null
  startMonth:      string           // 'YYYY-MM'
  occurrences:     number
  intervalMonths:  number
  dayOfMonth:      number
  cashLagDays:     number
  amountMode:      AmountMode
  baseAmount:      number | null
  seasonalAmounts: number[] | null
  /** Realizado do grupo, antes do percentual — para a prévia poder mostrar os dois. */
  sourceTotal:     number
  /** Soma das ocorrências geradas, já com o percentual. */
  total:           number
}

interface Group {
  categoryId:       string
  categoryName:     string
  categoryCode:     string | null
  direction:        'inflow' | 'outflow'
  costCenterId:     string | null
  businessUnitId:   string | null
  legalEntityId:    string | null
  dimensionLabel:   string | null
  /** número do mês (1–12) → total do realizado naquele mês */
  byMonth:          Map<number, number>
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Agrupa o realizado e devolve os lançamentos a criar.
 *
 * Direção entra na chave de agrupamento de propósito. Compensar entrada com
 * saída dentro da mesma categoria produziria meses de sinal trocado — e uma
 * série tem uma direção só, com valor sempre positivo. Se uma categoria tem
 * estorno, saem dois lançamentos, e isso é a verdade do histórico.
 */
export function buildCopyDrafts(rows: ActualMonthRow[], opts: CopyShapeOptions): CopiedSeriesDraft[] {
  const factor = 1 + opts.adjustmentPct / 100
  const byDimension = opts.granularity === 'dimensoes'
  const groups = new Map<string, Group>()

  for (const r of rows) {
    const costCenterId   = byDimension ? r.costCenterId   : null
    const businessUnitId = byDimension ? r.businessUnitId : null
    const legalEntityId  = byDimension ? r.legalEntityId  : null

    const key = [r.categoryId, r.direction, costCenterId ?? '', businessUnitId ?? '', legalEntityId ?? ''].join('|')

    let group = groups.get(key)
    if (!group) {
      const labels = byDimension
        ? [r.costCenterName, r.businessUnitName, r.legalEntityName].filter((v): v is string => !!v)
        : []
      group = {
        categoryId:     r.categoryId,
        categoryName:   r.categoryName,
        categoryCode:   r.categoryCode,
        direction:      r.direction,
        costCenterId, businessUnitId, legalEntityId,
        dimensionLabel: labels.length ? labels.join(' · ') : null,
        byMonth:        new Map(),
      }
      groups.set(key, group)
    }

    // Soma em vez de atribuir: a agregação do banco já vem por mês, mas somar
    // aqui garante que nenhuma linha suma se a query mudar de forma.
    const month = Number(r.month.slice(5, 7))
    group.byMonth.set(month, (group.byMonth.get(month) ?? 0) + r.total)
  }

  const drafts: CopiedSeriesDraft[] = []

  // `Array.from` e não iteração direta: o tsconfig do projeto não liga
  // downlevelIteration, e percorrer um MapIterator quebra o build.
  for (const g of Array.from(groups.values())) {
    const sourceTotal = round2(Array.from(g.byMonth.values()).reduce((acc, v) => acc + v, 0))
    if (sourceTotal <= 0) continue

    const description = (g.dimensionLabel ? `${g.categoryName} · ${g.dimensionLabel}` : g.categoryName).slice(0, 200)

    const common = {
      description,
      direction:      g.direction,
      categoryId:     g.categoryId,
      categoryName:   g.categoryName,
      categoryCode:   g.categoryCode,
      costCenterId:   g.costCenterId,
      businessUnitId: g.businessUnitId,
      legalEntityId:  g.legalEntityId,
      dimensionLabel: g.dimensionLabel,
      intervalMonths: 1,
      dayOfMonth:     1,
      cashLagDays:    0,
      sourceTotal,
    }

    if (opts.shape === 'media') {
      const baseAmount = round2((sourceTotal * factor) / 12)
      if (baseAmount <= 0) continue
      drafts.push({
        ...common,
        startMonth:      `${opts.fiscalYear}-01`,
        occurrences:     12,
        amountMode:      'fixo',
        baseAmount,
        seasonalAmounts: null,
        total:           round2(baseAmount * 12),
      })
      continue
    }

    // ── Mês a mês ──
    // O intervalo vai do primeiro ao último mês COM movimento; meses vazios no
    // meio viram zero. Aparar as pontas evita ocorrências de R$ 0 em janeiro só
    // porque a categoria começou em setembro.
    const months = Array.from(g.byMonth.keys()).sort((a, b) => a - b)
    const first = months[0]
    const last  = months[months.length - 1]
    const span  = last - first + 1

    const values = Array.from({ length: span }, (_, i) => round2((g.byMonth.get(first + i) ?? 0) * factor))
    const uniform = values.every(v => v === values[0])

    drafts.push({
      ...common,
      startMonth:      `${opts.fiscalYear}-${pad(first)}`,
      occurrences:     span,
      // Valores todos iguais viram 'fixo': o usuário edita um número só depois,
      // em vez de N campos que dizem a mesma coisa.
      amountMode:      uniform ? 'fixo' : 'sazonal',
      baseAmount:      uniform ? values[0] : null,
      seasonalAmounts: uniform ? null : values,
      total:           round2(values.reduce((acc, v) => acc + v, 0)),
    })
  }

  return drafts.sort((a, b) =>
    a.direction !== b.direction
      ? (a.direction === 'inflow' ? -1 : 1)
      : a.description.localeCompare(b.description, 'pt-BR'),
  )
}

/** Quantos meses o período de origem cobre. Usado na validação e na prévia. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty * 12 + tm) - (fy * 12 + fm) + 1
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEITURA DO REALIZADO
// ═══════════════════════════════════════════════════════════════════════════════

const BP_LIST = sql.raw(BP_TYPES.map(t => `'${t}'`).join(', '))

/**
 * `db` ou uma transação. As leituras aceitam os dois para que o teste possa
 * semear dados numa transação revertida e enxergá-los — com `db` fixo, a leitura
 * cairia fora da transação e não veria nada do que o próprio teste criou.
 */
export type BudgetReader = Pick<typeof db, 'execute'>

/** 'YYYY-MM' → primeiro e último dia do mês, sem `new Date` (fuso). */
export function monthBounds(from: string, to: string): { fromDate: string; toDate: string } {
  const [ty, tm] = to.split('-').map(Number)
  return {
    fromDate: `${from}-01`,
    toDate:   `${to}-${String(lastDayOfMonth(ty, tm)).padStart(2, '0')}`,
  }
}

/**
 * Lê o realizado do período com EXATAMENTE as mesmas regras do lado realizado da
 * `getBudgetVsActual` — mesmo INNER JOIN em categories e no pai (o que garante
 * folha), mesma exclusão de BP_TYPES, `status NOT IN ('pending','duplicate')` e
 * a coluna de visibilidade do regime. Só assim "copiei o realizado" e "o
 * realizado que a comparação mostra" são o mesmo número.
 *
 * Uma diferença deliberada: categoria inativa fica de fora. Copiá-la criaria um
 * lançamento que a própria tela de edição recusaria salvar depois. O valor
 * excluído volta em `inativas` para ser declarado na prévia, nunca sumir calado.
 */
export async function collectActuals(
  client: BudgetReader,
  organizationId: string,
  input: CopyActualsInput,
) {
  const { fromDate, toDate } = monthBounds(input.sourceFrom, input.sourceTo)

  const txDate  = input.regime === 'caixa' ? sql`COALESCE(t.effective_date, t.date)` : sql`t.date`
  const hideCol = input.regime === 'caixa' ? sql`c.hide_in_cashflow` : sql`c.hide_in_dre`

  type Row = {
    category_id:        string
    category_name:      string
    category_code:      string | null
    direction:          string
    cost_center_id:     string | null
    cost_center_name:   string | null
    business_unit_id:   string | null
    business_unit_name: string | null
    legal_entity_id:    string | null
    legal_entity_name:  string | null
    month:              string
    total:              string
  }

  // Sequencial, não Promise.all: numa transação o cliente tem uma conexão só,
  // e disparar as três em paralelo depende de pipelining para não se atropelar.
  const rows = await client.execute<Row>(sql`
      SELECT
        c.id::text               AS category_id,
        c.name                   AS category_name,
        c.code                   AS category_code,
        t.direction              AS direction,
        t.cost_center_id::text   AS cost_center_id,
        cc.name                  AS cost_center_name,
        t.business_unit_id::text AS business_unit_id,
        bu.name                  AS business_unit_name,
        t.legal_entity_id::text  AS legal_entity_id,
        le.name                  AS legal_entity_name,
        TO_CHAR(DATE_TRUNC('month', ${txDate}::date), 'YYYY-MM') AS month,
        SUM(t.amount::numeric) AS total
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      JOIN categories p ON c.parent_id   = p.id
      LEFT JOIN cost_centers cc   ON t.cost_center_id   = cc.id
      LEFT JOIN business_units bu ON t.business_unit_id = bu.id
      LEFT JOIN legal_entities le ON t.legal_entity_id  = le.id
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.status NOT IN ('pending', 'duplicate')
        AND ${txDate}::date >= ${fromDate}::date
        AND ${txDate}::date <= ${toDate}::date
        AND c.type NOT IN (${BP_LIST})
        AND ${hideCol} = false
        AND c.is_active = true
      GROUP BY c.id, c.name, c.code, t.direction,
               t.cost_center_id, cc.name, t.business_unit_id, bu.name,
               t.legal_entity_id, le.name,
               DATE_TRUNC('month', ${txDate}::date)
    `)

  const semCat = await client.execute<{ count: number; total: string }>(sql`
      SELECT COUNT(*)::int AS count, COALESCE(SUM(t.amount::numeric), 0) AS total
      FROM transactions t
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.status NOT IN ('pending', 'duplicate')
        AND t.category_id IS NULL
        AND ${txDate}::date >= ${fromDate}::date
        AND ${txDate}::date <= ${toDate}::date
    `)

  const inativas = await client.execute<{ count: number; total: string }>(sql`
      SELECT COUNT(*)::int AS count, COALESCE(SUM(t.amount::numeric), 0) AS total
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      JOIN categories p ON c.parent_id   = p.id
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.status NOT IN ('pending', 'duplicate')
        AND ${txDate}::date >= ${fromDate}::date
        AND ${txDate}::date <= ${toDate}::date
        AND c.type NOT IN (${BP_LIST})
        AND ${hideCol} = false
        AND c.is_active = false
    `)

  const actuals: ActualMonthRow[] = rows.map(r => ({
    categoryId:       r.category_id,
    categoryName:     r.category_name,
    categoryCode:     r.category_code,
    direction:        r.direction as 'inflow' | 'outflow',
    costCenterId:     r.cost_center_id,
    costCenterName:   r.cost_center_name,
    businessUnitId:   r.business_unit_id,
    businessUnitName: r.business_unit_name,
    legalEntityId:    r.legal_entity_id,
    legalEntityName:  r.legal_entity_name,
    month:            r.month,
    total:            Number(r.total),
  }))

  return {
    actuals,
    semCategoria: { count: Number(semCat[0]?.count ?? 0), total: Number(semCat[0]?.total ?? 0) },
    inativas:     { count: Number(inativas[0]?.count ?? 0), total: Number(inativas[0]?.total ?? 0) },
  }
}

/** O que já foi copiado antes para esta versão — alimenta a opção de substituir. */
export async function countCopiedSeries(client: BudgetReader, versionId: string) {
  const [row] = await client.execute<{ series: number; total: string }>(sql`
    SELECT
      (SELECT COUNT(*) FROM budget_series s
        WHERE s.version_id = ${versionId}::uuid AND s.source = 'copia_realizado')::int AS series,
      COALESCE((SELECT SUM(e.amount) FROM budget_entries e
                  JOIN budget_series s ON e.series_id = s.id
                 WHERE s.version_id = ${versionId}::uuid AND s.source = 'copia_realizado'), 0) AS total
  `)
  return { series: Number(row?.series ?? 0), total: Number(row?.total ?? 0) }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRAVAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

/** Ocorrências por INSERT. O teto real é o de parâmetros do Postgres (65535). */
const ENTRY_INSERT_CHUNK = 500

export function draftToRecurrence(d: CopiedSeriesDraft): RecurrenceInput {
  return {
    startMonth:      d.startMonth,
    occurrences:     d.occurrences,
    intervalMonths:  d.intervalMonths,
    dayOfMonth:      d.dayOfMonth,
    cashLagDays:     d.cashLagDays,
    amountMode:      d.amountMode,
    baseAmount:      d.baseAmount,
    totalAmount:     null,
    adjustmentRate:  null,
    adjustmentEvery: 1,
    seasonalAmounts: d.seasonalAmounts,
  }
}

/**
 * Grava os lançamentos copiados.
 *
 * Nenhuma ocorrência nasce ajustada: o percentual está embutido no valor da
 * REGRA, não é um override por ocorrência. `adjusted_fields` fica vazio e uma
 * edição em lote posterior funciona normalmente.
 *
 * As ocorrências saem de `expandSeries`, a mesma expansão do caminho manual —
 * um lançamento copiado e um digitado à mão com os mesmos parâmetros produzem
 * exatamente as mesmas linhas.
 */
export async function applyCopyToBudget(
  tx: BudgetTx,
  params: {
    organizationId: string
    versionId:      string
    userId:         string | null
    drafts:         CopiedSeriesDraft[]
    notes:          string
    replaceExisting: boolean
  },
): Promise<{ series: number; entries: number; replaced: number }> {
  const { organizationId, versionId, userId, drafts, notes } = params

  let replaced = 0
  if (params.replaceExisting) {
    const gone = await tx.execute<{ id: string }>(sql`
      DELETE FROM budget_series
      WHERE organization_id = ${organizationId}::uuid
        AND version_id      = ${versionId}::uuid
        AND source          = 'copia_realizado'
      RETURNING id::text AS id
    `)
    replaced = gone.length
  }

  // O id sai daqui para que séries e ocorrências entrem em INSERTs em lote,
  // sem um round trip por lançamento.
  const withIds = drafts.map(d => ({ id: randomUUID(), draft: d }))

  const entryRows = withIds.flatMap(({ id, draft }) =>
    expandSeries(draftToRecurrence(draft)).map(e => ({
      organizationId,
      versionId,
      seriesId:       id,
      sequence:       e.sequence,
      description:    draft.description,
      direction:      draft.direction,
      categoryId:     draft.categoryId,
      costCenterId:   draft.costCenterId,
      businessUnitId: draft.businessUnitId,
      legalEntityId:  draft.legalEntityId,
      contactId:      null,
      competenceDate: e.competenceDate,
      cashDate:       e.cashDate,
      amount:         money(e.amount),
    })),
  )

  if (withIds.length > 0) {
    await tx.insert(budgetSeries).values(withIds.map(({ id, draft }) => ({
      id,
      organizationId,
      versionId,
      description:     draft.description,
      direction:       draft.direction,
      categoryId:      draft.categoryId,
      costCenterId:    draft.costCenterId,
      businessUnitId:  draft.businessUnitId,
      legalEntityId:   draft.legalEntityId,
      contactId:       null,
      startMonth:      `${draft.startMonth}-01`,
      occurrences:     draft.occurrences,
      intervalMonths:  draft.intervalMonths,
      dayOfMonth:      draft.dayOfMonth,
      cashLagDays:     draft.cashLagDays,
      amountMode:      draft.amountMode,
      baseAmount:      draft.baseAmount === null ? null : money(draft.baseAmount),
      totalAmount:     null,
      adjustmentRate:  null,
      adjustmentEvery: 1,
      seasonalAmounts: draft.seasonalAmounts,
      source:          'copia_realizado' as const,
      notes,
      createdByUserId: userId,
    })))

    for (let i = 0; i < entryRows.length; i += ENTRY_INSERT_CHUNK) {
      await tx.insert(budgetEntries).values(entryRows.slice(i, i + ENTRY_INSERT_CHUNK))
    }
  }

  return { series: withIds.length, entries: entryRows.length, replaced }
}

/**
 * Duplica uma versão inteira, num statement só.
 *
 * O mapa id-antigo → id-novo é materializado em `mapped`: `RETURNING` não
 * devolve o id de origem, então gerar o uuid novo junto da leitura é o que
 * permite ligar cada ocorrência à série certa. `MATERIALIZED` é OBRIGATÓRIO —
 * `gen_random_uuid()` avaliado de novo na segunda referência daria ids
 * diferentes e as ocorrências apontariam para o nada.
 *
 * `adjusted_fields` e `sequence` são COPIADOS, nunca regenerados. Regenerar
 * apagaria em silêncio todo ajuste manual da versão de origem — que é
 * exatamente o trabalho que a duplicação existe para preservar.
 */
export async function applyDuplicateVersion(
  tx: BudgetTx,
  params: {
    organizationId: string
    sourceId:       string
    name:           string
    fiscalYear:     number
    description:    string | null
    isActive:       boolean
    userId:         string | null
    delta:          number
  },
): Promise<{ versionId: string; series: number; entries: number }> {
  const { organizationId, sourceId, name, fiscalYear, description, isActive, userId, delta } = params

  const [result] = await tx.execute<{ version_id: string; series_copied: number; entries_copied: number }>(sql`
    WITH nv AS (
      INSERT INTO budget_versions
        (organization_id, name, fiscal_year, status, is_active, description,
         source_version_id, created_by_user_id)
      VALUES (
        ${organizationId}::uuid, ${name}, ${fiscalYear}::int, 'rascunho',
        ${isActive}, ${description},
        ${sourceId}::uuid, ${userId}::uuid
      )
      RETURNING id
    ),
    mapped AS MATERIALIZED (
      SELECT s.*, gen_random_uuid() AS new_id
      FROM budget_series s
      WHERE s.organization_id = ${organizationId}::uuid
        AND s.version_id      = ${sourceId}::uuid
    ),
    ins_series AS (
      INSERT INTO budget_series (
        id, organization_id, version_id, description, direction,
        category_id, cost_center_id, business_unit_id, legal_entity_id, contact_id,
        start_month, occurrences, interval_months, day_of_month, cash_lag_days,
        amount_mode, base_amount, total_amount, adjustment_rate, adjustment_every,
        seasonal_amounts, source, notes, created_by_user_id, metadata
      )
      SELECT
        m.new_id, m.organization_id, (SELECT id FROM nv), m.description, m.direction,
        m.category_id, m.cost_center_id, m.business_unit_id, m.legal_entity_id, m.contact_id,
        -- make_interval também resolve o 29/02: +1 ano em 29/02 cai em 28/02.
        (m.start_month + make_interval(years => ${delta}::int))::date,
        m.occurrences, m.interval_months, m.day_of_month, m.cash_lag_days,
        m.amount_mode, m.base_amount, m.total_amount, m.adjustment_rate, m.adjustment_every,
        m.seasonal_amounts, 'duplicacao', m.notes, ${userId}::uuid, m.metadata
      FROM mapped m
      RETURNING id
    ),
    ins_entries AS (
      INSERT INTO budget_entries (
        organization_id, version_id, series_id, sequence, description, direction,
        category_id, cost_center_id, business_unit_id, legal_entity_id, contact_id,
        competence_date, cash_date, amount, adjusted_fields, notes, metadata
      )
      SELECT
        e.organization_id, (SELECT id FROM nv), m.new_id, e.sequence, e.description, e.direction,
        e.category_id, e.cost_center_id, e.business_unit_id, e.legal_entity_id, e.contact_id,
        (e.competence_date + make_interval(years => ${delta}::int))::date,
        -- O prazo de caixa é preservado em DIAS, não deslocado por ano: o lag é
        -- a regra de negócio ("recebo em 30 dias") e a data é consequência dela.
        ((e.competence_date + make_interval(years => ${delta}::int))::date
          + (e.cash_date - e.competence_date)),
        e.amount, e.adjusted_fields, e.notes, e.metadata
      FROM budget_entries e
      JOIN mapped m ON m.id = e.series_id
      RETURNING id
    )
    SELECT
      (SELECT id FROM nv)::text               AS version_id,
      (SELECT COUNT(*) FROM ins_series)::int   AS series_copied,
      (SELECT COUNT(*) FROM ins_entries)::int  AS entries_copied
  `)

  return {
    versionId: result.version_id,
    series:    Number(result.series_copied),
    entries:   Number(result.entries_copied),
  }
}
