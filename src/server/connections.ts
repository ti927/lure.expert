'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, dataSources, transactions } from '@/db/schema'
import { eq, and, isNotNull, ne, inArray } from 'drizzle-orm'
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

export type PendingSource = {
  dataSourceId: string
  dataSourceName: string
  count: number
  transactions: { id: string; date: string; description: string; amount: string; direction: string }[]
}

export async function getPendingTransactionsBySource(): Promise<PendingSource[]> {
  const { organizationId } = await getAuthContext()

  const sources = await db
    .select({ id: dataSources.id, name: dataSources.name })
    .from(dataSources)
    .where(and(
      eq(dataSources.organizationId, organizationId),
      eq(dataSources.provider, 'pluggy'),
      ne(dataSources.status, 'inactive'),
    ))

  if (sources.length === 0) return []

  const result: PendingSource[] = []

  for (const source of sources) {
    const rows = await db
      .select({
        id: transactions.id,
        date: transactions.date,
        description: transactions.description,
        amount: transactions.amount,
        direction: transactions.direction,
      })
      .from(transactions)
      .where(and(
        eq(transactions.organizationId, organizationId),
        eq(transactions.dataSourceId, source.id),
        eq(transactions.status, 'pending'),
      ))
      .orderBy(transactions.date)
      .limit(200)

    if (rows.length > 0) {
      result.push({
        dataSourceId: source.id,
        dataSourceName: source.name,
        count: rows.length,
        transactions: rows.map(r => ({
          id: r.id,
          date: r.date,
          description: r.description,
          amount: r.amount,
          direction: r.direction,
        })),
      })
    }
  }

  return result
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
