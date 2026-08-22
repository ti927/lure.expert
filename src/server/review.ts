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
  contacts,
} from '@/db/schema'
import { eq, and, isNotNull, desc, count, inArray, sql, ilike, gte, lte, or, isNull } from 'drizzle-orm'
import { dimensionExistsFilter } from '@/lib/sql-dimensions'

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

export interface ReviewFilters {
  page?: number
  q?: string
  from?: string
  to?: string
  direction?: string
  category?: string
  costCenter?: string
  businessUnit?: string
  legalEntity?: string
  contact?: string
}

export async function getReviewQueue(filters: ReviewFilters = {}) {
  const { organizationId } = await getAuthContext()
  const page = filters.page ?? 1
  const offset = (page - 1) * PAGE_SIZE

  function buildWhere() {
    const conditions = [
      eq(transactions.organizationId, organizationId),
      eq(transactions.needsReview, true),
    ]
    if (filters.q) {
      conditions.push(ilike(transactions.description, `%${filters.q}%`))
    }
    if (filters.from) {
      conditions.push(gte(transactions.date, filters.from))
    }
    if (filters.to) {
      conditions.push(lte(transactions.date, filters.to))
    }
    if (filters.direction && filters.direction !== 'all') {
      conditions.push(eq(transactions.direction, filters.direction as 'inflow' | 'outflow'))
    }
    if (filters.category) {
      const ids = filters.category.split(',').filter(Boolean)
      if (ids.includes('__none__')) {
        const rest = ids.filter(id => id !== '__none__')
        conditions.push(rest.length > 0
          ? or(isNull(transactions.categoryId), inArray(transactions.categoryId, rest))!
          : isNull(transactions.categoryId))
      } else {
        conditions.push(inArray(transactions.categoryId, ids))
      }
    }
    // As quatro dimensões perguntam pelas LINHAS do lançamento (ver
    // `dimensionExistsFilter`): num lançamento rateado a coluna do pai é nula e
    // a classificação vive nas partes. A fila continua listando lançamentos.
    for (const [param, coluna] of [
      [filters.costCenter,   'cost_center_id'],
      [filters.businessUnit, 'business_unit_id'],
      [filters.legalEntity,  'legal_entity_id'],
      [filters.contact,      'contact_id'],
    ] as const) {
      if (!param) continue
      const ids = param.split(',').filter(Boolean)
      const cond = dimensionExistsFilter(transactions.id, coluna, {
        ids: ids.filter(id => id !== '__none__'),
        includeNone: ids.includes('__none__'),
        includeClassified: false,
      })
      if (cond) conditions.push(cond)
    }
    return and(...conditions)
  }

  const whereClause = buildWhere()

  const [rows, [{ total }], cats, ccs, bus, les, cts] = await Promise.all([
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
      contactId: transactions.contactId,
    })
      .from(transactions)
      .where(whereClause)
      .orderBy(desc(transactions.date))
      .limit(PAGE_SIZE)
      .offset(offset),

    db.select({ total: count() })
      .from(transactions)
      .where(whereClause),

    db.select({ id: categories.id, code: categories.code, name: categories.name, type: categories.type, parentId: categories.parentId })
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

    // Inclui inativo de propósito: a fila mostra o que já está gravado, e
    // contato desativado depois da classificação ainda precisa de nome.
    db.select({ id: contacts.id, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.organizationId, organizationId)),
  ])

  const catMap = Object.fromEntries(cats.map(c => [c.id, `${c.code} – ${c.name}`]))
  const ccMap = Object.fromEntries(ccs.map(c => [c.id, c.name]))
  const buMap = Object.fromEntries(bus.map(b => [b.id, b.name]))
  const leMap = Object.fromEntries(les.map(l => [l.id, l.name]))
  const ctMap = Object.fromEntries(cts.map(c => [c.id, c.name]))

  return {
    rows: rows.map(r => ({
      ...r,
      categoryName: r.categoryId ? (catMap[r.categoryId] ?? null) : null,
      costCenterName: r.costCenterId ? (ccMap[r.costCenterId] ?? null) : null,
      businessUnitName: r.businessUnitId ? (buMap[r.businessUnitId] ?? null) : null,
      legalEntityName: r.legalEntityId ? (leMap[r.legalEntityId] ?? null) : null,
      contactName: r.contactId ? (ctMap[r.contactId] ?? null) : null,
    })),
    options: {
      categories: cats,
      costCenters: ccs,
      businessUnits: bus,
      legalEntities: les,
      contacts: cts,
    },
    total,
    pages: Math.ceil(total / PAGE_SIZE),
    page,
    filters,
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
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
      costCenterId: transactions.costCenterId,
      businessUnitId: transactions.businessUnitId,
      legalEntityId: transactions.legalEntityId,
      contactId: transactions.contactId,
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
    await upsertRuleFromConfirmation(organizationId, desc, tx.accountId, {
      categoryId: tx.categoryId,
      costCenterId: tx.costCenterId ?? null,
      businessUnitId: tx.businessUnitId ?? null,
      legalEntityId: tx.legalEntityId ?? null,
      contactId: tx.contactId ?? null,
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
      contactId: null,
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
  accountId: string | null,
  data: {
    categoryId: string | null
    costCenterId: string | null
    businessUnitId: string | null
    legalEntityId: string | null
    contactId: string | null
  },
) {
  const trimmed = description.slice(0, 200)

  // Chave de identidade composta: (description, accountId) — mesmo formato de upsertRule em transactions.ts.
  const [existing] = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(
      eq(categorizationRules.organizationId, organizationId),
      sql`${categorizationRules.conditions}->>'description' = ${trimmed}`,
      accountId
        ? sql`${categorizationRules.conditions}->>'accountId' = ${accountId}`
        : sql`${categorizationRules.conditions}->>'accountId' IS NULL`,
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
        targetContactId: data.contactId,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(categorizationRules.id, existing.id))
  } else {
    const conditions: Record<string, string> = { description: trimmed }
    if (accountId) conditions.accountId = accountId

    await db.insert(categorizationRules).values({
      organizationId,
      name: `Auto: ${trimmed.slice(0, 80)}`,
      conditions,
      targetCategoryId: data.categoryId,
      targetCostCenterId: data.costCenterId,
      targetBusinessUnitId: data.businessUnitId,
      targetLegalEntityId: data.legalEntityId,
      targetContactId: data.contactId,
      autoGenerated: true,
      confirmedAt: new Date(),
      priority: 0,
    })
  }
}
