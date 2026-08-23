// A escrita do orçamento, fora de `'use server'`.
//
// A Fase 9 já tinha posto o miolo em `/lib` — `budget-recurrence`, `budget-scope`,
// `budget-copy`, `budget-read`. O que faltava era o pedaço que ainda dependia da
// sessão: validar alvos, carregar a versão editável e gravar a série. É esse
// pedaço que muda de casa aqui, para o servidor MCP poder chamá-lo.
//
// Mesma regra dos outros dois `-write`: nada é copiado. `src/server/budget.ts`
// passa a importar daqui.

import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  budgetVersions, budgetSeries, budgetEntries,
  categories, costCenters, businessUnits, legalEntities, contacts,
} from '@/db/schema'
import {
  budgetSeriesInputSchema, copyActualsInputSchema,
  type BudgetSeriesInput, type CopyActualsInput, type CopyActualsPreview,
} from '@/lib/budget-types'
import { expandSeries, fitsInFiscalYear } from '@/lib/budget-recurrence'
import {
  buildCopyDrafts, monthsBetween, collectActuals, countSeriesBySource,
  applyDraftsToBudget, type CopiedSeriesDraft,
} from '@/lib/budget-copy'
import { money } from '@/lib/budget-scope'
import { monthLabel } from '@/lib/format'

/**
 * Teto de lançamentos gerados de uma vez pela cópia ou pela planilha.
 *
 * Morava em `src/server/budget.ts`; veio junto porque `planejarCopia` é quem o
 * aplica, e uma constante de regra separada de quem a usa é a que fica para trás.
 */
export const MAX_COPIED_SERIES = 300

/**
 * Confere que cada FK recebida do cliente pertence à organização.
 * Guarda multi-tenant obrigatório: o `db` conecta num papel que ignora RLS.
 */
export async function validarAlvos(
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

export interface EditableVersion {
  id:         string
  fiscalYear: number
  status:     string
  name:       string
}

/** Versão arquivada é somente-leitura — trava aqui, não no banco (reversível). */
export async function carregarVersaoEditavel(
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

/**
 * O que uma série criaria, sem gravar.
 *
 * Devolve as ocorrências expandidas — é o mesmo `expandSeries` que alimenta o
 * preview ao vivo do diálogo da tela, então a prévia do MCP e a da tela mostram
 * exatamente os mesmos meses e valores.
 */
export async function preverSerie(
  organizationId: string,
  input: BudgetSeriesInput,
): Promise<{ error: string } | {
  ocorrencias: { sequence: number; competenceDate: string; cashDate: string; amount: number }[]
  total: number
  versao: EditableVersion
}> {
  const parsed = budgetSeriesInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const v = parsed.data

  const loaded = await carregarVersaoEditavel(organizationId, v.versionId)
  if ('error' in loaded) return { error: loaded.error }

  const fits = fitsInFiscalYear(v, loaded.version.fiscalYear)
  if (!fits.ok) return { error: fits.message }

  const alvoErro = await validarAlvos(organizationId, v)
  if (alvoErro) return { error: alvoErro }

  const drafts = expandSeries(v)
  return {
    ocorrencias: drafts,
    total: drafts.reduce((s, d) => s + d.amount, 0),
    versao: loaded.version,
  }
}

/** Grava a série e suas ocorrências. Recalcula a expansão do zero. */
export async function criarSerie(
  organizationId: string,
  userId: string,
  input: BudgetSeriesInput,
): Promise<{ error: string } | { success: true; occurrences: number; seriesId: string }> {
  const previsto = await preverSerie(organizationId, input)
  if ('error' in previsto) return { error: previsto.error }

  const v = budgetSeriesInputSchema.parse(input)
  const drafts = previsto.ocorrencias

  const seriesId = await db.transaction(async (tx) => {
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
    return series.id
  })

  return { success: true as const, occurrences: drafts.length, seriesId }
}

// ─── Cópia do realizado ───────────────────────────────────────────────────────

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
 * Sem `validarAlvos` de propósito: aqui as FKs não vêm do cliente, vêm de
 * `transactions` da própria organização, já filtradas por `organization_id` e
 * por INNER JOIN nas categorias dela. Não há id de fora para validar.
 */
export async function planejarCopia(
  organizationId: string,
  input: CopyActualsInput,
): Promise<CopyPlan> {
  const parsed = copyActualsInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const v = parsed.data

  const loaded = await carregarVersaoEditavel(organizationId, v.versionId)
  if ('error' in loaded) return { error: loaded.error }

  const { actuals, semCategoria, inativas } = await collectActuals(db, organizationId, v)

  const drafts = buildCopyDrafts(actuals, {
    fiscalYear:     loaded.version.fiscalYear,
    shape:          v.shape,
    granularity:    v.granularity,
    includeContact: v.includeContact ?? false,
    adjustmentPct:  v.adjustmentPct,
  })

  if (drafts.length > MAX_COPIED_SERIES) {
    return {
      error: `O período gera ${drafts.length} lançamentos, acima do limite de ${MAX_COPIED_SERIES}. `
           + (v.includeContact
              ? 'Desmarque "abrir por contato", use o detalhamento "Por categoria" ou reduza o período.'
              : 'Use o detalhamento "Por categoria" ou reduza o período.'),
    }
  }

  return { input: v, fiscalYear: loaded.version.fiscalYear, drafts, semCategoria, inativas }
}

/**
 * O que a cópia criaria, sem gravar nada. A gravação refaz o cálculo do zero — a
 * prévia serve para o usuário decidir, nunca como fonte do que se grava.
 */
export async function preverCopia(
  organizationId: string,
  input: CopyActualsInput,
): Promise<{ preview: CopyActualsPreview } | { error: string }> {
  const planned = await planejarCopia(organizationId, input)
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
export async function aplicarCopia(
  organizationId: string,
  userId: string,
  input: CopyActualsInput,
) {
  const planned = await planejarCopia(organizationId, input)
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

  return { success: true as const, ...result }
}
