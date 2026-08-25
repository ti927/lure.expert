'use server'

import { getAuthContext } from '@/lib/auth-context'
import { recusaDePapel } from '@/lib/members-types'

import { db } from '@/db'
import { sefazConnections, legalEntities } from '@/db/schema'
import type { SefazConnection } from '@/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { inngest } from '@/lib/inngest'
import { z } from 'zod'

// ─────────────────────────────────────────
// Tipos exportados
// ─────────────────────────────────────────

export type SefazConnectionWithEntity = SefazConnection & {
  legalEntityName: string
  legalEntityCnpj: string | null
}

const createSchema = z.object({
  legalEntityId: z.string().uuid(),
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos sem máscara'),
  provider: z.enum(['focus_nfe', 'nfeio', 'tecnospeed', 'abstract']),
  providerCompanyId: z.string().max(200).optional(),
  apiKey: z.string().max(500).optional(),
  certificateExpiry: z.string().optional().nullable(),
  environment: z.enum(['producao', 'homologacao']),
  pullSaida: z.boolean(),
  pullEntrada: z.boolean(),
  autoManifest: z.boolean(),
})

const updateSchema = createSchema.partial().omit({ legalEntityId: true, cnpj: true })

// ─────────────────────────────────────────
// Criptografia simples de API key (Base64 + prefixo)
// Em produção, usar KMS ou Vault; aqui usamos o mesmo padrão de credentialsEncrypted
// ─────────────────────────────────────────
function encryptApiKey(key: string): string {
  return Buffer.from(key).toString('base64')
}

function decryptApiKey(encrypted: string): string {
  return Buffer.from(encrypted, 'base64').toString('utf-8')
}

// ─────────────────────────────────────────
// Listar conexões da org (com nome da entidade jurídica)
// ─────────────────────────────────────────
export async function listSefazConnections(): Promise<SefazConnectionWithEntity[]> {
  const { organizationId } = await getAuthContext()

  const rows = await db
    .select({
      connection: sefazConnections,
      legalEntityName: legalEntities.name,
      legalEntityCnpj: legalEntities.cnpj,
    })
    .from(sefazConnections)
    .innerJoin(legalEntities, eq(legalEntities.id, sefazConnections.legalEntityId))
    .where(and(
      eq(sefazConnections.organizationId, organizationId),
      ne(sefazConnections.status, 'inactive' as string),
    ))
    .orderBy(sefazConnections.createdAt)

  return rows.map(r => ({
    ...r.connection,
    legalEntityName: r.legalEntityName,
    legalEntityCnpj: r.legalEntityCnpj,
  }))
}

// ─────────────────────────────────────────
// Criar nova conexão SEFAZ
// ─────────────────────────────────────────
export async function createSefazConnection(
  input: z.infer<typeof createSchema>
): Promise<{ id: string } | { error: string }> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { organizationId } = await getAuthContext()
  const data = parsed.data

  // Verifica se a entidade pertence à org
  const [entity] = await db
    .select({ id: legalEntities.id, cnpj: legalEntities.cnpj })
    .from(legalEntities)
    .where(and(
      eq(legalEntities.id, data.legalEntityId),
      eq(legalEntities.organizationId, organizationId),
      eq(legalEntities.isActive, true),
    ))
    .limit(1)

  if (!entity) return { error: 'Entidade jurídica não encontrada.' }

  // Verifica CNPJ da entidade se preenchido (consistência)
  if (entity.cnpj && entity.cnpj !== data.cnpj) {
    return { error: `CNPJ informado (${data.cnpj}) não bate com o CNPJ da entidade (${entity.cnpj}).` }
  }

  // Verifica duplicata de CNPJ na org
  const [existing] = await db
    .select({ id: sefazConnections.id })
    .from(sefazConnections)
    .where(and(
      eq(sefazConnections.organizationId, organizationId),
      eq(sefazConnections.cnpj, data.cnpj),
    ))
    .limit(1)

  if (existing) {
    return { error: `O CNPJ ${data.cnpj} já tem uma conexão SEFAZ ativa.` }
  }

  const [inserted] = await db.insert(sefazConnections).values({
    organizationId,
    legalEntityId: data.legalEntityId,
    cnpj: data.cnpj,
    provider: data.provider,
    providerCompanyId: data.providerCompanyId ?? null,
    apiKeyEncrypted: data.apiKey ? encryptApiKey(data.apiKey) : null,
    certificateExpiry: data.certificateExpiry ?? null,
    environment: data.environment,
    pullSaida: data.pullSaida,
    pullEntrada: data.pullEntrada,
    autoManifest: data.autoManifest,
    status: 'pending',
    metadata: { awaitingFirstSync: true },
  }).returning({ id: sefazConnections.id })

  // Atualiza cnpj da entidade se ainda não tinha
  if (!entity.cnpj) {
    await db
      .update(legalEntities)
      .set({ cnpj: data.cnpj })
      .where(eq(legalEntities.id, data.legalEntityId))
  }

  revalidatePath('/configuracoes/sefaz')
  return { id: inserted.id }
}

// ─────────────────────────────────────────
// Atualizar conexão existente
// ─────────────────────────────────────────
export async function updateSefazConnection(
  connectionId: string,
  input: z.infer<typeof updateSchema>
): Promise<{ success: true } | { error: string }> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { organizationId } = await getAuthContext()

  const [conn] = await db
    .select({ id: sefazConnections.id, apiKeyEncrypted: sefazConnections.apiKeyEncrypted })
    .from(sefazConnections)
    .where(and(
      eq(sefazConnections.id, connectionId),
      eq(sefazConnections.organizationId, organizationId),
    ))
    .limit(1)

  if (!conn) return { error: 'Conexão não encontrada.' }

  const data = parsed.data
  const patch: Partial<typeof sefazConnections.$inferInsert> = {
    updatedAt: new Date(),
  }

  if (data.provider !== undefined) patch.provider = data.provider
  if (data.providerCompanyId !== undefined) patch.providerCompanyId = data.providerCompanyId ?? null
  if (data.apiKey !== undefined) patch.apiKeyEncrypted = data.apiKey ? encryptApiKey(data.apiKey) : conn.apiKeyEncrypted
  if (data.certificateExpiry !== undefined) patch.certificateExpiry = data.certificateExpiry ?? null
  if (data.environment !== undefined) patch.environment = data.environment
  if (data.pullSaida !== undefined) patch.pullSaida = data.pullSaida
  if (data.pullEntrada !== undefined) patch.pullEntrada = data.pullEntrada
  if (data.autoManifest !== undefined) patch.autoManifest = data.autoManifest

  await db
    .update(sefazConnections)
    .set(patch)
    .where(eq(sefazConnections.id, connectionId))

  revalidatePath('/configuracoes/sefaz')
  return { success: true }
}

// ─────────────────────────────────────────
// Remover conexão (soft delete via status='inactive')
// ─────────────────────────────────────────
export async function deleteSefazConnection(
  connectionId: string
): Promise<{ success: true } | { error: string }> {
  const { organizationId, papel } = await getAuthContext()

  // Ponto v1 da matriz (4.B): remover conexão é destrutivo — admin para cima.
  const recusa = recusaDePapel(papel, 'admin', 'remover conexões SEFAZ')
  if (recusa) return { error: recusa }

  const [conn] = await db
    .select({ id: sefazConnections.id })
    .from(sefazConnections)
    .where(and(
      eq(sefazConnections.id, connectionId),
      eq(sefazConnections.organizationId, organizationId),
    ))
    .limit(1)

  if (!conn) return { error: 'Conexão não encontrada.' }

  await db
    .update(sefazConnections)
    .set({ status: 'inactive', updatedAt: new Date() })
    .where(eq(sefazConnections.id, connectionId))

  revalidatePath('/configuracoes/sefaz')
  return { success: true }
}

// ─────────────────────────────────────────
// Disparar sync manual com data de corte (padrão Pluggy)
// ─────────────────────────────────────────
export async function triggerSefazSync(
  connectionId: string,
  fromDate: string
): Promise<{ triggered: boolean } | { error: string }> {
  const { organizationId } = await getAuthContext()

  // Valida fromDate: YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    return { error: 'Data de corte inválida.' }
  }

  const [conn] = await db
    .select({ id: sefazConnections.id, cnpj: sefazConnections.cnpj, status: sefazConnections.status })
    .from(sefazConnections)
    .where(and(
      eq(sefazConnections.id, connectionId),
      eq(sefazConnections.organizationId, organizationId),
    ))
    .limit(1)

  if (!conn) return { error: 'Conexão não encontrada.' }
  if (conn.status === 'inactive') return { error: 'Conexão inativa.' }

  try {
    await inngest.send({
      name: 'sefaz/item.sync-requested',
      data: {
        connectionId: conn.id,
        organizationId,
        fromDate,
        forceFirstSync: true,
      },
    })
  } catch {
    return { error: 'Não foi possível iniciar a sincronização. Tente novamente.' }
  }

  revalidatePath('/configuracoes/sefaz')
  return { triggered: true }
}

// ─────────────────────────────────────────
// Listar entidades jurídicas com CNPJ disponíveis para conectar
// ─────────────────────────────────────────
export async function getLegalEntitiesForSefaz(): Promise<{
  id: string
  name: string
  cnpj: string | null
  alreadyConnected: boolean
}[]> {
  const { organizationId } = await getAuthContext()

  const [entities, connections] = await Promise.all([
    db
      .select({ id: legalEntities.id, name: legalEntities.name, cnpj: legalEntities.cnpj })
      .from(legalEntities)
      .where(and(
        eq(legalEntities.organizationId, organizationId),
        eq(legalEntities.isActive, true),
      ))
      .orderBy(legalEntities.name),
    db
      .select({ legalEntityId: sefazConnections.legalEntityId })
      .from(sefazConnections)
      .where(and(
        eq(sefazConnections.organizationId, organizationId),
        ne(sefazConnections.status, 'inactive' as string),
      )),
  ])

  const connectedIds = new Set(connections.map(c => c.legalEntityId))

  return entities.map(e => ({
    id: e.id,
    name: e.name,
    cnpj: e.cnpj,
    alreadyConnected: connectedIds.has(e.id),
  }))
}

export { decryptApiKey }
