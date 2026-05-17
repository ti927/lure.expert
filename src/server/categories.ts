'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, categories, transactions } from '@/db/schema'
import { eq, and, isNotNull, count, sql } from 'drizzle-orm'

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

const CATEGORY_TYPES = ['revenue', 'cost', 'expense', 'asset', 'liability', 'equity', 'transfer'] as const

const createSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(200),
  code: z.string().min(1, 'Código obrigatório').max(30),
  type: z.enum(CATEGORY_TYPES),
  parentId: z.string().uuid().optional(),
})

export async function getCategories() {
  const { organizationId } = await getAuthContext()
  return db
    .select()
    .from(categories)
    .where(eq(categories.organizationId, organizationId))
    .orderBy(categories.code)
}

export async function getCategoriesWithTxCount() {
  const { organizationId } = await getAuthContext()

  const rows = await db
    .select({
      id: categories.id,
      organizationId: categories.organizationId,
      code: categories.code,
      name: categories.name,
      type: categories.type,
      parentId: categories.parentId,
      isActive: categories.isActive,
      metadata: categories.metadata,
      createdAt: categories.createdAt,
      updatedAt: categories.updatedAt,
      txCount: sql<number>`(
        SELECT COUNT(*)::int FROM transactions
        WHERE category_id = ${categories.id}
        AND organization_id = ${organizationId}
      )`,
    })
    .from(categories)
    .where(eq(categories.organizationId, organizationId))
    .orderBy(categories.code)

  return rows
}

export async function createCategory(formData: FormData) {
  const { organizationId } = await getAuthContext()
  const parsed = createSchema.safeParse({
    name: formData.get('name'),
    code: formData.get('code'),
    type: formData.get('type'),
    parentId: formData.get('parentId') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Verifica código único por org
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.organizationId, organizationId), eq(categories.code, parsed.data.code)))
    .limit(1)
  if (existing.length > 0) return { error: 'Já existe uma categoria com este código.' }

  await db.insert(categories).values({
    organizationId,
    name: parsed.data.name,
    code: parsed.data.code,
    type: parsed.data.type,
    parentId: parsed.data.parentId ?? null,
    metadata: {},
  })
  revalidatePath('/configuracoes/categorias')
  return { success: true }
}

export async function updateCategory(id: string, formData: FormData) {
  const { organizationId } = await getAuthContext()
  const name = formData.get('name') as string
  const code = formData.get('code') as string

  if (!name?.trim()) return { error: 'Nome obrigatório' }
  if (!code?.trim()) return { error: 'Código obrigatório' }

  // Verifica código único por org (excluindo a própria categoria)
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(
      eq(categories.organizationId, organizationId),
      eq(categories.code, code.trim()),
      sql`${categories.id} != ${id}`,
    ))
    .limit(1)
  if (existing.length > 0) return { error: 'Já existe uma categoria com este código.' }

  await db
    .update(categories)
    .set({ name: name.trim(), code: code.trim(), updatedAt: new Date() })
    .where(and(eq(categories.id, id), eq(categories.organizationId, organizationId)))
  revalidatePath('/configuracoes/categorias')
  return { success: true }
}

export async function toggleCategoryActive(id: string, isActive: boolean) {
  const { organizationId } = await getAuthContext()
  await db
    .update(categories)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(categories.id, id), eq(categories.organizationId, organizationId)))
  revalidatePath('/configuracoes/categorias')
  return { success: true }
}

export async function deleteCategory(id: string) {
  const { organizationId } = await getAuthContext()

  // Verifica subcategorias (ON DELETE RESTRICT no banco)
  const [{ childCount }] = await db
    .select({ childCount: count() })
    .from(categories)
    .where(and(eq(categories.parentId, id), eq(categories.organizationId, organizationId)))
  if (childCount > 0) {
    return { error: `Esta categoria possui ${childCount} subcategoria(s). Mova ou delete as subcategorias primeiro.` }
  }

  // Verifica transações vinculadas
  const [{ txCount }] = await db
    .select({ txCount: count() })
    .from(transactions)
    .where(and(eq(transactions.categoryId, id), eq(transactions.organizationId, organizationId)))
  if (txCount > 0) {
    return {
      error: `Esta categoria está vinculada a ${txCount} transação(ões). Archive-a em vez de deletar, ou reclassifique as transações primeiro.`,
    }
  }

  await db
    .delete(categories)
    .where(and(eq(categories.id, id), eq(categories.organizationId, organizationId)))
  revalidatePath('/configuracoes/categorias')
  return { success: true }
}
