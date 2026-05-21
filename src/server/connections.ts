'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, dataSources, transactions } from '@/db/schema'
import type { DataSource } from '@/db/schema'
import { eq, and, isNotNull, ne, inArray, desc, count } from 'drizzle-orm'
import { getPluggyClient, createConnectToken as pluggyCreateToken, isGenericPluggyConnector } from '@/lib/pluggy'
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

export async function getCurrentOrgId(): Promise<string> {
  const { organizationId } = await getAuthContext()
  return organizationId
}

export async function registerPluggyItem(itemId: string): Promise<{ success: true } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const client = getPluggyClient()
  const [item, accountsResult] = await Promise.all([
    client.fetchItem(itemId),
    client.fetchAccounts(itemId),
  ])

  const type = mapConnectorType(item.connector.type as string)
  const accounts = accountsResult.results.map(a => ({
    id: a.id,
    name: a.name,
    marketingName: a.marketingName,
    type: a.type as string,
    subtype: a.subtype as string,
    number: a.number,
  }))
  const baseMetadata: Record<string, unknown> = {
    connectorId: item.connector.id,
    institutionName: item.connector.name,
    institutionImageUrl: item.connector.imageUrl,
    isSandbox: (item.connector.isSandbox ?? false) || isGenericPluggyConnector(item.connector.name),
    products: item.connector.products,
    executionStatus: item.executionStatus,
    accounts,
  }

  const [existing] = await db
    .select({ id: dataSources.id, metadata: dataSources.metadata })
    .from(dataSources)
    .where(and(
      eq(dataSources.organizationId, organizationId),
      eq(dataSources.externalItemId, itemId),
    ))
    .limit(1)

  if (existing) {
    // Reconexão: preserva customizações do usuário e o flag awaitingFirstSync se ainda estava ativo
    const existingMeta = (existing.metadata ?? {}) as Record<string, unknown>
    const finalMetadata: Record<string, unknown> = { ...existingMeta, ...baseMetadata }
    if (existingMeta.awaitingFirstSync !== true) {
      delete finalMetadata.awaitingFirstSync
    } else {
      finalMetadata.awaitingFirstSync = true
    }

    await db.update(dataSources)
      .set({
        status: 'active',
        lastSyncAt: item.lastUpdatedAt ?? null,
        lastSyncStatus: item.executionStatus as string,
        metadata: finalMetadata,
        updatedAt: new Date(),
      })
      .where(eq(dataSources.id, existing.id))
  } else {
    // Conexão nova: marca como aguardando primeiro sync manual.
    // Sem isso, qualquer disparador (cron diário, webhook item/updated) iniciaria
    // sync de 7-365 dias sem o usuário escolher a data de corte.
    await db.insert(dataSources).values({
      organizationId,
      provider: 'pluggy',
      externalItemId: itemId,
      type,
      name: item.connector.name,
      status: 'active',
      lastSyncAt: item.lastUpdatedAt ?? null,
      lastSyncStatus: item.executionStatus as string,
      metadata: { ...baseMetadata, awaitingFirstSync: true },
    })
  }

  // Sync não é disparado aqui — o usuário decide a data de corte clicando
  // no botão de sync em /contas (triggerManualSync com forceFirstSync: true).
  return { success: true }
}

export interface DataSourceOption {
  accountId: string       // transactions.account_id — chave do filtro
  label: string           // "Banco · Tipo · Número"
  txCount: number
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  CHECKING_ACCOUNT: 'C. Corrente',
  SAVINGS_ACCOUNT:  'Poupança',
  CREDIT_CARD:      'Cartão',
}

export async function getDataSourcesWithTransactions(): Promise<DataSourceOption[]> {
  const { organizationId } = await getAuthContext()

  const { sql: rawSql } = await import('drizzle-orm')

  type AccRow = {
    account_id:       string
    account_number:   string | null
    account_type:     string | null
    account_name:     string | null
    tx_count:         string
    institution_name: string | null
  }

  // Agrupa por conta individual (não por conexão) usando as colunas reais de transactions.
  // institution_name usa customLabel quando o usuário renomeou a conexão.
  const rows = await db.execute<AccRow>(rawSql`
    SELECT
      t.account_id,
      t.account_number,
      t.account_type,
      t.account_name,
      COUNT(*)::text                                                                              AS tx_count,
      coalesce(ds.metadata->>'customLabel', ds.metadata->>'institutionName')                      AS institution_name
    FROM transactions t
    JOIN data_sources ds ON t.data_source_id = ds.id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.status != 'pending'
      AND t.account_id IS NOT NULL
    GROUP BY t.account_id, t.account_number, t.account_type, t.account_name,
             coalesce(ds.metadata->>'customLabel', ds.metadata->>'institutionName')
    ORDER BY institution_name, t.account_type, t.account_number
  `)

  return rows.map(r => {
    const bank      = r.institution_name ?? 'Banco'
    const typeLabel = r.account_type ? (ACCOUNT_TYPE_LABELS[r.account_type] ?? r.account_type) : ''
    const numLabel  = r.account_number ? ` · ${r.account_number}` : ''
    return {
      accountId: r.account_id,
      label:     `${bank} · ${typeLabel}${numLabel}`,
      txCount:   Number(r.tx_count),
    }
  })
}

export type OrgConnection = DataSource & { customLogoUrl: string | null }

export async function getOrgConnections(): Promise<OrgConnection[]> {
  const { organizationId } = await getAuthContext()
  const rows = await db
    .select()
    .from(dataSources)
    .where(and(
      eq(dataSources.organizationId, organizationId),
      eq(dataSources.provider, 'pluggy'),
      ne(dataSources.status, 'inactive'),
    ))
    .orderBy(dataSources.createdAt)

  const supabase = createClient()
  return Promise.all(rows.map(async row => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>
    const customLogoPath = typeof meta.customLogoPath === 'string' ? meta.customLogoPath : null
    let customLogoUrl: string | null = null
    if (customLogoPath) {
      const { data } = await supabase.storage.from('documents').createSignedUrl(customLogoPath, 3600)
      customLogoUrl = data?.signedUrl ?? null
    }
    return { ...row, customLogoUrl }
  }))
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
  pluggyCategory: string | null
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
      dataSourceMetadata: dataSources.metadata,
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
    const dsMeta = (r.dataSourceMetadata ?? {}) as Record<string, unknown>
    const customLabel = typeof dsMeta.customLabel === 'string' ? dsMeta.customLabel.trim() : ''
    const displayName = customLabel || r.dataSourceName
    if (!map.has(r.dataSourceId)) {
      map.set(r.dataSourceId, {
        dataSourceId: r.dataSourceId,
        dataSourceName: displayName,
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
      dataSourceName: displayName,
      dataSourceActive: r.dataSourceStatus !== 'inactive',
      accountName: meta.accountName ?? null,
      accountSubtype: meta.accountSubtype ?? null,
      accountNumber: meta.accountNumber ?? null,
      pluggyCategory: meta.pluggyCategory ?? null,
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
      data: {
        itemId: source.externalItemId,
        organizationId,
        dataSourceId: source.id,
        forceFirstSync: true,
        ...(fromDate ? { fromDate } : {}),
      },
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

export async function setConnectionLogoPath(
  dataSourceId: string,
  storagePath: string,
): Promise<{ success: true } | { error: string }> {
  const { organizationId } = await getAuthContext()

  // Path deve começar com o orgId para passar RLS do bucket
  if (!storagePath.startsWith(`${organizationId}/`)) {
    return { error: 'Caminho inválido.' }
  }

  const [source] = await db
    .select({ id: dataSources.id, metadata: dataSources.metadata })
    .from(dataSources)
    .where(and(eq(dataSources.id, dataSourceId), eq(dataSources.organizationId, organizationId)))
    .limit(1)

  if (!source) return { error: 'Conexão não encontrada.' }

  const meta = (source.metadata ?? {}) as Record<string, unknown>
  const previousPath = typeof meta.customLogoPath === 'string' ? meta.customLogoPath : null

  await db
    .update(dataSources)
    .set({ metadata: { ...meta, customLogoPath: storagePath }, updatedAt: new Date() })
    .where(eq(dataSources.id, dataSourceId))

  // Limpa o arquivo antigo (best-effort)
  if (previousPath && previousPath !== storagePath) {
    const supabase = createClient()
    try { await supabase.storage.from('documents').remove([previousPath]) } catch {}
  }

  revalidatePath('/contas')
  return { success: true }
}

export async function removeConnectionLogo(
  dataSourceId: string,
): Promise<{ success: true } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const [source] = await db
    .select({ id: dataSources.id, metadata: dataSources.metadata })
    .from(dataSources)
    .where(and(eq(dataSources.id, dataSourceId), eq(dataSources.organizationId, organizationId)))
    .limit(1)

  if (!source) return { error: 'Conexão não encontrada.' }

  const meta = (source.metadata ?? {}) as Record<string, unknown>
  const previousPath = typeof meta.customLogoPath === 'string' ? meta.customLogoPath : null
  if (!previousPath) return { success: true }

  const next = { ...meta }
  delete next.customLogoPath

  await db
    .update(dataSources)
    .set({ metadata: next, updatedAt: new Date() })
    .where(eq(dataSources.id, dataSourceId))

  const supabase = createClient()
  try { await supabase.storage.from('documents').remove([previousPath]) } catch {}

  revalidatePath('/contas')
  return { success: true }
}

export async function updateConnectionCustomization(
  dataSourceId: string,
  input: { customLabel: string | null; customBadge: string | null },
): Promise<{ success: true } | { error: string }> {
  const { organizationId } = await getAuthContext()

  const [source] = await db
    .select({ id: dataSources.id, metadata: dataSources.metadata })
    .from(dataSources)
    .where(and(
      eq(dataSources.id, dataSourceId),
      eq(dataSources.organizationId, organizationId),
    ))
    .limit(1)

  if (!source) return { error: 'Conexão não encontrada.' }

  const meta = (source.metadata ?? {}) as Record<string, unknown>
  const next: Record<string, unknown> = { ...meta }

  const label = input.customLabel?.trim()
  if (label) next.customLabel = label
  else delete next.customLabel

  const badge = input.customBadge?.trim()
  if (badge) next.customBadge = { text: badge }
  else delete next.customBadge

  await db
    .update(dataSources)
    .set({ metadata: next, updatedAt: new Date() })
    .where(eq(dataSources.id, dataSourceId))

  revalidatePath('/contas')
  revalidatePath('/transacoes')
  return { success: true }
}
