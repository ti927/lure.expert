// Semântica dos escopos de edição do orçamento — decisão e aplicação.
//
// Vive fora de `'use server'` por dois motivos: a diretiva só permite exportar
// funções async (e aqui há funções puras), e este é o miolo do módulo — precisa
// ser exercitável direto contra o banco num teste, sem passar por sessão HTTP.
//
// `planSeriesUpdate` é PURA: recebe o estado atual e o formulário, devolve o que
// aconteceria. `applySeriesUpdate` executa esse plano dentro de uma transação.

import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { budgetSeries, budgetEntries } from '@/db/schema'
import { expandSeries } from './budget-recurrence'
import { monthLabel } from './format'
import {
  ADJUSTABLE_FIELDS,
  SERIES_STRUCTURAL_FIELDS,
  SERIES_VALUE_FIELDS,
  SERIES_ATTR_FIELDS,
  type AdjustableField,
  type AmountMode,
  type BudgetSeriesInput,
  type EditScope,
  type SeriesUpdateOptions,
  type SeriesUpdatePreview,
  type AffectedOccurrence,
} from './budget-types'

export type BudgetTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type SeriesRow = typeof budgetSeries.$inferSelect
export type EntryRow = typeof budgetEntries.$inferSelect

/** `numeric` do Postgres viaja como string. */
export const money = (v: number) => v.toFixed(2)

/** A regra do banco no formato do formulário, para comparar campo a campo. */
export function seriesToInput(s: SeriesRow): Omit<BudgetSeriesInput, 'versionId'> {
  return {
    description: s.description,
    direction: s.direction as 'inflow' | 'outflow',
    categoryId: s.categoryId,
    costCenterId: s.costCenterId,
    businessUnitId: s.businessUnitId,
    legalEntityId: s.legalEntityId,
    contactId: s.contactId,
    startMonth: s.startMonth.slice(0, 7),
    occurrences: s.occurrences,
    intervalMonths: s.intervalMonths,
    dayOfMonth: s.dayOfMonth,
    cashLagDays: s.cashLagDays,
    amountMode: s.amountMode as AmountMode,
    baseAmount: s.baseAmount === null ? null : Number(s.baseAmount),
    totalAmount: s.totalAmount === null ? null : Number(s.totalAmount),
    adjustmentRate: s.adjustmentRate === null ? null : Number(s.adjustmentRate),
    adjustmentEvery: s.adjustmentEvery,
    seasonalAmounts: Array.isArray(s.seasonalAmounts) ? (s.seasonalAmounts as number[]) : null,
    notes: s.notes,
  }
}

type AttrField = (typeof SERIES_ATTR_FIELDS)[number]

/** Atributo do formulário → campo protegível na ocorrência. `direction` não é sobrescrevível. */
const ATTR_TO_ADJUSTED: Record<AttrField, AdjustableField | null> = {
  description:    'description',
  direction:      null,
  categoryId:     'category_id',
  costCenterId:   'cost_center_id',
  businessUnitId: 'business_unit_id',
  legalEntityId:  'legal_entity_id',
  contactId:      'contact_id',
  notes:          'notes',
}

/** Atributo do formulário → propriedade de `budget_entries` no Drizzle. */
const ATTR_TO_COLUMN: Record<AttrField, string> = {
  description: 'description', direction: 'direction', categoryId: 'categoryId',
  costCenterId: 'costCenterId', businessUnitId: 'businessUnitId',
  legalEntityId: 'legalEntityId', contactId: 'contactId', notes: 'notes',
}

function changedKeys<K extends string>(keys: readonly K[], a: Record<string, unknown>, b: Record<string, unknown>): K[] {
  return keys.filter(k => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
}

/**
 * Quais campos desta ocorrência divergem do que a regra geraria.
 *
 * Fonte única do `adjusted_fields` — usada tanto ao editar uma ocorrência quanto
 * ao recalcular depois de alterar a série. É também o mecanismo de AUTO-CURA: se
 * o valor volta a coincidir com a regra, o campo não entra na lista e a
 * ocorrência deixa de ser protegida.
 */
export function diffAdjustedFields(
  entry: Pick<EntryRow, 'amount' | 'description' | 'categoryId' | 'costCenterId' | 'businessUnitId'
    | 'legalEntityId' | 'contactId' | 'competenceDate' | 'cashDate' | 'notes'>,
  rule: Pick<BudgetSeriesInput, 'description' | 'categoryId' | 'costCenterId' | 'businessUnitId'
    | 'legalEntityId' | 'contactId' | 'notes'>,
  draft: { amount: number; competenceDate: string; cashDate: string } | undefined,
): AdjustableField[] {
  const expected: Record<AdjustableField, unknown> = {
    amount:           draft ? draft.amount : Number(entry.amount),
    description:      rule.description,
    category_id:      rule.categoryId,
    cost_center_id:   rule.costCenterId,
    business_unit_id: rule.businessUnitId,
    legal_entity_id:  rule.legalEntityId,
    contact_id:       rule.contactId,
    competence_date:  draft ? draft.competenceDate : entry.competenceDate,
    cash_date:        draft ? draft.cashDate : entry.cashDate,
    notes:            rule.notes,
  }
  const actual: Record<AdjustableField, unknown> = {
    amount:           Number(entry.amount),
    description:      entry.description,
    category_id:      entry.categoryId,
    cost_center_id:   entry.costCenterId,
    business_unit_id: entry.businessUnitId,
    legal_entity_id:  entry.legalEntityId,
    contact_id:       entry.contactId,
    competence_date:  entry.competenceDate,
    cash_date:        entry.cashDate,
    notes:            entry.notes,
  }
  return ADJUSTABLE_FIELDS.filter(f =>
    f === 'amount'
      ? Math.round(Number(expected[f]) * 100) !== Math.round(Number(actual[f]) * 100)
      : (expected[f] ?? null) !== (actual[f] ?? null),
  )
}

export interface UpdatePlan {
  preview:         SeriesUpdatePreview
  effectiveScope:  EditScope
  updateSeriesRow: boolean
  targets:         EntryRow[]
  removed:         EntryRow[]
  attrChanged:     AttrField[]
  valueChanged:    boolean
  dateShift:       boolean
}

/**
 * Decide o que a alteração faria, sem tocar no banco.
 *
 * - Mudança estrutural (mês inicial, quantidade, periodicidade, dia, prazo) não
 *   tem como valer "só para este mês" → promove o escopo para 'todas'.
 * - 'daqui' a partir da primeira ocorrência é, por definição, 'todas'.
 * - Em 'esta' e 'daqui' a REGRA não é tocada: é isso que faz as ocorrências
 *   alteradas passarem a divergir dela e virarem ajustes.
 */
export function planSeriesUpdate(
  series: SeriesRow,
  entries: EntryRow[],
  input: BudgetSeriesInput,
  options: SeriesUpdateOptions,
): UpdatePlan {
  const current = seriesToInput(series) as unknown as Record<string, unknown>
  const next = input as unknown as Record<string, unknown>

  const structural  = changedKeys(SERIES_STRUCTURAL_FIELDS, current, next)
  const valueFields = changedKeys(SERIES_VALUE_FIELDS, current, next)
  const attrChanged = changedKeys(SERIES_ATTR_FIELDS, current, next)

  const firstSeq = entries.length ? entries[0].sequence : 1
  const anchor = options.fromSequence ?? firstSeq

  const forcedFullScope = structural.length > 0 && options.scope !== 'todas'
  let scope: EditScope = forcedFullScope ? 'todas' : options.scope
  if (scope === 'daqui' && anchor <= firstSeq) scope = 'todas'

  const updateSeriesRow = scope === 'todas'

  const removed = updateSeriesRow ? entries.filter(e => e.sequence > input.occurrences) : []
  const removedIds = new Set(removed.map(e => e.id))
  const inScope = scope === 'esta'  ? entries.filter(e => e.sequence === anchor)
               : scope === 'daqui' ? entries.filter(e => e.sequence >= anchor)
               :                     entries
  const targets = inScope.filter(e => !removedIds.has(e.id))

  const dateShift    = updateSeriesRow && structural.some(f => f !== 'occurrences')
  const valueChanged = valueFields.length > 0 || (updateSeriesRow && structural.length > 0)

  const willWrite = new Set<AdjustableField>()
  if (valueChanged) willWrite.add('amount')
  if (dateShift) { willWrite.add('competence_date'); willWrite.add('cash_date') }
  for (const f of attrChanged) {
    const mapped = ATTR_TO_ADJUSTED[f]
    if (mapped) willWrite.add(mapped)
  }

  const conflicts: AffectedOccurrence[] = targets
    .map(e => ({
      sequence: e.sequence,
      month: monthLabel(e.competenceDate),
      fields: ((e.adjustedFields ?? []) as AdjustableField[]).filter(f => willWrite.has(f)),
    }))
    .filter(c => c.fields.length > 0)

  const existingSeqs = new Set(entries.filter(e => e.sequence <= input.occurrences).map(e => e.sequence))
  const appended = updateSeriesRow
    ? expandSeries(input).filter(d => !existingSeqs.has(d.sequence)).length
    : 0

  return {
    preview: {
      scope,
      forcedFullScope,
      affectedCount: targets.length,
      removed: removed.map(e => ({
        sequence: e.sequence,
        month: monthLabel(e.competenceDate),
        fields: (e.adjustedFields ?? []) as AdjustableField[],
      })),
      appended,
      dateShift,
      conflicts,
      requiresConfirm: conflicts.length > 0 || removed.length > 0,
    },
    effectiveScope: scope,
    updateSeriesRow,
    targets,
    removed,
    attrChanged,
    valueChanged,
    dateShift,
  }
}

/** Executa o plano. Deve rodar dentro de uma transação. */
export async function applySeriesUpdate(
  tx: BudgetTx,
  args: {
    organizationId: string
    series: SeriesRow
    entries: EntryRow[]
    input: BudgetSeriesInput
    plan: UpdatePlan
    overwriteAdjusted?: boolean
  },
) {
  const { organizationId, series, entries, input: v, plan, overwriteAdjusted } = args

  if (plan.updateSeriesRow) {
    await tx.update(budgetSeries).set({
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
    }).where(eq(budgetSeries.id, series.id))

    // Truncar, nunca regenerar do zero.
    if (plan.removed.length) {
      await tx.delete(budgetEntries).where(inArray(budgetEntries.id, plan.removed.map(e => e.id)))
    }
  }

  // Duas expansões, e a distinção entre elas é o coração do escopo parcial:
  //
  //   writeDrafts — o que o usuário pediu. É o que se GRAVA nas ocorrências do
  //                 escopo, inclusive quando a regra não muda.
  //   ruleDrafts  — o que a regra vigente geraria. É o BASELINE do
  //                 `adjusted_fields`; em 'esta' e 'daqui' continua sendo a
  //                 regra antiga, e é por isso que o que foi gravado passa a
  //                 constar como ajuste manual.
  //
  // Em escopo 'todas' as duas coincidem.
  const finalRule: BudgetSeriesInput = plan.updateSeriesRow
    ? v
    : { ...(seriesToInput(series) as Omit<BudgetSeriesInput, 'versionId'>), versionId: series.versionId }

  const writeDrafts = new Map(expandSeries(v).map(d => [d.sequence, d]))
  const ruleDrafts  = plan.updateSeriesRow
    ? writeDrafts
    : new Map(expandSeries(finalRule).map(d => [d.sequence, d]))

  for (const e of plan.targets) {
    const guarded = overwriteAdjusted ? new Set<string>() : new Set(e.adjustedFields ?? [])
    const patch: Record<string, unknown> = {}

    for (const f of plan.attrChanged) {
      const protectedAs = ATTR_TO_ADJUSTED[f]
      if (protectedAs && guarded.has(protectedAs)) continue
      patch[ATTR_TO_COLUMN[f]] = (v as unknown as Record<string, unknown>)[f]
    }

    const d = writeDrafts.get(e.sequence)
    if (d) {
      if (plan.valueChanged && !guarded.has('amount')) patch.amount = money(d.amount)
      if (plan.dateShift) {
        // Desloca datas preservando identidade — nunca delete+recreate.
        if (!guarded.has('competence_date')) patch.competenceDate = d.competenceDate
        if (!guarded.has('cash_date')) patch.cashDate = d.cashDate
      }
    }

    if (Object.keys(patch).length > 0) {
      await tx.update(budgetEntries)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(budgetEntries.id, e.id))
    }
  }

  // Anexar as ocorrências novas.
  if (plan.updateSeriesRow) {
    const existing = new Set(entries.filter(e => e.sequence <= v.occurrences).map(e => e.sequence))
    const toAppend = Array.from(writeDrafts.values()).filter(d => !existing.has(d.sequence))
    if (toAppend.length) {
      await tx.insert(budgetEntries).values(toAppend.map(d => ({
        organizationId,
        versionId: series.versionId,
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
      })))
    }
  }

  // Recalcula `adjusted_fields` contra a regra vigente. É aqui que a auto-cura
  // acontece e que as alterações de escopo parcial passam a constar como ajuste.
  const fresh = await tx.select().from(budgetEntries).where(eq(budgetEntries.seriesId, series.id))
  for (const e of fresh) {
    const nextFields = diffAdjustedFields(e, finalRule, ruleDrafts.get(e.sequence))
    const cur = (e.adjustedFields ?? []) as string[]
    if (nextFields.length !== cur.length || nextFields.some(f => !cur.includes(f))) {
      await tx.update(budgetEntries)
        .set({ adjustedFields: nextFields as string[] })
        .where(eq(budgetEntries.id, e.id))
    }
  }
}

/**
 * Exclusão no escopo pedido.
 *
 * - 'esta'  — só a ocorrência âncora. A regra NÃO muda: `occurrences` passa a
 *   divergir do que existe e a sequência fica com um buraco. Ambos por design.
 * - 'daqui' — de `sequence >= âncora` em diante; `occurrences` cai para
 *   `âncora − 1`. Truncar o fim é seguro: nada além dele é afetado.
 * - 'todas' — a série inteira (CASCADE leva as ocorrências).
 */
export async function applySeriesDelete(
  tx: BudgetTx,
  args: { series: SeriesRow; entries: EntryRow[]; scope: EditScope; fromSequence?: number },
): Promise<{ wipedSeries: boolean; removed: number }> {
  const { series, entries, scope } = args
  const firstSeq = entries.length ? entries[0].sequence : 1
  const anchor = args.fromSequence ?? firstSeq

  if (scope === 'todas' || (scope === 'daqui' && anchor <= firstSeq)) {
    await tx.delete(budgetSeries).where(eq(budgetSeries.id, series.id))
    return { wipedSeries: true, removed: entries.length }
  }

  const doomed = scope === 'esta'
    ? entries.filter(e => e.sequence === anchor)
    : entries.filter(e => e.sequence >= anchor)

  if (doomed.length === 0) return { wipedSeries: false, removed: 0 }

  await tx.delete(budgetEntries).where(inArray(budgetEntries.id, doomed.map(e => e.id)))

  if (scope === 'daqui') {
    await tx.update(budgetSeries)
      .set({ occurrences: anchor - 1, updatedAt: new Date() })
      .where(eq(budgetSeries.id, series.id))
  }

  return { wipedSeries: false, removed: doomed.length }
}
