'use server'

// Server actions do módulo de Orçamento.
//
// ─── Duas convenções que valem para o arquivo inteiro ────────────────────────
//
// SINAL:  `amount` é SEMPRE positivo; o sinal vem de `direction`, idêntico a
//         `transactions`. Na comparação orçado × realizado (sessão 9.2), com
//         netAmount (despesa negativa), `variação = realizado − orcado` já é
//         "favorável quando positivo" para receita E para despesa. Não inverter
//         sinal por tipo de conta — é o erro mais provável deste módulo.
//
// INVARIANTE: `budget_entries` é a única fonte de verdade para qualquer número
//         exibido. `budget_series` é gerador + defaults. Nenhuma leitura
//         consolidada recomputa a série — o total do ano vem sempre do SUM das
//         entries, nunca de `seriesRuleTotal`.
//
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  budgetVersions,
  budgetSeries,
  budgetEntries,
  categories,
  costCenters,
  businessUnits,
  legalEntities,
  contacts,
} from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { getAuthContext } from '@/lib/auth-context'
import {
  budgetVersionInputSchema,
  budgetSeriesInputSchema,
  budgetEntryUpdateSchema,
  copyActualsInputSchema,
  duplicateVersionInputSchema,
  recurrenceChoiceSchema,
  BUDGET_STATUSES,
  type RecurrenceChoice,
  type CopyActualsInput,
  type CopyActualsPreview,
  type DuplicateVersionInput,
  type BudgetVersionInput,
  type BudgetSeriesInput,
  type BudgetEntryUpdate,
  type BudgetStatus,
  type BudgetVersionListItem,
  type BudgetSeriesListItem,
  type BudgetEntryListItem,
  type AdjustableField,
  type AmountMode,
  type BudgetRegime,
  type BudgetVsActualFilters,
  type BudgetVsActualRow,
  type BudgetVsActualData,
  type BudgetDrillDownEntry,
  type EditScope,
  type SeriesUpdateOptions,
  type SeriesUpdatePreview,
  type SeriesDeletePreview,
} from '@/lib/budget-types'
import { BP_TYPES, type DreType } from '@/lib/dre-types'
import { generateMonthRange } from '@/lib/dre-calc'
import { dimensionFilters } from '@/lib/sql-dimensions'
import { expandSeries, fitsInFiscalYear, type RecurrenceInput } from '@/lib/budget-recurrence'
import {
  buildCopyDrafts, monthsBetween, collectActuals, countSeriesBySource,
  applyDraftsToBudget, applyDuplicateVersion, type CopiedSeriesDraft,
} from '@/lib/budget-copy'
import {
  fetchBudgetRows, fetchForaDoHorizonte, type BudgetPeriodRow,
} from '@/lib/budget-read'
import {
  parseBudgetCsv, buildRecurrenceCandidates, recurrenceToDraft, norm,
  type BudgetCsvLookups, type BudgetCsvParseResult, type LeafCategoryInfo,
  type RecurrenceCandidate,
} from '@/lib/budget-import'
import {
  planSeriesUpdate, applySeriesUpdate, applySeriesDelete, diffAdjustedFields, money,
  type SeriesRow, type EntryRow,
} from '@/lib/budget-scope'
import { monthLabel } from '@/lib/format'
import { getFluxoData } from '@/server/fluxo'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Confere que cada FK recebida do cliente pertence à organização.
 * Guarda multi-tenant obrigatório: o `db` conecta num papel que ignora RLS.
 */
async function validateTargetsBelongToOrg(
  organizationId: string,
  t: {
    categoryId: string
    costCenterId: string | null
    businessUnitId: string | null
    legalEntityId: string | null
    contactId: string | null
  },
): Promise<string | null> {
  const [cat] = await db
    .select({ id: categories.id, parentId: categories.parentId, isActive: categories.isActive })
    .from(categories)
    .where(and(eq(categories.id, t.categoryId), eq(categories.organizationId, organizationId)))
    .limit(1)

  if (!cat) return 'Categoria não encontrada nesta organização.'
  if (!cat.parentId) return 'Escolha uma natureza filho (folha) — naturezas pai não recebem lançamento.'
  if (!cat.isActive) return 'Essa categoria está inativa. Reative-a ou escolha outra.'

  const checks: Array<Promise<string | null>> = []

  if (t.costCenterId) {
    checks.push(db.select({ id: costCenters.id }).from(costCenters)
      .where(and(eq(costCenters.id, t.costCenterId), eq(costCenters.organizationId, organizationId))).limit(1)
      .then(r => (r.length ? null : 'Centro de custo não encontrado nesta organização.')))
  }
  if (t.businessUnitId) {
    checks.push(db.select({ id: businessUnits.id }).from(businessUnits)
      .where(and(eq(businessUnits.id, t.businessUnitId), eq(businessUnits.organizationId, organizationId))).limit(1)
      .then(r => (r.length ? null : 'Unidade de negócio não encontrada nesta organização.')))
  }
  if (t.legalEntityId) {
    checks.push(db.select({ id: legalEntities.id }).from(legalEntities)
      .where(and(eq(legalEntities.id, t.legalEntityId), eq(legalEntities.organizationId, organizationId))).limit(1)
      .then(r => (r.length ? null : 'Entidade jurídica não encontrada nesta organização.')))
  }
  if (t.contactId) {
    checks.push(db.select({ id: contacts.id }).from(contacts)
      .where(and(eq(contacts.id, t.contactId), eq(contacts.organizationId, organizationId))).limit(1)
      .then(r => (r.length ? null : 'Contato não encontrado nesta organização.')))
  }

  const results = await Promise.all(checks)
  return results.find(Boolean) ?? null
}

interface EditableVersion {
  id:         string
  fiscalYear: number
  status:     string
  name:       string
}

/** Versão arquivada é somente-leitura — trava na action, não no banco (reversível). */
async function loadEditableVersion(
  organizationId: string,
  versionId: string,
): Promise<{ error: string } | { version: EditableVersion }> {
  const [version] = await db
    .select({
      id: budgetVersions.id,
      fiscalYear: budgetVersions.fiscalYear,
      status: budgetVersions.status,
      name: budgetVersions.name,
    })
    .from(budgetVersions)
    .where(and(eq(budgetVersions.id, versionId), eq(budgetVersions.organizationId, organizationId)))
    .limit(1)

  if (!version) return { error: 'Versão de orçamento não encontrada.' as const }
  if (version.status === 'arquivado') {
    return { error: 'Esta versão está arquivada e não pode ser alterada. Duplique-a para trabalhar em cima dela.' as const }
  }
  return { version }
}

/** Os campos de recorrência que `expandSeries` consome, a partir da linha do banco. */
function toRecurrenceInput(row: {
  startMonth: string
  occurrences: number
  intervalMonths: number
  dayOfMonth: number
  cashLagDays: number
  amountMode: string
  baseAmount: string | null
  totalAmount: string | null
  adjustmentRate: string | null
  adjustmentEvery: number
  seasonalAmounts: unknown
}): RecurrenceInput {
  return {
    startMonth: row.startMonth.slice(0, 7),
    occurrences: row.occurrences,
    intervalMonths: row.intervalMonths,
    dayOfMonth: row.dayOfMonth,
    cashLagDays: row.cashLagDays,
    amountMode: row.amountMode as AmountMode,
    baseAmount: row.baseAmount === null ? null : Number(row.baseAmount),
    totalAmount: row.totalAmount === null ? null : Number(row.totalAmount),
    adjustmentRate: row.adjustmentRate === null ? null : Number(row.adjustmentRate),
    adjustmentEvery: row.adjustmentEvery,
    seasonalAmounts: Array.isArray(row.seasonalAmounts) ? (row.seasonalAmounts as number[]) : null,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERSÕES
// ═══════════════════════════════════════════════════════════════════════════════

export async function listBudgetVersions(): Promise<BudgetVersionListItem[]> {
  const { organizationId } = await getAuthContext()

  type Row = {
    id: string
    name: string
    fiscal_year: number
    status: string
    is_active: boolean
    description: string | null
    series_count: number
    entry_count: number
    total_inflow: string
    total_outflow: string
    created_at: string
  }

  const rows = await db.execute<Row>(sql`
    SELECT
      v.id::text                AS id,
      v.name                    AS name,
      v.fiscal_year             AS fiscal_year,
      v.status                  AS status,
      v.is_active               AS is_active,
      v.description             AS description,
      (SELECT COUNT(*) FROM budget_series  s WHERE s.version_id = v.id)::int AS series_count,
      (SELECT COUNT(*) FROM budget_entries e WHERE e.version_id = v.id)::int AS entry_count,
      COALESCE((SELECT SUM(e.amount) FROM budget_entries e
                 WHERE e.version_id = v.id AND e.direction = 'inflow'), 0)   AS total_inflow,
      COALESCE((SELECT SUM(e.amount) FROM budget_entries e
                 WHERE e.version_id = v.id AND e.direction = 'outflow'), 0)  AS total_outflow,
      v.created_at::text        AS created_at
    FROM budget_versions v
    WHERE v.organization_id = ${organizationId}::uuid
    ORDER BY v.fiscal_year DESC, v.is_active DESC, v.created_at DESC
  `)

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    fiscalYear: Number(r.fiscal_year),
    status: r.status as BudgetStatus,
    isActive: r.is_active,
    description: r.description,
    seriesCount: Number(r.series_count),
    entryCount: Number(r.entry_count),
    totalInflow: Number(r.total_inflow),
    totalOutflow: Number(r.total_outflow),
    createdAt: r.created_at,
  }))
}

export async function createBudgetVersion(input: BudgetVersionInput) {
  const { organizationId, userId } = await getAuthContext()
  const parsed = budgetVersionInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { name, fiscalYear, description } = parsed.data

  const [dup] = await db
    .select({ id: budgetVersions.id })
    .from(budgetVersions)
    .where(and(
      eq(budgetVersions.organizationId, organizationId),
      eq(budgetVersions.fiscalYear, fiscalYear),
      sql`lower(btrim(${budgetVersions.name})) = lower(btrim(${name}))`,
    ))
    .limit(1)
  if (dup) return { error: `Já existe uma versão chamada "${name}" no exercício de ${fiscalYear}.` }

  // A primeira versão do exercício já nasce vigente — sem isso a tela de
  // comparação não tem o que mostrar e o usuário fica sem pista do que fazer.
  const [existingActive] = await db
    .select({ id: budgetVersions.id })
    .from(budgetVersions)
    .where(and(
      eq(budgetVersions.organizationId, organizationId),
      eq(budgetVersions.fiscalYear, fiscalYear),
      eq(budgetVersions.isActive, true),
    ))
    .limit(1)

  const [created] = await db
    .insert(budgetVersions)
    .values({
      organizationId,
      name,
      fiscalYear,
      description,
      isActive: !existingActive,
      createdByUserId: userId,
    })
    .returning({ id: budgetVersions.id })

  revalidatePath('/orcamento')
  return { success: true as const, id: created.id }
}

export async function setActiveBudgetVersion(versionId: string) {
  const { organizationId } = await getAuthContext()

  const [version] = await db
    .select({ id: budgetVersions.id, fiscalYear: budgetVersions.fiscalYear, status: budgetVersions.status })
    .from(budgetVersions)
    .where(and(eq(budgetVersions.id, versionId), eq(budgetVersions.organizationId, organizationId)))
    .limit(1)
  if (!version) return { error: 'Versão de orçamento não encontrada.' }
  if (version.status === 'arquivado') return { error: 'Uma versão arquivada não pode ser a vigente. Desarquive-a antes.' }

  // O índice único parcial exige desmarcar a atual antes de marcar a nova.
  await db.transaction(async (tx) => {
    await tx
      .update(budgetVersions)
      .set({ isActive: false })
      .where(and(
        eq(budgetVersions.organizationId, organizationId),
        eq(budgetVersions.fiscalYear, version.fiscalYear),
        eq(budgetVersions.isActive, true),
      ))
    await tx
      .update(budgetVersions)
      .set({ isActive: true })
      .where(eq(budgetVersions.id, versionId))
  })

  revalidatePath('/orcamento')
  return { success: true as const }
}

export async function updateBudgetVersionStatus(versionId: string, status: BudgetStatus) {
  const { organizationId, userId } = await getAuthContext()
  if (!BUDGET_STATUSES.includes(status)) return { error: 'Status inválido.' }

  const [version] = await db
    .select({ id: budgetVersions.id, isActive: budgetVersions.isActive })
    .from(budgetVersions)
    .where(and(eq(budgetVersions.id, versionId), eq(budgetVersions.organizationId, organizationId)))
    .limit(1)
  if (!version) return { error: 'Versão de orçamento não encontrada.' }

  const patch: Record<string, unknown> = { status }
  if (status === 'aprovado') {
    patch.approvedAt = new Date()
    patch.approvedByUserId = userId
  }
  if (status === 'arquivado') {
    patch.archivedAt = new Date()
    // O CHECK do banco proíbe arquivada + vigente.
    patch.isActive = false
  }

  await db.update(budgetVersions).set(patch).where(eq(budgetVersions.id, versionId))
  revalidatePath('/orcamento')
  return { success: true as const }
}

export async function deleteBudgetVersion(versionId: string) {
  const { organizationId } = await getAuthContext()

  const result = await db
    .delete(budgetVersions)
    .where(and(eq(budgetVersions.id, versionId), eq(budgetVersions.organizationId, organizationId)))
    .returning({ id: budgetVersions.id })

  if (!result.length) return { error: 'Versão de orçamento não encontrada.' }

  revalidatePath('/orcamento')
  return { success: true as const }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SÉRIES
// ═══════════════════════════════════════════════════════════════════════════════

export async function listBudgetSeries(versionId: string): Promise<BudgetSeriesListItem[]> {
  const { organizationId } = await getAuthContext()

  type Row = {
    id: string
    description: string
    direction: string
    category_id: string
    category_name: string
    category_code: string | null
    category_type: string
    parent_name: string | null
    cost_center_id: string | null
    cost_center_name: string | null
    business_unit_id: string | null
    business_unit_name: string | null
    legal_entity_id: string | null
    legal_entity_name: string | null
    contact_id: string | null
    contact_name: string | null
    start_month: string
    occurrences: number
    interval_months: number
    day_of_month: number
    cash_lag_days: number
    amount_mode: string
    base_amount: string | null
    total_amount: string | null
    adjustment_rate: string | null
    adjustment_every: number
    seasonal_amounts: unknown
    source: string
    notes: string | null
    entry_count: number
    annual_total: string
    adjusted_count: number
  }

  const rows = await db.execute<Row>(sql`
    SELECT
      s.id::text               AS id,
      s.description            AS description,
      s.direction              AS direction,
      s.category_id::text      AS category_id,
      c.name                   AS category_name,
      c.code                   AS category_code,
      c.type                   AS category_type,
      p.name                   AS parent_name,
      s.cost_center_id::text   AS cost_center_id,
      cc.name                  AS cost_center_name,
      s.business_unit_id::text AS business_unit_id,
      bu.name                  AS business_unit_name,
      s.legal_entity_id::text  AS legal_entity_id,
      le.name                  AS legal_entity_name,
      s.contact_id::text       AS contact_id,
      ct.name                  AS contact_name,
      s.start_month::text      AS start_month,
      s.occurrences            AS occurrences,
      s.interval_months        AS interval_months,
      s.day_of_month           AS day_of_month,
      s.cash_lag_days          AS cash_lag_days,
      s.amount_mode            AS amount_mode,
      s.base_amount::text      AS base_amount,
      s.total_amount::text     AS total_amount,
      s.adjustment_rate::text  AS adjustment_rate,
      s.adjustment_every       AS adjustment_every,
      s.seasonal_amounts       AS seasonal_amounts,
      s.source                 AS source,
      s.notes                  AS notes,
      (SELECT COUNT(*) FROM budget_entries e WHERE e.series_id = s.id)::int AS entry_count,
      COALESCE((SELECT SUM(e.amount) FROM budget_entries e WHERE e.series_id = s.id), 0) AS annual_total,
      (SELECT COUNT(*) FROM budget_entries e
        WHERE e.series_id = s.id AND cardinality(e.adjusted_fields) > 0)::int AS adjusted_count
    FROM budget_series s
    JOIN categories c        ON s.category_id      = c.id
    LEFT JOIN categories p   ON c.parent_id        = p.id
    LEFT JOIN cost_centers cc   ON s.cost_center_id   = cc.id
    LEFT JOIN business_units bu ON s.business_unit_id = bu.id
    LEFT JOIN legal_entities le ON s.legal_entity_id  = le.id
    LEFT JOIN contacts ct       ON s.contact_id       = ct.id
    WHERE s.organization_id = ${organizationId}::uuid
      AND s.version_id      = ${versionId}::uuid
    ORDER BY c.type, c.code NULLS LAST, s.description
  `)

  return rows.map(r => ({
    id: r.id,
    description: r.description,
    direction: r.direction as 'inflow' | 'outflow',
    categoryId: r.category_id,
    categoryName: r.category_name,
    categoryCode: r.category_code,
    categoryType: r.category_type,
    parentName: r.parent_name,
    costCenterId: r.cost_center_id,
    costCenterName: r.cost_center_name,
    businessUnitId: r.business_unit_id,
    businessUnitName: r.business_unit_name,
    legalEntityId: r.legal_entity_id,
    legalEntityName: r.legal_entity_name,
    contactId: r.contact_id,
    contactName: r.contact_name,
    startMonth: r.start_month.slice(0, 7),
    occurrences: Number(r.occurrences),
    entryCount: Number(r.entry_count),
    intervalMonths: Number(r.interval_months),
    dayOfMonth: Number(r.day_of_month),
    cashLagDays: Number(r.cash_lag_days),
    amountMode: r.amount_mode as AmountMode,
    baseAmount: r.base_amount === null ? null : Number(r.base_amount),
    totalAmount: r.total_amount === null ? null : Number(r.total_amount),
    adjustmentRate: r.adjustment_rate === null ? null : Number(r.adjustment_rate),
    adjustmentEvery: Number(r.adjustment_every),
    seasonalAmounts: Array.isArray(r.seasonal_amounts) ? (r.seasonal_amounts as number[]).map(Number) : null,
    source: r.source as BudgetSeriesListItem['source'],
    notes: r.notes,
    // Total do ano vem do SUM das ENTRIES — nunca recomputado da regra.
    annualTotal: Number(r.annual_total),
    adjustedCount: Number(r.adjusted_count),
  }))
}

/**
 * Uma série pelo id, no formato que o `SeriesDialog` consome.
 *
 * Existe para abrir a edição a partir de um drill-down, onde só se conhece o
 * `seriesId`: `listBudgetSeries` traria centenas de linhas para preencher um
 * diálogo. Reusa a mesma query com um filtro a mais, para as duas telas
 * mostrarem exatamente os mesmos campos.
 */
export async function getBudgetSeries(seriesId: string): Promise<BudgetSeriesListItem | null> {
  const { organizationId } = await getAuthContext()

  const [row] = await db
    .select({ versionId: budgetSeries.versionId })
    .from(budgetSeries)
    .where(and(eq(budgetSeries.id, seriesId), eq(budgetSeries.organizationId, organizationId)))
    .limit(1)
  if (!row) return null

  const all = await listBudgetSeries(row.versionId)
  return all.find(s => s.id === seriesId) ?? null
}

export async function getBudgetSeriesEntries(seriesId: string): Promise<BudgetEntryListItem[]> {
  const { organizationId } = await getAuthContext()

  type Row = {
    id: string
    series_id: string
    sequence: number
    description: string
    direction: string
    category_id: string
    category_name: string
    cost_center_id: string | null
    cost_center_name: string | null
    business_unit_id: string | null
    business_unit_name: string | null
    legal_entity_id: string | null
    legal_entity_name: string | null
    contact_id: string | null
    contact_name: string | null
    competence_date: string
    cash_date: string
    amount: string
    adjusted_fields: string[]
    notes: string | null
  }

  const rows = await db.execute<Row>(sql`
    SELECT
      e.id::text               AS id,
      e.series_id::text        AS series_id,
      e.sequence               AS sequence,
      e.description            AS description,
      e.direction              AS direction,
      e.category_id::text      AS category_id,
      c.name                   AS category_name,
      e.cost_center_id::text   AS cost_center_id,
      cc.name                  AS cost_center_name,
      e.business_unit_id::text AS business_unit_id,
      bu.name                  AS business_unit_name,
      e.legal_entity_id::text  AS legal_entity_id,
      le.name                  AS legal_entity_name,
      e.contact_id::text       AS contact_id,
      ct.name                  AS contact_name,
      e.competence_date::text  AS competence_date,
      e.cash_date::text        AS cash_date,
      e.amount::text           AS amount,
      e.adjusted_fields        AS adjusted_fields,
      e.notes                  AS notes
    FROM budget_entries e
    JOIN categories c           ON e.category_id      = c.id
    LEFT JOIN cost_centers cc   ON e.cost_center_id   = cc.id
    LEFT JOIN business_units bu ON e.business_unit_id = bu.id
    LEFT JOIN legal_entities le ON e.legal_entity_id  = le.id
    LEFT JOIN contacts ct       ON e.contact_id       = ct.id
    WHERE e.organization_id = ${organizationId}::uuid
      AND e.series_id       = ${seriesId}::uuid
    ORDER BY e.sequence
  `)

  return rows.map(r => ({
    id: r.id,
    seriesId: r.series_id,
    sequence: Number(r.sequence),
    description: r.description,
    direction: r.direction as 'inflow' | 'outflow',
    categoryId: r.category_id,
    categoryName: r.category_name,
    costCenterId: r.cost_center_id,
    costCenterName: r.cost_center_name,
    businessUnitId: r.business_unit_id,
    businessUnitName: r.business_unit_name,
    legalEntityId: r.legal_entity_id,
    legalEntityName: r.legal_entity_name,
    contactId: r.contact_id,
    contactName: r.contact_name,
    competenceDate: r.competence_date,
    cashDate: r.cash_date,
    amount: Number(r.amount),
    adjustedFields: (r.adjusted_fields ?? []) as AdjustableField[],
    notes: r.notes,
  }))
}

export async function createBudgetSeries(input: BudgetSeriesInput) {
  const { organizationId, userId } = await getAuthContext()

  const parsed = budgetSeriesInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const v = parsed.data

  const loaded = await loadEditableVersion(organizationId, v.versionId)
  if ('error' in loaded) return { error: loaded.error }

  const fits = fitsInFiscalYear(v, loaded.version.fiscalYear)
  if (!fits.ok) return { error: fits.message }

  const targetError = await validateTargetsBelongToOrg(organizationId, v)
  if (targetError) return { error: targetError }

  const drafts = expandSeries(v)

  await db.transaction(async (tx) => {
    const [series] = await tx
      .insert(budgetSeries)
      .values({
        organizationId,
        versionId: v.versionId,
        description: v.description,
        direction: v.direction,
        categoryId: v.categoryId,
        costCenterId: v.costCenterId,
        businessUnitId: v.businessUnitId,
        legalEntityId: v.legalEntityId,
        contactId: v.contactId,
        startMonth: `${v.startMonth}-01`,
        occurrences: v.occurrences,
        intervalMonths: v.intervalMonths,
        dayOfMonth: v.dayOfMonth,
        cashLagDays: v.cashLagDays,
        amountMode: v.amountMode,
        baseAmount: v.baseAmount === null ? null : money(v.baseAmount),
        totalAmount: v.totalAmount === null ? null : money(v.totalAmount),
        adjustmentRate: v.adjustmentRate === null ? null : String(v.adjustmentRate),
        adjustmentEvery: v.adjustmentEvery,
        seasonalAmounts: v.seasonalAmounts,
        source: 'manual',
        notes: v.notes,
        createdByUserId: userId,
      })
      .returning({ id: budgetSeries.id })

    await tx.insert(budgetEntries).values(
      drafts.map(d => ({
        organizationId,
        versionId: v.versionId,
        seriesId: series.id,
        sequence: d.sequence,
        description: v.description,
        direction: v.direction,
        categoryId: v.categoryId,
        costCenterId: v.costCenterId,
        businessUnitId: v.businessUnitId,
        legalEntityId: v.legalEntityId,
        contactId: v.contactId,
        competenceDate: d.competenceDate,
        cashDate: d.cashDate,
        amount: money(d.amount),
      })),
    )
  })

  revalidatePath('/orcamento')
  return { success: true as const, occurrences: drafts.length }
}

// ─── Escopos de edição ────────────────────────────────────────────────────────
// A decisão (`planSeriesUpdate`) e a execução (`applySeriesUpdate`) vivem em
// `@/lib/budget-scope`, para poderem ser exercitadas direto contra o banco.

async function loadSeriesForEdit(
  organizationId: string,
  seriesId: string,
): Promise<{ error: string } | { series: SeriesRow; entries: EntryRow[]; fiscalYear: number }> {
  const [series] = await db
    .select()
    .from(budgetSeries)
    .where(and(eq(budgetSeries.id, seriesId), eq(budgetSeries.organizationId, organizationId)))
    .limit(1)
  if (!series) return { error: 'Lançamento não encontrado.' as const }

  const version = await loadEditableVersion(organizationId, series.versionId)
  if ('error' in version) return { error: version.error }

  const entries = await db
    .select()
    .from(budgetEntries)
    .where(eq(budgetEntries.seriesId, seriesId))
    .orderBy(budgetEntries.sequence)

  return { series, entries, fiscalYear: version.version.fiscalYear }
}

/** O que uma alteração faria, sem executá-la — alimenta o seletor de escopo do diálogo. */
export async function previewSeriesUpdate(
  seriesId: string,
  input: BudgetSeriesInput,
  options: SeriesUpdateOptions,
): Promise<{ preview: SeriesUpdatePreview } | { error: string }> {
  const { organizationId } = await getAuthContext()
  const parsed = budgetSeriesInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const loaded = await loadSeriesForEdit(organizationId, seriesId)
  if ('error' in loaded) return { error: loaded.error }

  return { preview: planSeriesUpdate(loaded.series, loaded.entries, parsed.data, options).preview }
}

/**
 * Altera o lançamento no escopo pedido.
 *
 * Semântica dos três escopos:
 *
 * - **'esta'**  — só a ocorrência âncora; a regra NUNCA é tocada; os campos
 *   alterados passam a divergir dela e viram `adjusted_fields`.
 * - **'daqui'** — ocorrências com `sequence >= âncora`; a regra também não é
 *   tocada (deliberadamente: fazer split da série mostraria duas linhas onde o
 *   usuário criou uma). Se a âncora é a primeira ocorrência, equivale a 'todas'.
 * - **'todas'** — regra + todas as ocorrências, com truncar/anexar/deslocar.
 *
 * Ocorrências ajustadas à mão são PULADAS campo a campo, a menos que
 * `overwriteAdjusted` venha true — e aí só depois de o usuário confirmar o
 * diálogo que lista os meses afetados.
 *
 * Retorna `{ needsConfirm }` em vez de executar quando há ajuste manual em risco
 * ou ocorrência a ser removida.
 */
export async function updateBudgetSeries(
  seriesId: string,
  input: BudgetSeriesInput,
  options: SeriesUpdateOptions = { scope: 'todas' },
) {
  const { organizationId } = await getAuthContext()

  const parsed = budgetSeriesInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const v = parsed.data

  const loaded = await loadSeriesForEdit(organizationId, seriesId)
  if ('error' in loaded) return { error: loaded.error }
  const { series, entries, fiscalYear } = loaded

  const fits = fitsInFiscalYear(v, fiscalYear)
  if (!fits.ok) return { error: fits.message }

  const targetError = await validateTargetsBelongToOrg(organizationId, v)
  if (targetError) return { error: targetError }

  const plan = planSeriesUpdate(series, entries, v, options)

  if (plan.preview.requiresConfirm && !options.overwriteAdjusted) {
    return { needsConfirm: plan.preview }
  }

  await db.transaction(tx => applySeriesUpdate(tx, {
    organizationId,
    series,
    entries,
    input: v,
    plan,
    overwriteAdjusted: options.overwriteAdjusted,
  }))

  revalidatePath('/orcamento')
  return { success: true as const, scope: plan.effectiveScope, affected: plan.targets.length }
}

/** O que uma exclusão levaria — alimenta o diálogo de confirmação. */
export async function previewSeriesDelete(
  seriesId: string,
  options: { scope: EditScope; fromSequence?: number },
): Promise<{ preview: SeriesDeletePreview } | { error: string }> {
  const { organizationId } = await getAuthContext()
  const loaded = await loadSeriesForEdit(organizationId, seriesId)
  if ('error' in loaded) return { error: loaded.error }
  const { entries } = loaded

  const firstSeq = entries.length ? entries[0].sequence : 1
  const anchor = options.fromSequence ?? firstSeq

  const doomed = options.scope === 'esta'  ? entries.filter(e => e.sequence === anchor)
               : options.scope === 'daqui' ? entries.filter(e => e.sequence >= anchor)
               :                             entries

  const wipesSeries = options.scope === 'todas' || (options.scope === 'daqui' && anchor <= firstSeq)

  return {
    preview: {
      scope: options.scope,
      removed: doomed.map(e => ({
        sequence: e.sequence,
        month: monthLabel(e.competenceDate),
        fields: e.adjustedFields as AdjustableField[],
      })),
      newOccurrences: wipesSeries ? null : (options.scope === 'daqui' ? anchor - 1 : loaded.series.occurrences),
    },
  }
}

/**
 * Exclui no escopo pedido.
 *
 * - **'esta'**  — só aquela ocorrência. A regra NÃO muda: `occurrences` passa a
 *   divergir do que existe, e a sequência fica com um buraco. Ambos por design.
 * - **'daqui'** — ocorrências de `sequence >= âncora`; `occurrences` cai para
 *   `âncora − 1` (aqui truncar é seguro, nada além do fim é afetado). Se a
 *   âncora é a primeira, a série inteira vai embora.
 * - **'todas'** — a série (CASCADE leva as ocorrências).
 */
export async function deleteBudgetSeries(
  seriesId: string,
  options: { scope?: EditScope; fromSequence?: number } = {},
) {
  const { organizationId } = await getAuthContext()
  const scope = options.scope ?? 'todas'

  const loaded = await loadSeriesForEdit(organizationId, seriesId)
  if ('error' in loaded) return { error: loaded.error }
  const { series, entries } = loaded

  const result = await db.transaction(tx => applySeriesDelete(tx, {
    series, entries, scope, fromSequence: options.fromSequence,
  }))

  if (result.removed === 0) return { error: 'Nenhuma ocorrência nesse intervalo.' }

  revalidatePath('/orcamento')
  return { success: true as const, ...result }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OCORRÊNCIAS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Edita uma ocorrência isolada, sem nunca tocar na série.
 *
 * Cada campo alterado entra em `adjusted_fields`, o que o protege de alterações
 * em lote futuras. AUTO-CURA: se o valor voltar a coincidir com o que a série
 * geraria, o campo sai do array — sem isso, uma linha ficaria travada para
 * sempre por um ajuste que não existe mais.
 */
export async function updateBudgetEntry(entryId: string, patch: BudgetEntryUpdate) {
  const { organizationId } = await getAuthContext()

  const parsed = budgetEntryUpdateSchema.safeParse(patch)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const p = parsed.data
  if (Object.keys(p).length === 0) return { error: 'Nada para alterar.' }

  const [entry] = await db
    .select()
    .from(budgetEntries)
    .where(and(eq(budgetEntries.id, entryId), eq(budgetEntries.organizationId, organizationId)))
    .limit(1)
  if (!entry) return { error: 'Ocorrência não encontrada.' }

  const loaded = await loadEditableVersion(organizationId, entry.versionId)
  if ('error' in loaded) return { error: loaded.error }

  const [series] = await db
    .select()
    .from(budgetSeries)
    .where(eq(budgetSeries.id, entry.seriesId))
    .limit(1)
  if (!series) return { error: 'Série do lançamento não encontrada.' }

  if (p.categoryId && p.categoryId !== entry.categoryId) {
    const targetError = await validateTargetsBelongToOrg(organizationId, {
      categoryId: p.categoryId,
      costCenterId: null, businessUnitId: null, legalEntityId: null, contactId: null,
    })
    if (targetError) return { error: targetError }
  }

  // O que a REGRA geraria para esta sequência. Se a ocorrência não está mais na
  // expansão (série truncada, por exemplo), não há baseline — aí qualquer valor
  // informado conta como ajuste.
  const draft = expandSeries(toRecurrenceInput(series)).find(d => d.sequence === entry.sequence)

  const next = {
    amount:         money(p.amount ?? Number(entry.amount)),
    description:    p.description ?? entry.description,
    categoryId:     p.categoryId ?? entry.categoryId,
    costCenterId:   p.costCenterId   !== undefined ? p.costCenterId   : entry.costCenterId,
    businessUnitId: p.businessUnitId !== undefined ? p.businessUnitId : entry.businessUnitId,
    legalEntityId:  p.legalEntityId  !== undefined ? p.legalEntityId  : entry.legalEntityId,
    contactId:      p.contactId      !== undefined ? p.contactId      : entry.contactId,
    competenceDate: p.competenceDate ?? entry.competenceDate,
    cashDate:       p.cashDate ?? entry.cashDate,
    notes:          p.notes !== undefined ? p.notes : entry.notes,
  }

  const adjustedFields = diffAdjustedFields(next, series, draft)

  await db
    .update(budgetEntries)
    .set({ ...next, adjustedFields: adjustedFields as string[], updatedAt: new Date() })
    .where(eq(budgetEntries.id, entryId))

  revalidatePath('/orcamento')
  return { success: true as const, adjustedFields }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORÇADO × REALIZADO
// ═══════════════════════════════════════════════════════════════════════════════

const BP_LIST = sql.raw(BP_TYPES.map(t => `'${t}'`).join(', '))

/** Os metadados de categoria que uma célula da matriz precisa antes de ter valor. */
type BlankSource = Omit<BudgetVsActualRow, 'orcado' | 'realizado'>

/**
 * A matriz de comparação.
 *
 * CHAVE: `categoryId:month`, em UNIÃO dos dois lados — categoria orçada sem
 * realizado ("não gastei") e realizada sem orçado ("gasto não previsto") são as
 * duas descobertas mais valiosas da tela, e a interseção esconderia as duas.
 *
 * O realizado reproduz exatamente as regras da `getDreData` (competência) ou da
 * `getFluxoMensalData` (caixa) — mesmo INNER JOIN em categories, mesma exclusão
 * de BP_TYPES, `status NOT IN ('pending','duplicate')` e a coluna de
 * visibilidade correspondente ao regime. Não dá para reusar `getFluxoMensalData`
 * porque ela não devolve `categoryType`, exigido pela cascata de subtotais.
 *
 * Os filtros de dimensão são aplicados de forma SIMÉTRICA nos dois lados;
 * filtrar só o orçado infla a variação.
 */
export async function getBudgetVsActual(filters: BudgetVsActualFilters): Promise<BudgetVsActualData> {
  const { organizationId } = await getAuthContext()
  const { regime, from, to } = filters

  // O lado orçado (data, coluna de visibilidade e filtros de dimensão) mora em
  // `fetchBudgetRows`. Aqui sobra só o que o realizado precisa.
  const txDate  = regime === 'caixa' ? sql`COALESCE(t.effective_date, t.date)` : sql`t.date`
  const hideCol = regime === 'caixa' ? sql`c.hide_in_cashflow` : sql`c.hide_in_dre`

  const txDims = dimensionFilters('t', filters)

  type AggRow = {
    category_id:   string
    category_name: string
    category_code: string
    category_type: string
    parent_id:     string
    parent_name:   string
    parent_code:   string
    month:         string
    value:         string
  }

  // O lado orçado sai de `fetchBudgetRows` — a MESMA função que a DRE usa.
  // Duas queries "parecidas" divergiriam no primeiro filtro que alguém
  // esquecesse de replicar, e a conciliação verificada na 9.2 morreria em
  // silêncio.
  const periodFilters = { ...filters, organizationId }

  const [orcadoRows, realizadoRows, semCat, cov, fora] = await Promise.all([
    fetchBudgetRows(db, periodFilters),

    // ── Realizado ──
    db.execute<AggRow>(sql`
      SELECT
        c.id::text        AS category_id,
        c.name            AS category_name,
        c.code            AS category_code,
        c.type            AS category_type,
        c.parent_id::text AS parent_id,
        p.name            AS parent_name,
        p.code            AS parent_code,
        TO_CHAR(DATE_TRUNC('month', ${txDate}::date), 'YYYY-MM') AS month,
        COALESCE(SUM(
          CASE WHEN t.direction = 'inflow'
               THEN  t.amount::numeric
               ELSE -t.amount::numeric END
        ), 0) AS value
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      JOIN categories p ON c.parent_id   = p.id
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.status NOT IN ('pending', 'duplicate')
        AND ${txDate}::date >= ${from}::date
        AND ${txDate}::date <= ${to}::date
        AND c.type NOT IN (${BP_LIST})
        AND ${hideCol} = false
        ${txDims}
      GROUP BY c.id, c.name, c.code, c.type, c.parent_id, p.name, p.code,
               DATE_TRUNC('month', ${txDate}::date)
    `),

    // ── Realizado sem categoria (invisível na matriz por causa do INNER JOIN) ──
    db.execute<{ inflow: string; outflow: string; count: number }>(sql`
      SELECT
        COALESCE(SUM(CASE WHEN t.direction = 'inflow'  THEN t.amount::numeric ELSE 0 END), 0) AS inflow,
        COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric ELSE 0 END), 0) AS outflow,
        COUNT(*)::int AS count
      FROM transactions t
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.status NOT IN ('pending', 'duplicate')
        AND t.category_id IS NULL
        AND ${txDate}::date >= ${from}::date
        AND ${txDate}::date <= ${to}::date
        ${txDims}
    `),

    // ── Cobertura das dimensões ──
    // SEM os filtros de dimensão de propósito: com eles a cobertura daria 100%
    // por construção, que é exatamente a ilusão que este número existe para furar.
    db.execute<{ total: number; cc: number; bu: number; le: number }>(sql`
      SELECT
        COUNT(*)::int                     AS total,
        COUNT(t.cost_center_id)::int      AS cc,
        COUNT(t.business_unit_id)::int    AS bu,
        COUNT(t.legal_entity_id)::int     AS le
      FROM transactions t
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.status NOT IN ('pending', 'duplicate')
        AND ${txDate}::date >= ${from}::date
        AND ${txDate}::date <= ${to}::date
    `),

    // ── Orçado fora do período (cauda de caixa) ──
    fetchForaDoHorizonte(db, periodFilters),
  ])

  // União por (categoria, mês)
  const merged = new Map<string, BudgetVsActualRow>()

  const blank = (r: BlankSource): BudgetVsActualRow => ({
    categoryId:   r.categoryId,
    categoryName: r.categoryName,
    categoryCode: r.categoryCode,
    categoryType: r.categoryType,
    parentId:     r.parentId,
    parentName:   r.parentName,
    parentCode:   r.parentCode,
    month:        r.month,
    orcado:       0,
    realizado:    0,
  })

  for (const r of orcadoRows) {
    const key = `${r.categoryId}:${r.month}`
    const row = merged.get(key) ?? blank(r)
    row.orcado = r.orcado
    merged.set(key, row)
  }

  for (const r of realizadoRows) {
    const key = `${r.category_id}:${r.month}`
    const row = merged.get(key) ?? blank({
      categoryId:   r.category_id,
      categoryName: r.category_name,
      categoryCode: r.category_code,
      categoryType: r.category_type as DreType,
      parentId:     r.parent_id,
      parentName:   r.parent_name,
      parentCode:   r.parent_code,
      month:        r.month,
    })
    row.realizado = Number(r.value)
    merged.set(key, row)
  }

  const inflow  = Number(semCat[0]?.inflow ?? 0)
  const outflow = Number(semCat[0]?.outflow ?? 0)

  return {
    months: generateMonthRange(from, to),
    rows: Array.from(merged.values()),
    semCategoria: { inflow, outflow, net: inflow - outflow, count: Number(semCat[0]?.count ?? 0) },
    coverage: {
      total:        Number(cov[0]?.total ?? 0),
      costCenter:   Number(cov[0]?.cc ?? 0),
      businessUnit: Number(cov[0]?.bu ?? 0),
      legalEntity:  Number(cov[0]?.le ?? 0),
    },
    foraDoHorizonte: fora,
  }
}

/**
 * O orçado de um período, para a DRE sobrepor ao seu próprio realizado.
 *
 * Regime fixo em competência: a DRE é competência por definição do projeto, e o
 * toggle de regime vive em `/orcamento`, que é onde ele faz sentido.
 *
 * Roda UMA query agregada, não as cinco de `getBudgetVsActual` — a DRE já tem o
 * realizado próprio e não precisa de cobertura nem de `semCategoria`. Mas usa a
 * mesma `fetchBudgetRows`, então os números são os mesmos da aba de comparação
 * por construção, não por coincidência.
 */
export async function getBudgetForPeriod(
  versionId: string,
  range: { from: string; to: string },
  filters: Pick<BudgetVsActualFilters, 'costCenterIds' | 'businessUnitIds' | 'legalEntityIds'> = {},
): Promise<{ rows: BudgetPeriodRow[]; foraDoHorizonte: { total: number; count: number } }> {
  const { organizationId } = await getAuthContext()

  const f = {
    organizationId,
    versionId,
    regime: 'competencia' as const,
    from: range.from,
    to: range.to,
    ...filters,
  }

  const [rows, foraDoHorizonte] = await Promise.all([
    fetchBudgetRows(db, f),
    fetchForaDoHorizonte(db, f),
  ])

  return { rows, foraDoHorizonte }
}

/** As ocorrências orçadas por trás de uma célula da matriz. */
export async function getBudgetDrillDown(
  versionId: string,
  categoryId: string,
  regime: BudgetRegime,
  range: { from: string; to: string },
  filters: Pick<BudgetVsActualFilters, 'costCenterIds' | 'businessUnitIds' | 'legalEntityIds'>,
): Promise<BudgetDrillDownEntry[]> {
  const { organizationId } = await getAuthContext()

  const budgetDate = regime === 'caixa' ? sql`e.cash_date` : sql`e.competence_date`
  const dims = dimensionFilters('e', filters)

  type Row = {
    id: string
    series_id: string
    description: string
    direction: string
    amount: string
    competence_date: string
    cash_date: string
    cost_center_name: string | null
    business_unit_name: string | null
    legal_entity_name: string | null
    contact_name: string | null
    adjusted: boolean
  }

  const rows = await db.execute<Row>(sql`
    SELECT
      e.id::text              AS id,
      e.series_id::text       AS series_id,
      e.description           AS description,
      e.direction             AS direction,
      e.amount::text          AS amount,
      e.competence_date::text AS competence_date,
      e.cash_date::text       AS cash_date,
      cc.name                 AS cost_center_name,
      bu.name                 AS business_unit_name,
      le.name                 AS legal_entity_name,
      ct.name                 AS contact_name,
      (cardinality(e.adjusted_fields) > 0) AS adjusted
    FROM budget_entries e
    LEFT JOIN cost_centers cc   ON e.cost_center_id   = cc.id
    LEFT JOIN business_units bu ON e.business_unit_id = bu.id
    LEFT JOIN legal_entities le ON e.legal_entity_id  = le.id
    LEFT JOIN contacts ct       ON e.contact_id       = ct.id
    WHERE e.organization_id = ${organizationId}::uuid
      AND e.version_id      = ${versionId}::uuid
      AND e.category_id     = ${categoryId}::uuid
      AND ${budgetDate}::date >= ${range.from}::date
      AND ${budgetDate}::date <= ${range.to}::date
      ${dims}
    ORDER BY ${budgetDate}, e.description
  `)

  return rows.map(r => ({
    id: r.id,
    seriesId: r.series_id,
    description: r.description,
    direction: r.direction as 'inflow' | 'outflow',
    amount: Number(r.amount),
    competenceDate: r.competence_date,
    cashDate: r.cash_date,
    costCenterName: r.cost_center_name,
    businessUnitName: r.business_unit_name,
    legalEntityName: r.legal_entity_name,
    contactName: r.contact_name,
    adjusted: r.adjusted,
  }))
}

/**
 * Exclui uma ocorrência isolada. A série NÃO é alterada: `occurrences` passa a
 * significar "o que a regra geraria" e a sequência fica com um buraco — buracos
 * são válidos e nunca são renumerados.
 */
export async function deleteBudgetEntry(entryId: string) {
  const { organizationId } = await getAuthContext()

  const [entry] = await db
    .select({ id: budgetEntries.id, versionId: budgetEntries.versionId, competenceDate: budgetEntries.competenceDate })
    .from(budgetEntries)
    .where(and(eq(budgetEntries.id, entryId), eq(budgetEntries.organizationId, organizationId)))
    .limit(1)
  if (!entry) return { error: 'Ocorrência não encontrada.' }

  const loaded = await loadEditableVersion(organizationId, entry.versionId)
  if ('error' in loaded) return { error: loaded.error }

  await db.delete(budgetEntries).where(eq(budgetEntries.id, entryId))

  revalidatePath('/orcamento')
  return { success: true as const, month: monthLabel(entry.competenceDate) }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACELERADORES — copiar do realizado e duplicar versão
// ═══════════════════════════════════════════════════════════════════════════════
//
// O miolo (leitura do realizado, moldagem, gravação e o CTE de duplicação) vive
// em `@/lib/budget-copy`, fora de 'use server', para poder ser exercitado direto
// contra o banco. Daqui para baixo é só autenticação, validação e revalidate.

/**
 * Teto de lançamentos gerados por uma cópia. Existe para o detalhamento por
 * dimensão não produzir centenas de linhas sem ninguém perceber — quando
 * estoura, a action FALHA dizendo o número, em vez de cortar em silêncio.
 */
const MAX_COPIED_SERIES = 300

/** Anotado à mão: sem isso o `'error' in planned` não estreita a união. */
type CopyPlan =
  | { error: string }
  | {
      input:        CopyActualsInput
      fiscalYear:   number
      drafts:       CopiedSeriesDraft[]
      semCategoria: { count: number; total: number }
      inativas:     { count: number; total: number }
    }

/**
 * O caminho comum da prévia e da gravação — as duas partem do mesmo lugar.
 *
 * Sem `validateTargetsBelongToOrg` de propósito: aqui as FKs não vêm do cliente,
 * vêm de `transactions` da própria organização, já filtradas por
 * `organization_id` e por INNER JOIN nas categorias dela. Não há id de fora para
 * validar.
 */
async function planCopy(organizationId: string, input: CopyActualsInput): Promise<CopyPlan> {
  const parsed = copyActualsInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const v = parsed.data

  const loaded = await loadEditableVersion(organizationId, v.versionId)
  if ('error' in loaded) return { error: loaded.error }

  const { actuals, semCategoria, inativas } = await collectActuals(db, organizationId, v)

  const drafts = buildCopyDrafts(actuals, {
    fiscalYear:    loaded.version.fiscalYear,
    shape:         v.shape,
    granularity:   v.granularity,
    adjustmentPct: v.adjustmentPct,
  })

  if (drafts.length > MAX_COPIED_SERIES) {
    return {
      error: `O período gera ${drafts.length} lançamentos, acima do limite de ${MAX_COPIED_SERIES}. `
           + 'Use o detalhamento "Por categoria" ou reduza o período.',
    }
  }

  return { input: v, fiscalYear: loaded.version.fiscalYear, drafts, semCategoria, inativas }
}

/**
 * O que a cópia criaria, sem gravar nada. A gravação refaz o cálculo do zero — a
 * prévia serve para o usuário decidir, nunca como fonte do que se grava.
 */
export async function previewCopyActuals(
  input: CopyActualsInput,
): Promise<{ preview: CopyActualsPreview } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const planned = await planCopy(organizationId, input)
  if ('error' in planned) return { error: planned.error }
  const { drafts, semCategoria, inativas } = planned

  const sourceTotals = { inflow: 0, outflow: 0 }
  const targetTotals = { inflow: 0, outflow: 0 }
  for (const d of drafts) {
    sourceTotals[d.direction] += d.sourceTotal
    targetTotals[d.direction] += d.total
  }

  return {
    preview: {
      rows: drafts.map(d => ({
        description:    d.description,
        direction:      d.direction,
        categoryName:   d.categoryName,
        categoryCode:   d.categoryCode,
        dimensionLabel: d.dimensionLabel,
        startMonth:     d.startMonth,
        occurrences:    d.occurrences,
        amountMode:     d.amountMode,
        sourceTotal:    d.sourceTotal,
        total:          d.total,
      })),
      monthsInSource: monthsBetween(planned.input.sourceFrom, planned.input.sourceTo),
      sourceTotals,
      targetTotals,
      semCategoria,
      inativas,
      existingCopied: await countSeriesBySource(db, planned.input.versionId, 'copia_realizado'),
    },
  }
}

/**
 * Cria os lançamentos orçados a partir do realizado.
 *
 * As séries nascem com `source = 'copia_realizado'`, o que permite substituí-las
 * numa segunda passada sem tocar no que foi lançado à mão.
 */
export async function copyActualsToBudget(input: CopyActualsInput) {
  const { organizationId, userId } = await getAuthContext()

  const planned = await planCopy(organizationId, input)
  if ('error' in planned) return { error: planned.error }
  const { drafts, input: v } = planned

  if (drafts.length === 0) {
    return { error: 'Não há realizado categorizado nesse período para copiar.' }
  }

  const notes = `Copiado do realizado de ${monthLabel(v.sourceFrom)} a ${monthLabel(v.sourceTo)}`
    + (v.adjustmentPct !== 0 ? ` com ${v.adjustmentPct > 0 ? '+' : ''}${v.adjustmentPct}%` : '')

  const result = await db.transaction(tx => applyDraftsToBudget(tx, {
    organizationId,
    versionId:       v.versionId,
    userId,
    drafts,
    source:          'copia_realizado',
    notes,
    replaceExisting: v.replaceExisting ?? false,
  }))

  revalidatePath('/orcamento')
  return { success: true as const, ...result }
}

/**
 * Duplica uma versão inteira — o mesmo caminho serve para revisão (mesmo
 * exercício, outro nome) e para cenário ou virada de ano (exercício diferente).
 */
export async function duplicateBudgetVersion(sourceId: string, input: DuplicateVersionInput) {
  const { organizationId, userId } = await getAuthContext()

  const parsed = duplicateVersionInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { name, fiscalYear } = parsed.data

  const [source] = await db
    .select({
      id: budgetVersions.id,
      fiscalYear: budgetVersions.fiscalYear,
      description: budgetVersions.description,
    })
    .from(budgetVersions)
    .where(and(eq(budgetVersions.id, sourceId), eq(budgetVersions.organizationId, organizationId)))
    .limit(1)
  if (!source) return { error: 'Versão de origem não encontrada.' }

  const [dup] = await db
    .select({ id: budgetVersions.id })
    .from(budgetVersions)
    .where(and(
      eq(budgetVersions.organizationId, organizationId),
      eq(budgetVersions.fiscalYear, fiscalYear),
      sql`lower(btrim(${budgetVersions.name})) = lower(btrim(${name}))`,
    ))
    .limit(1)
  if (dup) return { error: `Já existe uma versão chamada "${name}" no exercício de ${fiscalYear}.` }

  // Mesma regra do createBudgetVersion: só nasce vigente se o exercício ainda
  // não tem uma. Duplicar nunca destrona a versão que já está valendo.
  const [existingActive] = await db
    .select({ id: budgetVersions.id })
    .from(budgetVersions)
    .where(and(
      eq(budgetVersions.organizationId, organizationId),
      eq(budgetVersions.fiscalYear, fiscalYear),
      eq(budgetVersions.isActive, true),
    ))
    .limit(1)

  const delta = fiscalYear - source.fiscalYear

  const result = await db.transaction(tx => applyDuplicateVersion(tx, {
    organizationId,
    sourceId,
    name,
    fiscalYear,
    description: source.description,
    isActive:    !existingActive,
    userId,
    delta,
  }))

  revalidatePath('/orcamento')
  return { success: true as const, id: result.versionId, series: result.series, entries: result.entries, shifted: delta }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACELERADORES B — planilha e recorrências detectadas
// ═══════════════════════════════════════════════════════════════════════════════
//
// A validação linha a linha e a conversão dias → meses vivem em
// `@/lib/budget-import`, puras. Daqui saem só os mapas de busca e a gravação.

/** Os cadastros da organização, indexados como o parser precisa. */
async function loadCsvLookups(organizationId: string): Promise<BudgetCsvLookups> {
  const [cats, ccs, bus, les] = await Promise.all([
    db.select({
      id: categories.id, name: categories.name, code: categories.code,
      type: categories.type, isActive: categories.isActive, parentId: categories.parentId,
    }).from(categories).where(eq(categories.organizationId, organizationId)),
    db.select({ id: costCenters.id, name: costCenters.name })
      .from(costCenters).where(eq(costCenters.organizationId, organizationId)),
    db.select({ id: businessUnits.id, name: businessUnits.name })
      .from(businessUnits).where(eq(businessUnits.organizationId, organizationId)),
    db.select({ id: legalEntities.id, name: legalEntities.name })
      .from(legalEntities).where(eq(legalEntities.organizationId, organizationId)),
  ])

  const byCode = new Map<string, LeafCategoryInfo>()
  const byName = new Map<string, LeafCategoryInfo[]>()

  for (const c of cats) {
    // Só folhas: natureza pai não recebe lançamento (mesma regra do manual).
    if (!c.parentId) continue
    const info: LeafCategoryInfo = {
      id: c.id, name: c.name, code: c.code, type: c.type, isActive: c.isActive,
    }
    if (c.code) byCode.set(norm(c.code), info)
    const key = norm(c.name)
    byName.set(key, [...(byName.get(key) ?? []), info])
  }

  const flat = (rows: { id: string; name: string }[]) =>
    new Map(rows.map(r => [norm(r.name), r.id]))

  return {
    byCode, byName,
    costCenters:   flat(ccs),
    businessUnits: flat(bus),
    legalEntities: flat(les),
  }
}

/** O que a planilha criaria, sem gravar nada. Linha inválida não invalida o arquivo. */
export async function previewBudgetCsv(
  versionId: string,
  csv: string,
): Promise<{ preview: BudgetCsvParseResult; existing: { series: number; total: number } } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const loaded = await loadEditableVersion(organizationId, versionId)
  if ('error' in loaded) return { error: loaded.error }

  const lookups = await loadCsvLookups(organizationId)
  const preview = parseBudgetCsv(csv, lookups, loaded.version.fiscalYear)

  return { preview, existing: await countSeriesBySource(db, versionId, 'csv') }
}

/**
 * Importa a planilha. Recalcula do zero a partir do mesmo texto — a prévia
 * serve para o usuário decidir, nunca como fonte do que se grava.
 *
 * Linhas inválidas ficam de fora e o retorno diz quantas. Importar 48 de 50 é
 * mais útil do que recusar as 50 por causa de duas.
 */
export async function importBudgetCsv(
  versionId: string,
  csv: string,
  options: { replaceExisting?: boolean } = {},
) {
  const { organizationId, userId } = await getAuthContext()

  const loaded = await loadEditableVersion(organizationId, versionId)
  if ('error' in loaded) return { error: loaded.error }

  const lookups = await loadCsvLookups(organizationId)
  const parsed = parseBudgetCsv(csv, lookups, loaded.version.fiscalYear)

  if (parsed.fileError) return { error: parsed.fileError }
  if (parsed.drafts.length === 0) return { error: 'Nenhuma linha válida para importar.' }
  if (parsed.drafts.length > MAX_COPIED_SERIES) {
    return { error: `A planilha tem ${parsed.drafts.length} linhas válidas, acima do limite de ${MAX_COPIED_SERIES}.` }
  }

  const result = await db.transaction(tx => applyDraftsToBudget(tx, {
    organizationId,
    versionId,
    userId,
    drafts:          parsed.drafts,
    source:          'csv',
    notes:           'Importado de planilha',
    replaceExisting: options.replaceExisting ?? false,
  }))

  revalidatePath('/orcamento')
  return { success: true as const, ...result, skipped: parsed.invalid }
}

/**
 * As recorrências que o `/fluxo` detectou, preparadas para virar orçamento.
 *
 * Reusa `getFluxoData` em vez de repetir o SQL de detecção: os números que o
 * usuário vê aqui têm de ser exatamente os que ele vê lá.
 */
export async function getRecurrenceCandidates(
  versionId: string,
): Promise<{ candidates: RecurrenceCandidate[] } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const loaded = await loadEditableVersion(organizationId, versionId)
  if ('error' in loaded) return { error: loaded.error }

  const [fluxo, aceitas] = await Promise.all([
    getFluxoData(),
    db.select({ description: budgetSeries.description })
      .from(budgetSeries)
      .where(and(
        eq(budgetSeries.versionId, versionId),
        eq(budgetSeries.source, 'recorrencia_detectada'),
      )),
  ])

  return {
    candidates: buildRecurrenceCandidates(
      fluxo.recorrencias,
      loaded.version.fiscalYear,
      new Set(aceitas.map(a => norm(a.description))),
    ),
  }
}

/**
 * Cria um lançamento para cada recorrência escolhida.
 *
 * A recorrência detectada não tem categoria — o `/fluxo` agrupa por descrição,
 * não por plano de contas. Por isso a escolha da categoria vem do cliente e é
 * obrigatória: sem ela o lançamento não apareceria em relatório nenhum.
 *
 * `replaceExisting` fica de fora de propósito: aceitar recorrência é ato
 * incremental ("essa aqui também"), não um lote que se refaz inteiro.
 */
export async function acceptDetectedRecurrences(
  versionId: string,
  choices: RecurrenceChoice[],
) {
  const { organizationId, userId } = await getAuthContext()

  const loaded = await loadEditableVersion(organizationId, versionId)
  if ('error' in loaded) return { error: loaded.error }

  const parsed = z.array(recurrenceChoiceSchema).min(1, 'Escolha ao menos uma recorrência.').safeParse(choices)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // A lista é recalculada no servidor: o cliente manda a chave e a escolha, não
  // o valor detectado nem as datas.
  const listed = await getRecurrenceCandidates(versionId)
  if ('error' in listed) return { error: listed.error }
  const byKey = new Map(listed.candidates.map(c => [c.key, c]))

  const drafts: CopiedSeriesDraft[] = []

  for (const choice of parsed.data) {
    const candidate = byKey.get(choice.key)
    if (!candidate) return { error: 'Uma das recorrências não está mais na lista. Reabra o diálogo.' }
    if (candidate.blocked) return { error: `"${candidate.descricao}": ${candidate.blocked}` }

    const targetError = await validateTargetsBelongToOrg(organizationId, {
      categoryId:     choice.categoryId,
      costCenterId:   choice.costCenterId,
      businessUnitId: null, legalEntityId: null, contactId: null,
    })
    if (targetError) return { error: `"${candidate.descricao}": ${targetError}` }

    const [cat] = await db
      .select({ name: categories.name, code: categories.code })
      .from(categories)
      .where(eq(categories.id, choice.categoryId))
      .limit(1)

    drafts.push(recurrenceToDraft(candidate, {
      categoryId:   choice.categoryId,
      categoryName: cat?.name ?? '',
      categoryCode: cat?.code ?? null,
      costCenterId: choice.costCenterId,
      amount:       choice.amount,
    }))
  }

  const result = await db.transaction(tx => applyDraftsToBudget(tx, {
    organizationId,
    versionId,
    userId,
    drafts,
    source:          'recorrencia_detectada',
    notes:           'Aceito das recorrências detectadas no fluxo',
    replaceExisting: false,
  }))

  revalidatePath('/orcamento')
  return { success: true as const, ...result }
}

