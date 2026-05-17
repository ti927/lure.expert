'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  memberships,
  transactions,
  categorizationRules,
  categories,
  costCenters,
  businessUnits,
  legalEntities,
} from '@/db/schema'
import { eq, and, isNotNull, desc, count, inArray, sql } from 'drizzle-orm'

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

const PAGE_SIZE = 30

export async function getReviewQueue(page = 1) {
  const { organizationId } = await getAuthContext()
  const offset = (page - 1) * PAGE_SIZE

  const [rows, [{ total }], cats, ccs, bus, les] = await Promise.all([
    db.select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      direction: transactions.direction,
      categorizationConfidence: transactions.categorizationConfidence,
      categorizationMethod: transactions.categorizationMethod,
      categoryId: transactions.categoryId,
      costCenterId: transactions.costCenterId,
      businessUnitId: transactions.businessUnitId,
      legalEntityId: transactions.legalEntityId,
    })
      .from(transactions)
      .where(and(
        eq(transactions.organizationId, organizationId),
        eq(transactions.needsReview, true),
      ))
      .orderBy(desc(transactions.date))
      .limit(PAGE_SIZE)
      .offset(offset),

    db.select({ total: count() })
      .from(transactions)
      .where(and(
        eq(transactions.organizationId, organizationId),
        eq(transactions.needsReview, true),
      )),

    db.select({ id: categories.id, code: categories.code, name: categories.name })
      .from(categories)
      .where(eq(categories.organizationId, organizationId)),

    db.select({ id: costCenters.id, name: costCenters.name })
      .from(costCenters)
      .where(eq(costCenters.organizationId, organizationId)),

    db.select({ id: businessUnits.id, name: businessUnits.name })
      .from(businessUnits)
      .where(eq(businessUnits.organizationId, organizationId)),

    db.select({ id: legalEntities.id, name: legalEntities.name })
      .from(legalEntities)
      .where(eq(legalEntities.organizationId, organizationId)),
  ])

  const catMap = Object.fromEntries(cats.map(c => [c.id, `${c.code} – ${c.name}`]))
  const ccMap = Object.fromEntries(ccs.map(c => [c.id, c.name]))
  const buMap = Object.fromEntries(bus.map(b => [b.id, b.name]))
  const leMap = Object.fromEntries(les.map(l => [l.id, l.name]))

  return {
    rows: rows.map(r => ({
      ...r,
      categoryName: r.categoryId ? (catMap[r.categoryId] ?? null) : null,
      costCenterName: r.costCenterId ? (ccMap[r.costCenterId] ?? null) : null,
      businessUnitName: r.businessUnitId ? (buMap[r.businessUnitId] ?? null) : null,
      legalEntityName: r.legalEntityId ? (leMap[r.legalEntityId] ?? null) : null,
    })),
    total,
    pages: Math.ceil(total / PAGE_SIZE),
    page,
  }
}

export async function getReviewCount() {
  const { organizationId } = await getAuthContext()
  const [{ total }] = await db
    .select({ total: count() })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, organizationId),
      eq(transactions.needsReview, true),
    ))
  return total
}

// Confirma sugestão: mantém as dimensões sugeridas, cria regra, marca needsReview=false
export async function confirmSuggestions(ids: string[]) {
  const { organizationId } = await getAuthContext()
  if (ids.length === 0) return { error: 'Nenhuma transação selecionada.' }
  if (ids.length > 200) return { error: 'Máximo de 200 por operação.' }

  const txList = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      cleanedDescription: transactions.cleanedDescription,
      categoryId: transactions.categoryId,
      costCenterId: transactions.costCenterId,
      businessUnitId: transactions.businessUnitId,
      legalEntityId: transactions.legalEntityId,
    })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, organizationId),
      inArray(transactions.id, ids),
    ))

  // Marca como revisada (mantém dimensões)
  await db
    .update(transactions)
    .set({ needsReview: false, categorizationMethod: 'manual', updatedAt: new Date() })
    .where(and(
      eq(transactions.organizationId, organizationId),
      inArray(transactions.id, ids),
    ))

  // Cria regras para cada transação confirmada
  for (const tx of txList) {
    if (!tx.categoryId) continue
    const desc = (tx.cleanedDescription || tx.description).slice(0, 200)
    await upsertRuleFromConfirmation(organizationId, desc, {
      categoryId: tx.categoryId,
      costCenterId: tx.costCenterId ?? null,
      businessUnitId: tx.businessUnitId ?? null,
      legalEntityId: tx.legalEntityId ?? null,
    })
  }

  revalidatePath('/transacoes/revisao')
  revalidatePath('/transacoes')
  return { success: true, confirmed: txList.length }
}

// Descarta sugestão: limpa as dimensões sugeridas pelo expert, marca needsReview=false
export async function skipSuggestions(ids: string[]) {
  const { organizationId } = await getAuthContext()
  if (ids.length === 0) return { error: 'Nenhuma transação selecionada.' }
  if (ids.length > 200) return { error: 'Máximo de 200 por operação.' }

  await db
    .update(transactions)
    .set({
      categoryId: null,
      costCenterId: null,
      businessUnitId: null,
      legalEntityId: null,
      categorizationConfidence: null,
      categorizationMethod: null,
      needsReview: false,
      updatedAt: new Date(),
    })
    .where(and(
      eq(transactions.organizationId, organizationId),
      inArray(transactions.id, ids),
    ))

  revalidatePath('/transacoes/revisao')
  revalidatePath('/transacoes')
  return { success: true, skipped: ids.length }
}

async function upsertRuleFromConfirmation(
  organizationId: string,
  description: string,
  data: {
    categoryId: string | null
    costCenterId: string | null
    businessUnitId: string | null
    legalEntityId: string | null
  },
) {
  const [existing] = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(
      eq(categorizationRules.organizationId, organizationId),
      sql`${categorizationRules.conditions}->>'value' = ${description}`,
    ))
    .limit(1)

  if (existing) {
    await db
      .update(categorizationRules)
      .set({
        targetCategoryId: data.categoryId,
        targetCostCenterId: data.costCenterId,
        targetBusinessUnitId: data.businessUnitId,
        targetLegalEntityId: data.legalEntityId,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(categorizationRules.id, existing.id))
  } else {
    await db.insert(categorizationRules).values({
      organizationId,
      name: `Auto: ${description.slice(0, 80)}`,
      conditions: { field: 'description', op: 'contains', value: description },
      targetCategoryId: data.categoryId,
      targetCostCenterId: data.costCenterId,
      targetBusinessUnitId: data.businessUnitId,
      targetLegalEntityId: data.legalEntityId,
      autoGenerated: true,
      confirmedAt: new Date(),
      priority: 0,
    })
  }
}
