'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, acquirerConnections, legalEntities } from '@/db/schema'
import type { AcquirerConnection } from '@/db/schema'
import { eq, and, isNotNull, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { inngest } from '@/lib/inngest'
import { z } from 'zod'

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

// ─────────────────────────────────────────
// Tipos exportados
// ─────────────────────────────────────────

export type AcquirerConnectionWithEntity = AcquirerConnection & {
  legalEntityName: string | null
}

// ─────────────────────────────────────────
// Criptografia de credenciais (mesmo padrão de sefaz.ts)
// ─────────────────────────────────────────
function encryptApiKey(key: string): string {
  return Buffer.from(key).toString('base64')
}

// ─────────────────────────────────────────
// Schemas de validação
// ─────────────────────────────────────────

const createSchema = z.object({
  provider: z.enum(['stone', 'cielo', 'rede', 'pagbank', 'abstract']),
  merchantId: z.string().min(1, 'Merchant ID é obrigatório').max(200),
  displayName: z.string().max(200).optional(),
  apiKey: z.string().max(1000).optional(),
  apiSecret: z.string().max(1000).optional(),
  environment: z.enum(['producao', 'sandbox']),
  mdrRate: z.number().min(0).max(1).optional().nullable(),
  legalEntityId: z.string().uuid().optional().nullable(),
})

const updateSchema = createSchema.partial().omit({ provider: true, merchantId: true })

// ─────────────────────────────────────────
// Listar conexões de adquirentes da org
// ─────────────────────────────────────────
export async function getAcquirerConnections(): Promise<AcquirerConnectionWithEntity[]> {
  const { organizationId } = await getAuthContext()

  const rows = await db
    .select({
      connection: acquirerConnections,
      legalEntityName: legalEntities.name,
    })
    .from(acquirerConnections)
    .leftJoin(legalEntities, eq(legalEntities.id, acquirerConnections.legalEntityId))
    .where(and(
      eq(acquirerConnections.organizationId, organizationId),
      ne(acquirerConnections.status, 'inactive' as string),
    ))
    .orderBy(acquirerConnections.createdAt)

  return rows.map(r => ({
    ...r.connection,
    legalEntityName: r.legalEntityName ?? null,
  }))
}

// ─────────────────────────────────────────
// Buscar conexão por ID
// ─────────────────────────────────────────
export async function getAcquirerConnectionById(
  id: string,
): Promise<AcquirerConnectionWithEntity | null> {
  const { organizationId } = await getAuthContext()

  const [row] = await db
    .select({
      connection: acquirerConnections,
      legalEntityName: legalEntities.name,
    })
    .from(acquirerConnections)
    .leftJoin(legalEntities, eq(legalEntities.id, acquirerConnections.legalEntityId))
    .where(and(
      eq(acquirerConnections.id, id),
      eq(acquirerConnections.organizationId, organizationId),
    ))
    .limit(1)

  if (!row) return null
  return { ...row.connection, legalEntityName: row.legalEntityName ?? null }
}

// ─────────────────────────────────────────
// Criar nova conexão de adquirente
// ─────────────────────────────────────────
export async function createAcquirerConnection(
  input: z.infer<typeof createSchema>
): Promise<{ id: string } | { error: string }> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { organizationId } = await getAuthContext()
  const data = parsed.data

  // Verifica duplicata (provider + merchantId)
  const [existing] = await db
    .select({ id: acquirerConnections.id })
    .from(acquirerConnections)
    .where(and(
      eq(acquirerConnections.organizationId, organizationId),
      eq(acquirerConnections.provider, data.provider),
      eq(acquirerConnections.merchantId, data.merchantId),
    ))
    .limit(1)

  if (existing) {
    return { error: `O merchantId ${data.merchantId} já tem uma conexão ${data.provider} ativa.` }
  }

  const [inserted] = await db.insert(acquirerConnections).values({
    organizationId,
    provider: data.provider,
    merchantId: data.merchantId,
    displayName: data.displayName ?? null,
    apiKeyEncrypted: data.apiKey ? encryptApiKey(data.apiKey) : null,
    apiSecretEncrypted: data.apiSecret ? encryptApiKey(data.apiSecret) : null,
    environment: data.environment,
    mdrRate: data.mdrRate != null ? String(data.mdrRate) : null,
    legalEntityId: data.legalEntityId ?? null,
    status: 'pending',
    metadata: { awaitingFirstSync: true },
  }).returning({ id: acquirerConnections.id })

  revalidatePath('/contas')
  return { id: inserted.id }
}

// ─────────────────────────────────────────
// Atualizar conexão existente
// ─────────────────────────────────────────
export async function updateAcquirerConnection(
  connectionId: string,
  input: z.infer<typeof updateSchema>
): Promise<{ success: true } | { error: string }> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { organizationId } = await getAuthContext()

  const [conn] = await db
    .select({ id: acquirerConnections.id, apiKeyEncrypted: acquirerConnections.apiKeyEncrypted, apiSecretEncrypted: acquirerConnections.apiSecretEncrypted })
    .from(acquirerConnections)
    .where(and(
      eq(acquirerConnections.id, connectionId),
      eq(acquirerConnections.organizationId, organizationId),
    ))
    .limit(1)

  if (!conn) return { error: 'Conexão não encontrada.' }

  const data = parsed.data
  const patch: Partial<typeof acquirerConnections.$inferInsert> = { updatedAt: new Date() }

  if (data.displayName !== undefined) patch.displayName = data.displayName ?? null
  if (data.apiKey !== undefined) patch.apiKeyEncrypted = data.apiKey ? encryptApiKey(data.apiKey) : conn.apiKeyEncrypted
  if (data.apiSecret !== undefined) patch.apiSecretEncrypted = data.apiSecret ? encryptApiKey(data.apiSecret) : conn.apiSecretEncrypted
  if (data.environment !== undefined) patch.environment = data.environment
  if (data.mdrRate !== undefined) patch.mdrRate = data.mdrRate != null ? String(data.mdrRate) : null
  if (data.legalEntityId !== undefined) patch.legalEntityId = data.legalEntityId ?? null

  await db
    .update(acquirerConnections)
    .set(patch)
    .where(and(
      eq(acquirerConnections.id, connectionId),
      eq(acquirerConnections.organizationId, organizationId),
    ))

  revalidatePath('/contas')
  return { success: true }
}

// ─────────────────────────────────────────
// Remover conexão (soft delete → status='inactive')
// ─────────────────────────────────────────
export async function deleteAcquirerConnection(
  connectionId: string,
): Promise<{ success: true } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const [conn] = await db
    .select({ id: acquirerConnections.id })
    .from(acquirerConnections)
    .where(and(
      eq(acquirerConnections.id, connectionId),
      eq(acquirerConnections.organizationId, organizationId),
    ))
    .limit(1)

  if (!conn) return { error: 'Conexão não encontrada.' }

  await db
    .update(acquirerConnections)
    .set({ status: 'inactive', updatedAt: new Date() })
    .where(eq(acquirerConnections.id, connectionId))

  revalidatePath('/contas')
  return { success: true }
}

// ─────────────────────────────────────────
// Disparar sync manual de um adquirente
// ─────────────────────────────────────────
export async function triggerAcquirerSync(
  connectionId: string,
  fromDate?: string,
): Promise<{ success: true } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const [conn] = await db
    .select({ id: acquirerConnections.id, provider: acquirerConnections.provider, merchantId: acquirerConnections.merchantId })
    .from(acquirerConnections)
    .where(and(
      eq(acquirerConnections.id, connectionId),
      eq(acquirerConnections.organizationId, organizationId),
    ))
    .limit(1)

  if (!conn) return { error: 'Conexão não encontrada.' }

  await inngest.send({
    name: 'acquirer/item.sync-requested',
    data: { acquirerConnectionId: connectionId, organizationId, fromDate },
  })

  return { success: true }
}
