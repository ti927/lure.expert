'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, dataSources } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { getPluggyClient, createConnectToken as pluggyCreateToken } from '@/lib/pluggy'

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

  if (existing) {
    await db.update(dataSources)
      .set({
        status: 'active',
        lastSyncAt: item.lastUpdatedAt ?? null,
        lastSyncStatus: item.executionStatus as string,
        metadata: metadata as Record<string, unknown>,
      })
      .where(eq(dataSources.id, existing.id))
  } else {
    await db.insert(dataSources).values({
      organizationId,
      provider: 'pluggy',
      externalItemId: itemId,
      type,
      name: item.connector.name,
      status: 'active',
      lastSyncAt: item.lastUpdatedAt ?? null,
      lastSyncStatus: item.executionStatus as string,
      metadata: metadata as Record<string, unknown>,
    })
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
    ))
    .orderBy(dataSources.createdAt)
}
