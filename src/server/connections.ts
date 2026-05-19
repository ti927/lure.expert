'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, dataSources, transactions } from '@/db/schema'
import { eq, and, isNotNull, ne, inArray, desc } from 'drizzle-orm'
import { getPluggyClient, createConnectToken as pluggyCreateToken } from '@/lib/pluggy'
import { revalidatePath } from 'next/cache'
import { inngest } from '@/lib/inngest'

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

function mapConnectorType(connectorType: string): string {
  if (connectorType === 'CREDIT_CARD') return 'credit_card'
  if (connectorType === 'INVESTMENT') return 'investment'
  return 'bank'
}

export async function generateConnectToken(itemId?: string) {
  const { userId } = await getAuthContext()
  return pluggyCreateToken({ itemId, clientUserId: userId })
}

export async function registerPluggyItem(itemId: string) {
  const { organizationId } = await getAuthContext()

  const client = getPluggyClient()
  const item = await client.fetchItem(itemId)

  const type = mapConnectorType(item.connector.type as string)
  const metadata = {
    connectorId: item.connector.id,
    institutionName: item.connector.name,
    institutionImageUrl: item.connector.imageUrl,
    products: item.connector.products,
    executionStatus: item.executionStatus,
  }

  const [existing] = await db
    .select({ id: dataSources.id })
    .from(dataSources)
    .where(and(
      eq(dataSources.organizationId, organizationId),
      eq(dataSources.externalItemId, itemId),
    ))
    .limit(1)

  let dataSourceId: string

  if (existing) {
    await db.update(dataSources)
      .set({
        status: 'active',
        lastSyncAt: item.lastUpdatedAt ?? null,
        lastSyncStatus: item.executionStatus as string,
        metadata: metadata as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(dataSources.id, existing.id))
    dataSourceId = existing.id
  } else {
    const [inserted] = await db.insert(dataSources).values({
      organizationId,
      provider: 'pluggy',
      externalItemId: itemId,
      type,
      name: item.connector.name,
      status: 'active',
      lastSyncAt: item.lastUpdatedAt ?? null,
      lastSyncStatus: item.executionStatus as string,
      metadata: metadata as Record<string, unknown>,
    }).returning({ id: dataSources.id })
    dataSourceId = inserted.id
  }

  try {
    await inngest.send({
      name: 'pluggy/item.connected',
      data: { itemId, organizationId, dataSourceId },
    })
  } catch {
    // não bloqueia o registro se o Inngest estiver offline
  }
}

export async function getOrgConnections() {
  const { organizationId } = await getAuthContext()
  return db
    .select()
    .from(dataSources)
    .where(and(
      eq(dataSources.organizationId, organizationId),
      eq(dataSources.provider, 'pluggy'),
      ne(dataSources.status, 'inactive'),
    ))
    .orderBy(dataSources.createdAt)
}

export type PendingTransaction = {
  id: string
  date: string
  description: string
  amount: string
  direction: string
  dataSourceId: string
  dataSourceName: string
  dataSourceActive: boolean
  accountName: string | null
  accountSubtype: string | null
  accountNumber: string | null
}

export type PendingSource = {
  dataSourceId: string
  dataSourceName: string
  dataSourceActive: boolean
  count: number
  transactions: PendingTransaction[]
}

export async function getPendingTransactionsBySource(): Promise<PendingSource[]> {
  const { organizationId } = await getAuthContext()

  // JOIN direto — inclui data sources inativos para não perder transações orphanadas
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      direction: transactions.direction,
      metadata: transactions.metadata,
      dataSourceId: dataSources.id,
      dataSourceName: dataSources.name,
      dataSourceStatus: dataSources.status,
    })
    .from(transactions)
    .innerJoin(dataSources, eq(dataSources.id, transactions.dataSourceId))
    .where(and(
      eq(transactions.organizationId, organizationId),
      eq(transactions.status, 'pending'),
      eq(dataSources.provider, 'pluggy'),
    ))
    .orderBy(desc(transactions.date))

  if (rows.length === 0) return []

  // Agrupa em memória por data source
  const map = new Map<string, PendingSource>()
  for (const r of rows) {
    if (!map.has(r.dataSourceId)) {
      map.set(r.dataSourceId, {
        dataSourceId: r.dataSourceId,
        dataSourceName: r.dataSourceName,
        dataSourceActive: r.dataSourceStatus !== 'inactive',
        count: 0,
        transactions: [],
      })
    }
    const meta = (r.metadata ?? {}) as Record<string, string>
    const source = map.get(r.dataSourceId)!
    source.count++
    source.transactions.push({
      id: r.id,
      date: r.date,
      description: r.description,
      amount: r.amount,
      direction: r.direction,
      dataSourceId: r.dataSourceId,
      dataSourceName: r.dataSourceName,
      dataSourceActive: r.dataSourceStatus !== 'inactive',
      accountName: meta.accountName ?? null,
      accountSubtype: meta.accountSubtype ?? null,
      accountNumber: meta.accountNumber ?? null,
    })
  }

  return Array.from(map.values())
}

export async function confirmPendingTransactions(dataSourceId: string): Promise<{ confirmed: number } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const [source] = await db
    .select({ id: dataSources.id })
    .from(dataSources)
    .where(and(
      eq(dataSources.id, dataSourceId),
      eq(dataSources.organizationId, organizationId),
    ))
    .limit(1)

  if (!source) return { error: 'Conexão não encontrada.' }

  const pending = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, organizationId),
      eq(transactions.dataSourceId, dataSourceId),
      eq(transactions.status, 'pending'),
    ))

  if (pending.length === 0) return { confirmed: 0 }

  await db
    .update(transactions)
    .set({ status: 'confirmed', updatedAt: new Date() })
    .where(and(
      eq(transactions.organizationId, organizationId),
      inArray(transactions.id, pending.map(p => p.id)),
    ))

  revalidatePath('/contas')
  revalidatePath('/transacoes')
  return { confirmed: pending.length }
}

export async function disconnectBank(dataSourceId: string): Promise<{ success: boolean } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const [source] = await db
    .select({ id: dataSources.id, externalItemId: dataSources.externalItemId })
    .from(dataSources)
    .where(and(
      eq(dataSources.id, dataSourceId),
      eq(dataSources.organizationId, organizationId),
    ))
    .limit(1)

  if (!source) return { error: 'Conexão não encontrada.' }

  // Remove no Pluggy (falha silenciosa — item pode já não existir)
  if (source.externalItemId) {
    try {
      await getPluggyClient().deleteItem(source.externalItemId)
    } catch {
      // ignora: item pode já ter sido removido no Pluggy
    }
  }

  await db
    .update(dataSources)
    .set({ status: 'inactive', updatedAt: new Date() })
    .where(eq(dataSources.id, source.id))

  revalidatePath('/contas')
  return { success: true }
}

export async function triggerManualSync(dataSourceId: string, fromDate?: string): Promise<{ triggered: boolean } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const [source] = await db
    .select({ id: dataSources.id, externalItemId: dataSources.externalItemId })
    .from(dataSources)
    .where(and(
      eq(dataSources.id, dataSourceId),
      eq(dataSources.organizationId, organizationId),
    ))
    .limit(1)

  if (!source) return { error: 'Conexão não encontrada.' }
  if (!source.externalItemId) return { error: 'Item Pluggy não encontrado.' }

  try {
    await inngest.send({
      name: 'pluggy/item.connected',
      data: { itemId: source.externalItemId, organizationId, dataSourceId: source.id, ...(fromDate ? { fromDate } : {}) },
    })
  } catch {
    return { error: 'Não foi possível iniciar a sincronização. Tente novamente.' }
  }

  return { triggered: true }
}

export async function confirmSelectedTransactions(ids: string[]): Promise<{ confirmed: number } | { error: string }> {
  if (ids.length === 0) return { confirmed: 0 }
  const { organizationId } = await getAuthContext()

  await db
    .update(transactions)
    .set({ status: 'confirmed', updatedAt: new Date() })
    .where(and(
      eq(transactions.organizationId, organizationId),
      inArray(transactions.id, ids),
      eq(transactions.status, 'pending'),
    ))

  revalidatePath('/contas')
  revalidatePath('/transacoes')
  return { confirmed: ids.length }
}
