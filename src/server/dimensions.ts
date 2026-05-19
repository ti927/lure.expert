'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  memberships,
  costCenters,
  businessUnits,
  legalEntities,
  transactions,
  categories,
  categorizationRules,
} from '@/db/schema'
import { eq, and, isNotNull, count, asc } from 'drizzle-orm'

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

const nameSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(100),
  code: z.string().max(20).optional(),
})

const legalEntitySchema = nameSchema.extend({
  cnpj: z.string().max(18).optional(),
})

// ─── CENTROS DE CUSTO ───────────────────────────────────────────────────────

export async function getCostCenters() {
  const { organizationId } = await getAuthContext()
  return db.select().from(costCenters).where(eq(costCenters.organizationId, organizationId))
}

export async function createCostCenter(formData: FormData) {
  const { organizationId } = await getAuthContext()
  const parsed = nameSchema.safeParse({
    name: formData.get('name'),
    code: formData.get('code') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  await db.insert(costCenters).values({ organizationId, ...parsed.data })
  revalidatePath('/configuracoes/centros-de-custo')
  return { success: true }
}

export async function updateCostCenter(id: string, formData: FormData) {
  const { organizationId } = await getAuthContext()
  const parsed = nameSchema.safeParse({
    name: formData.get('name'),
    code: formData.get('code') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  await db
    .update(costCenters)
    .set(parsed.data)
    .where(and(eq(costCenters.id, id), eq(costCenters.organizationId, organizationId)))
  revalidatePath('/configuracoes/centros-de-custo')
  return { success: true }
}

export async function toggleCostCenterActive(id: string, isActive: boolean) {
  const { organizationId } = await getAuthContext()
  await db
    .update(costCenters)
    .set({ isActive })
    .where(and(eq(costCenters.id, id), eq(costCenters.organizationId, organizationId)))
  revalidatePath('/configuracoes/centros-de-custo')
  return { success: true }
}

export async function deleteCostCenter(id: string) {
  const { organizationId } = await getAuthContext()
  await db
    .delete(costCenters)
    .where(and(eq(costCenters.id, id), eq(costCenters.organizationId, organizationId)))
  revalidatePath('/configuracoes/centros-de-custo')
  return { success: true }
}

export async function getCostCenterLinkedCount(id: string) {
  const { organizationId } = await getAuthContext()
  const [[{ txCount }], [{ ruleCount }]] = await Promise.all([
    db.select({ txCount: count() }).from(transactions)
      .where(and(eq(transactions.costCenterId, id), eq(transactions.organizationId, organizationId))),
    db.select({ ruleCount: count() }).from(categorizationRules)
      .where(and(eq(categorizationRules.targetCostCenterId, id), eq(categorizationRules.organizationId, organizationId))),
  ])
  return txCount + ruleCount
}

// ─── UNIDADES DE NEGÓCIO ────────────────────────────────────────────────────

export async function getBusinessUnits() {
  const { organizationId } = await getAuthContext()
  return db.select().from(businessUnits).where(eq(businessUnits.organizationId, organizationId))
}

export async function createBusinessUnit(formData: FormData) {
  const { organizationId } = await getAuthContext()
  const parsed = nameSchema.safeParse({
    name: formData.get('name'),
    code: formData.get('code') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  await db.insert(businessUnits).values({ organizationId, ...parsed.data })
  revalidatePath('/configuracoes/unidades-de-negocio')
  return { success: true }
}

export async function updateBusinessUnit(id: string, formData: FormData) {
  const { organizationId } = await getAuthContext()
  const parsed = nameSchema.safeParse({
    name: formData.get('name'),
    code: formData.get('code') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  await db
    .update(businessUnits)
    .set(parsed.data)
    .where(and(eq(businessUnits.id, id), eq(businessUnits.organizationId, organizationId)))
  revalidatePath('/configuracoes/unidades-de-negocio')
  return { success: true }
}

export async function toggleBusinessUnitActive(id: string, isActive: boolean) {
  const { organizationId } = await getAuthContext()
  await db
    .update(businessUnits)
    .set({ isActive })
    .where(and(eq(businessUnits.id, id), eq(businessUnits.organizationId, organizationId)))
  revalidatePath('/configuracoes/unidades-de-negocio')
  return { success: true }
}

export async function deleteBusinessUnit(id: string) {
  const { organizationId } = await getAuthContext()
  await db
    .delete(businessUnits)
    .where(and(eq(businessUnits.id, id), eq(businessUnits.organizationId, organizationId)))
  revalidatePath('/configuracoes/unidades-de-negocio')
  return { success: true }
}

export async function getBusinessUnitLinkedCount(id: string) {
  const { organizationId } = await getAuthContext()
  const [[{ txCount }], [{ ruleCount }]] = await Promise.all([
    db.select({ txCount: count() }).from(transactions)
      .where(and(eq(transactions.businessUnitId, id), eq(transactions.organizationId, organizationId))),
    db.select({ ruleCount: count() }).from(categorizationRules)
      .where(and(eq(categorizationRules.targetBusinessUnitId, id), eq(categorizationRules.organizationId, organizationId))),
  ])
  return txCount + ruleCount
}

// ─── ENTIDADES JURÍDICAS ─────────────────────────────────────────────────────

export async function getLegalEntities() {
  const { organizationId } = await getAuthContext()
  return db.select().from(legalEntities).where(eq(legalEntities.organizationId, organizationId))
}

export async function createLegalEntity(formData: FormData) {
  const { organizationId } = await getAuthContext()
  const parsed = legalEntitySchema.safeParse({
    name: formData.get('name'),
    code: formData.get('code') || undefined,
    cnpj: formData.get('cnpj') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  await db.insert(legalEntities).values({ organizationId, ...parsed.data })
  revalidatePath('/configuracoes/entidades-juridicas')
  return { success: true }
}

export async function updateLegalEntity(id: string, formData: FormData) {
  const { organizationId } = await getAuthContext()
  const parsed = legalEntitySchema.safeParse({
    name: formData.get('name'),
    code: formData.get('code') || undefined,
    cnpj: formData.get('cnpj') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  await db
    .update(legalEntities)
    .set(parsed.data)
    .where(and(eq(legalEntities.id, id), eq(legalEntities.organizationId, organizationId)))
  revalidatePath('/configuracoes/entidades-juridicas')
  return { success: true }
}

export async function toggleLegalEntityActive(id: string, isActive: boolean) {
  const { organizationId } = await getAuthContext()
  await db
    .update(legalEntities)
    .set({ isActive })
    .where(and(eq(legalEntities.id, id), eq(legalEntities.organizationId, organizationId)))
  revalidatePath('/configuracoes/entidades-juridicas')
  return { success: true }
}

export async function deleteLegalEntity(id: string) {
  const { organizationId } = await getAuthContext()
  await db
    .delete(legalEntities)
    .where(and(eq(legalEntities.id, id), eq(legalEntities.organizationId, organizationId)))
  revalidatePath('/configuracoes/entidades-juridicas')
  return { success: true }
}

export async function getLegalEntityLinkedCount(id: string) {
  const { organizationId } = await getAuthContext()
  const [[{ txCount }], [{ ruleCount }]] = await Promise.all([
    db.select({ txCount: count() }).from(transactions)
      .where(and(eq(transactions.legalEntityId, id), eq(transactions.organizationId, organizationId))),
    db.select({ ruleCount: count() }).from(categorizationRules)
      .where(and(eq(categorizationRules.targetLegalEntityId, id), eq(categorizationRules.organizationId, organizationId))),
  ])
  return txCount + ruleCount
}

// ─── CATEGORIAS FOLHA ────────────────────────────────────────────────────────

export async function getLeafCategories() {
  const { organizationId } = await getAuthContext()
  return db
    .select({
      id:       categories.id,
      name:     categories.name,
      code:     categories.code,
      type:     categories.type,
      parentId: categories.parentId,
    })
    .from(categories)
    .where(and(
      eq(categories.organizationId, organizationId),
      isNotNull(categories.parentId),
      eq(categories.isActive, true),
    ))
    .orderBy(asc(categories.code))
}
