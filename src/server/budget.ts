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
  BUDGET_STATUSES,
  ADJUSTABLE_FIELDS,
  type BudgetVersionInput,
  type BudgetSeriesInput,
  type BudgetEntryUpdate,
  type BudgetStatus,
  type BudgetVersionListItem,
  type BudgetSeriesListItem,
  type BudgetEntryListItem,
  type AdjustableField,
  type AmountMode,
} from '@/lib/budget-types'
import { expandSeries, fitsInFiscalYear, type RecurrenceInput } from '@/lib/budget-recurrence'
import { monthLabel } from '@/lib/format'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = (v: number) => v.toFixed(2)

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

/** Versão arquivada é somente-leitura — trava na action, não no banco (reversível). */
async function loadEditableVersion(organizationId: string, versionId: string) {
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

/**
 * ATENÇÃO — limitação temporária da sessão 9.1.
 *
 * Regenera a série inteira: apaga todas as ocorrências e recria a partir da
 * regra nova, PERDENDO os ajustes manuais. A sessão 9.3 substitui isto pelos
 * três escopos ("somente este mês" / "este e os próximos" / "toda a série") com
 * preservação de `adjusted_fields`. Até lá a UI avisa antes de salvar.
 */
export async function updateBudgetSeries(seriesId: string, input: BudgetSeriesInput) {
  const { organizationId } = await getAuthContext()

  const parsed = budgetSeriesInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const v = parsed.data

  const [existing] = await db
    .select({ id: budgetSeries.id, versionId: budgetSeries.versionId })
    .from(budgetSeries)
    .where(and(eq(budgetSeries.id, seriesId), eq(budgetSeries.organizationId, organizationId)))
    .limit(1)
  if (!existing) return { error: 'Lançamento não encontrado.' }

  const loaded = await loadEditableVersion(organizationId, existing.versionId)
  if ('error' in loaded) return { error: loaded.error }

  const fits = fitsInFiscalYear(v, loaded.version.fiscalYear)
  if (!fits.ok) return { error: fits.message }

  const targetError = await validateTargetsBelongToOrg(organizationId, v)
  if (targetError) return { error: targetError }

  const drafts = expandSeries(v)

  await db.transaction(async (tx) => {
    await tx
      .update(budgetSeries)
      .set({
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
        notes: v.notes,
        updatedAt: new Date(),
      })
      .where(eq(budgetSeries.id, seriesId))

    await tx.delete(budgetEntries).where(eq(budgetEntries.seriesId, seriesId))

    await tx.insert(budgetEntries).values(
      drafts.map(d => ({
        organizationId,
        versionId: existing.versionId,
        seriesId,
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

export async function deleteBudgetSeries(seriesId: string) {
  const { organizationId } = await getAuthContext()

  const [existing] = await db
    .select({ id: budgetSeries.id, versionId: budgetSeries.versionId })
    .from(budgetSeries)
    .where(and(eq(budgetSeries.id, seriesId), eq(budgetSeries.organizationId, organizationId)))
    .limit(1)
  if (!existing) return { error: 'Lançamento não encontrado.' }

  const loaded = await loadEditableVersion(organizationId, existing.versionId)
  if ('error' in loaded) return { error: loaded.error }

  // ON DELETE CASCADE leva as ocorrências junto.
  await db.delete(budgetSeries).where(eq(budgetSeries.id, seriesId))

  revalidatePath('/orcamento')
  return { success: true as const }
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

  const expected: Record<AdjustableField, unknown> = {
    amount:           draft ? draft.amount : Number(entry.amount),
    description:      series.description,
    category_id:      series.categoryId,
    cost_center_id:   series.costCenterId,
    business_unit_id: series.businessUnitId,
    legal_entity_id:  series.legalEntityId,
    contact_id:       series.contactId,
    competence_date:  draft ? draft.competenceDate : entry.competenceDate,
    cash_date:        draft ? draft.cashDate : entry.cashDate,
    notes:            series.notes,
  }

  const next: Record<AdjustableField, unknown> = {
    amount:           p.amount ?? Number(entry.amount),
    description:      p.description ?? entry.description,
    category_id:      p.categoryId ?? entry.categoryId,
    cost_center_id:   p.costCenterId !== undefined ? p.costCenterId : entry.costCenterId,
    business_unit_id: p.businessUnitId !== undefined ? p.businessUnitId : entry.businessUnitId,
    legal_entity_id:  p.legalEntityId !== undefined ? p.legalEntityId : entry.legalEntityId,
    contact_id:       p.contactId !== undefined ? p.contactId : entry.contactId,
    competence_date:  p.competenceDate ?? entry.competenceDate,
    cash_date:        p.cashDate ?? entry.cashDate,
    notes:            p.notes !== undefined ? p.notes : entry.notes,
  }

  const adjustedFields = ADJUSTABLE_FIELDS.filter(f => {
    const a = expected[f]
    const b = next[f]
    if (f === 'amount') return Number(a) !== Number(b)
    return (a ?? null) !== (b ?? null)
  })

  await db
    .update(budgetEntries)
    .set({
      amount: money(Number(next.amount)),
      description: next.description as string,
      categoryId: next.category_id as string,
      costCenterId: next.cost_center_id as string | null,
      businessUnitId: next.business_unit_id as string | null,
      legalEntityId: next.legal_entity_id as string | null,
      contactId: next.contact_id as string | null,
      competenceDate: next.competence_date as string,
      cashDate: next.cash_date as string,
      notes: next.notes as string | null,
      adjustedFields: adjustedFields as string[],
      updatedAt: new Date(),
    })
    .where(eq(budgetEntries.id, entryId))

  revalidatePath('/orcamento')
  return { success: true as const, adjustedFields }
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
