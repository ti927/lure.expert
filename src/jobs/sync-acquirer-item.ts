import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { acquirerConnections, dataSources, transactions } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { createAcquirerProvider } from '@/lib/acquirer-provider'

const BATCH_SIZE = 100

export function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

export const syncAcquirerItem = inngest.createFunction(
  {
    id: 'sync-acquirer-item',
    name: 'Sincronizar vendas de adquirente',
    triggers: [{ event: 'acquirer/item.sync-requested' }],
    concurrency: { limit: 1, key: 'event.data.acquirerConnectionId' },
  },
  async ({ event, step }) => {
    const { acquirerConnectionId, organizationId, fromDate } = event.data as {
      acquirerConnectionId: string
      organizationId: string
      fromDate?: string
    }

    const conn = await step.run('check-connection', async () => {
      const [row] = await db
        .select({
          id: acquirerConnections.id,
          provider: acquirerConnections.provider,
          merchantId: acquirerConnections.merchantId,
          apiKeyEncrypted: acquirerConnections.apiKeyEncrypted,
          apiSecretEncrypted: acquirerConnections.apiSecretEncrypted,
          environment: acquirerConnections.environment,
          displayName: acquirerConnections.displayName,
          legalEntityId: acquirerConnections.legalEntityId,
          status: acquirerConnections.status,
          metadata: acquirerConnections.metadata,
        })
        .from(acquirerConnections)
        .where(and(
          eq(acquirerConnections.id, acquirerConnectionId),
          eq(acquirerConnections.organizationId, organizationId),
        ))
        .limit(1)
      return row ?? null
    })

    if (!conn) return { error: 'Conexão não encontrada' }
    if (conn.status === 'inactive') return { error: 'Conexão inativa' }

    const meta = (conn.metadata as Record<string, unknown> | null) ?? {}
    const isAwaiting = meta.awaitingFirstSync === true
    // Sem fromDate explícito e ainda aguardando primeiro sync: pula
    if (isAwaiting && !fromDate) {
      return { synced: 0, skipped: 'awaiting-first-sync' as const }
    }

    // Garante data_source vinculado — FK obrigatória em transactions
    const dataSourceId = await step.run('ensure-data-source', async () => {
      if (typeof meta.dataSourceId === 'string') return meta.dataSourceId

      const [existing] = await db
        .select({ id: dataSources.id })
        .from(dataSources)
        .where(and(
          eq(dataSources.organizationId, organizationId),
          eq(dataSources.externalItemId, acquirerConnectionId),
        ))
        .limit(1)

      if (existing) {
        await db
          .update(acquirerConnections)
          .set({ metadata: { ...meta, dataSourceId: existing.id }, updatedAt: new Date() })
          .where(eq(acquirerConnections.id, acquirerConnectionId))
        return existing.id
      }

      const [created] = await db
        .insert(dataSources)
        .values({
          organizationId,
          type: 'acquirer',
          provider: conn.provider,
          name: conn.displayName || `${conn.provider} ${conn.merchantId}`,
          externalItemId: acquirerConnectionId,
          status: 'active',
          metadata: { acquirerConnectionId, provider: conn.provider, merchantId: conn.merchantId },
        })
        .returning({ id: dataSources.id })

      await db
        .update(acquirerConnections)
        .set({ metadata: { ...meta, dataSourceId: created.id }, updatedAt: new Date() })
        .where(eq(acquirerConnections.id, acquirerConnectionId))

      return created.id
    })

    if (!dataSourceId) return { error: 'Falha ao criar data source' }

    const provider = createAcquirerProvider(conn)
    const dateFrom = fromDate ?? daysAgoISO(30)
    const dateTo = todayISO()
    const allInsertedIds: string[] = []

    let cursor: string | undefined = undefined
    let pageNum = 0

    // Paginação: um step por página para memoização Inngest funcionar corretamente
    while (true) {
      const { insertedIds, hasMore, nextCursor } = await step.run(
        `fetch-page-${pageNum}`,
        async () => {
          const page = await provider.fetchSales(conn.merchantId, dateFrom, dateTo, cursor)

          if (page.sales.length === 0) {
            return { insertedIds: [] as string[], hasMore: false, nextCursor: null as string | null }
          }

          const ids: string[] = []
          for (let i = 0; i < page.sales.length; i += BATCH_SIZE) {
            const batch = page.sales.slice(i, i + BATCH_SIZE)
            const rows = await db
              .insert(transactions)
              .values(
                batch.map(sale => ({
                  organizationId,
                  dataSourceId,
                  externalId: sale.externalId,
                  date: sale.saleDate,
                  effectiveDate: sale.settlementDate,
                  amount: sale.netAmount,
                  currency: 'BRL',
                  direction: 'inflow' as const,
                  description: sale.description
                    || `Venda ${sale.cardBrand ?? conn.provider}${sale.cardType ? ' ' + sale.cardType : ''}`.trim(),
                  accountId: sale.merchantId,
                  accountType: 'ACQUIRER',
                  accountName: conn.displayName || `${conn.provider} ${conn.merchantId}`,
                  legalEntityId: conn.legalEntityId,
                  needsReview: false,
                  status: 'confirmed' as const,
                  rawData: sale as unknown as Record<string, unknown>,
                  metadata: {
                    provider: conn.provider,
                    cardBrand: sale.cardBrand,
                    cardType: sale.cardType,
                    installments: sale.installments,
                    grossAmount: sale.grossAmount,
                    mdrRate: sale.mdrRate,
                    nsu: sale.nsu,
                    authorizationCode: sale.authorizationCode,
                    settlementDate: sale.settlementDate,
                  },
                }))
              )
              .onConflictDoNothing()
              .returning({ id: transactions.id })

            ids.push(...rows.map(r => r.id))
          }

          return { insertedIds: ids, hasMore: page.hasMore, nextCursor: page.nextCursor }
        },
      )

      allInsertedIds.push(...insertedIds)

      if (!hasMore || !nextCursor) break
      cursor = nextCursor
      pageNum++
    }

    // Atualiza status da conexão — lê metadata atual para preservar dataSourceId
    await step.run('update-status', async () => {
      const [current] = await db
        .select({ metadata: acquirerConnections.metadata })
        .from(acquirerConnections)
        .where(eq(acquirerConnections.id, acquirerConnectionId))
        .limit(1)

      const existingMeta = (current?.metadata ?? {}) as Record<string, unknown>
      const nextMeta: Record<string, unknown> = { ...existingMeta }
      delete nextMeta.awaitingFirstSync

      await db
        .update(acquirerConnections)
        .set({
          status: 'active',
          lastSyncAt: new Date(),
          lastSyncStatus: 'SUCCESS',
          lastSyncError: null,
          metadata: nextMeta,
          updatedAt: new Date(),
        })
        .where(eq(acquirerConnections.id, acquirerConnectionId))
    })

    if (allInsertedIds.length > 0) {
      await step.run('trigger-categorization', async () => {
        await inngest.send({
          name: 'transaction/batch-inserted',
          data: { transactionIds: allInsertedIds, organizationId },
        })
      })
    }

    return { synced: allInsertedIds.length, fromDate: dateFrom, toDate: dateTo }
  },
)
