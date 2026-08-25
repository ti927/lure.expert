'use server'

import { getAuthContext } from '@/lib/auth-context'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/db'
import {
  costCenters,
  businessUnits,
  legalEntities,
  transactions,
  categories,
  categorizationRules,
  contacts,
  budgetSeries,
  budgetEntries,
} from '@/db/schema'
import { eq, and, isNotNull, count, asc } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

const nameSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(100),
  code: z.string().max(20).optional(),
})

const legalEntitySchema = nameSchema.extend({
  cnpj: z.string().max(18).optional(),
})

/**
 * Quantos registros perderiam esta classificação se a dimensão fosse deletada.
 *
 * Conta os QUATRO destinos, não só os dois: até a Fase 10 isto olhava apenas
 * `transactions` e `categorization_rules` e ignorava o orçamento, subestimando
 * o estrago exatamente na tela que existe para avisar sobre ele.
 */
async function countLinked(
  organizationId: string,
  id: string,
  cols: { tx: AnyPgColumn; rule: AnyPgColumn; series: AnyPgColumn; entry: AnyPgColumn },
): Promise<number> {
  const [[tx], [rule], [series], [entry]] = await Promise.all([
    db.select({ n: count() }).from(transactions)
      .where(and(eq(cols.tx, id), eq(transactions.organizationId, organizationId))),
    db.select({ n: count() }).from(categorizationRules)
      .where(and(eq(cols.rule, id), eq(categorizationRules.organizationId, organizationId))),
    db.select({ n: count() }).from(budgetSeries)
      .where(and(eq(cols.series, id), eq(budgetSeries.organizationId, organizationId))),
    db.select({ n: count() }).from(budgetEntries)
      .where(and(eq(cols.entry, id), eq(budgetEntries.organizationId, organizationId))),
  ])
  return tx.n + rule.n + series.n + entry.n
}

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
  return countLinked(organizationId, id, {
    tx:     transactions.costCenterId,
    rule:   categorizationRules.targetCostCenterId,
    series: budgetSeries.costCenterId,
    entry:  budgetEntries.costCenterId,
  })
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
  return countLinked(organizationId, id, {
    tx:     transactions.businessUnitId,
    rule:   categorizationRules.targetBusinessUnitId,
    series: budgetSeries.businessUnitId,
    entry:  budgetEntries.businessUnitId,
  })
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
  return countLinked(organizationId, id, {
    tx:     transactions.legalEntityId,
    rule:   categorizationRules.targetLegalEntityId,
    series: budgetSeries.legalEntityId,
    entry:  budgetEntries.legalEntityId,
  })
}

// ─── CONTATOS (clientes e fornecedores) ──────────────────────────────────────

/**
 * `type` é derivado do papel. A coluna continua NOT NULL porque
 * `docs/SCHEMA_INICIAL.md` a define assim; a verdade são os dois booleanos.
 */
function deriveContactType(isCustomer: boolean, isSupplier: boolean): string {
  if (isCustomer && isSupplier) return 'both'
  if (isCustomer) return 'customer'
  if (isSupplier) return 'supplier'
  return 'other'
}

/** CNPJ/CPF só com dígitos — é o que o índice único (org, document) espera. */
function normalizeDocument(raw: string | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.length > 0 ? digits : null
}

const contactSchema = z.object({
  name:     z.string().min(1, 'Nome obrigatório').max(200),
  code:     z.string().max(20).optional(),
  document: z.string().max(32).optional(),
  email:    z.string().max(150).optional(),
  phone:    z.string().max(40).optional(),
  isCustomer: z.boolean(),
  isSupplier: z.boolean(),
}).refine(v => v.isCustomer || v.isSupplier, {
  // Sem papel o contato não aparece em nenhum filtro de cliente ou fornecedor —
  // seria um cadastro invisível.
  message: 'Marque ao menos um papel: cliente ou fornecedor.',
  path: ['isCustomer'],
})

function parseContactForm(formData: FormData) {
  return contactSchema.safeParse({
    name:     formData.get('name'),
    code:     formData.get('code') || undefined,
    document: formData.get('document') || undefined,
    email:    formData.get('email') || undefined,
    phone:    formData.get('phone') || undefined,
    isCustomer: formData.get('isCustomer') === 'on' || formData.get('isCustomer') === 'true',
    isSupplier: formData.get('isSupplier') === 'on' || formData.get('isSupplier') === 'true',
  })
}

/** Violação do índice único (organization_id, document). */
function isDuplicateDocument(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  const msg  = err instanceof Error ? err.message : String(err)
  return code === '23505' || msg.includes('contacts_org_document_unique')
}

export async function getContacts() {
  const { organizationId } = await getAuthContext()
  return db
    .select()
    .from(contacts)
    .where(eq(contacts.organizationId, organizationId))
    .orderBy(asc(contacts.name))
}

export async function createContact(formData: FormData) {
  const { organizationId } = await getAuthContext()
  const parsed = parseContactForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { isCustomer, isSupplier, document, ...rest } = parsed.data
  try {
    await db.insert(contacts).values({
      organizationId,
      ...rest,
      document: normalizeDocument(document),
      isCustomer,
      isSupplier,
      type: deriveContactType(isCustomer, isSupplier),
    })
  } catch (err) {
    if (isDuplicateDocument(err)) return { error: 'Já existe um contato com este CNPJ/CPF.' }
    throw err
  }
  revalidatePath('/configuracoes/contatos')
  return { success: true }
}

export async function updateContact(id: string, formData: FormData) {
  const { organizationId } = await getAuthContext()
  const parsed = parseContactForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { isCustomer, isSupplier, document, ...rest } = parsed.data
  try {
    await db
      .update(contacts)
      .set({
        ...rest,
        document: normalizeDocument(document),
        isCustomer,
        isSupplier,
        type: deriveContactType(isCustomer, isSupplier),
      })
      .where(and(eq(contacts.id, id), eq(contacts.organizationId, organizationId)))
  } catch (err) {
    if (isDuplicateDocument(err)) return { error: 'Já existe um contato com este CNPJ/CPF.' }
    throw err
  }
  revalidatePath('/configuracoes/contatos')
  return { success: true }
}

export async function toggleContactActive(id: string, isActive: boolean) {
  const { organizationId } = await getAuthContext()
  await db
    .update(contacts)
    .set({ isActive })
    .where(and(eq(contacts.id, id), eq(contacts.organizationId, organizationId)))
  revalidatePath('/configuracoes/contatos')
  return { success: true }
}

export async function deleteContact(id: string) {
  const { organizationId } = await getAuthContext()
  await db
    .delete(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.organizationId, organizationId)))
  revalidatePath('/configuracoes/contatos')
  return { success: true }
}

export async function getContactLinkedCount(id: string) {
  const { organizationId } = await getAuthContext()
  return countLinked(organizationId, id, {
    tx:     transactions.contactId,
    rule:   categorizationRules.targetContactId,
    series: budgetSeries.contactId,
    entry:  budgetEntries.contactId,
  })
}

/**
 * Lista enxuta para selects (o orçamento associa um contato ao lançamento e,
 * a partir da Fase 10, a classificação de transações também).
 *
 * `code` recebe o código curto quando existe e cai para o documento — é o que
 * o `CellCombobox` mostra em fonte monoespaçada antes do nome.
 */
export async function getContactOptions() {
  const { organizationId } = await getAuthContext()
  const rows = await db
    .select({
      id:       contacts.id,
      name:     contacts.name,
      code:     contacts.code,
      document: contacts.document,
    })
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), eq(contacts.isActive, true)))
    .orderBy(asc(contacts.name))

  return rows.map(r => ({ id: r.id, name: r.name, code: r.code ?? r.document }))
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
