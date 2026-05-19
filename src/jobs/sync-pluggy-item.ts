import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { transactions, dataSources } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { getPluggyClient } from '@/lib/pluggy'

const DAYS_BACK = 365
const BATCH_SIZE = 100

export function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

export const syncPluggyItem = inngest.createFunction(
  {
    id: 'sync-pluggy-item',
    name: 'Sincronizar item Pluggy',
    triggers: [{ event: 'pluggy/item.connected' }],
    concurrency: { limit: 1, key: 'event.data.dataSourceId' },
  },
  async ({ event, step }) => {
    const { itemId, organizationId, dataSourceId, fromDate } = event.data as {
      itemId: string
      organizationId: string
      dataSourceId: string
      fromDate?: string
    }

    const accountIds = await step.run('fetch-accounts', async () => {
      const client = getPluggyClient()
      const result = await client.fetchAccounts(itemId)
      return result.results.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type as string,
        subtype: a.subtype as string,
        number: a.number,
      }))
    })

    if (accountIds.length === 0) {
      return { synced: 0, accounts: 0 }
    }

    const dateFrom = fromDate ?? daysAgoISO(DAYS_BACK)
    const dateTo = todayISO()
    const allInsertedIds: string[] = []

    // Um step por página: evita timeout em step único quando há muitas transações.
    // O Inngest memoiza cada step — ao re-invocar a função, steps completos são
    // pulados e o cursor ('after') é derivado do resultado memoizado.
    for (const account of accountIds) {
      let after: string | undefined = undefined
      let pageNum = 0

      while (true) {
        const { insertedIds, next } = await step.run(
          `sync-page-${account.id}-p${pageNum}`,
          async () => {
            const client = getPluggyClient()
            const page = await client.fetchTransactionsCursor(
              account.id,
              { dateFrom, ...(after ? { after } : {}) },
            )

            if (page.results.length === 0) {
              return { insertedIds: [] as string[], next: null as string | null }
            }

            const ids: string[] = []
            for (let i = 0; i < page.results.length; i += BATCH_SIZE) {
              const batch = page.results.slice(i, i + BATCH_SIZE)
              const rows = await db
                .insert(transactions)
                .values(
                  batch.map(tx => ({
                    organizationId,
                    dataSourceId,
                    externalId: tx.id,
                    date: tx.date.toISOString().split('T')[0],
                    amount: String(Math.abs(tx.amount)),
                    currency: tx.currencyCode ?? 'BRL',
                    direction: tx.type === 'CREDIT' ? 'inflow' : 'outflow',
                    description: tx.description,
                    rawData: tx as unknown as Record<string, unknown>,
                    metadata: {
                      accountId: account.id,
                      accountName: account.name,
                      accountType: account.type,
                      accountSubtype: account.subtype,
                      accountNumber: account.number,
                      pluggyDate: dateTo,
                      pluggyCategory: tx.category ?? null,
                      pluggyCategoryId: tx.categoryId ?? null,
                      merchantName: tx.merchant?.name ?? null,
                      merchantCategory: tx.merchant?.category ?? null,
                    },
                    needsReview: false,
                    status: 'pending',
                  }))
                )
                .onConflictDoNothing()
                .returning({ id: transactions.id })

              ids.push(...rows.map(r => r.id))
            }

            return { insertedIds: ids, next: page.next }
          },
        )

        allInsertedIds.push(...insertedIds)

        if (!next) break
        const nextAfter = new URL(next, 'https://api.pluggy.ai').searchParams.get('after')
        if (!nextAfter) break
        after = nextAfter
        pageNum++
      }
    }

    await step.run('update-data-source', async () => {
      const [current] = await db
        .select({ metadata: dataSources.metadata })
        .from(dataSources)
        .where(and(
          eq(dataSources.id, dataSourceId),
          eq(dataSources.organizationId, organizationId),
        ))
        .limit(1)

      const existingMeta = (current?.metadata ?? {}) as Record<string, unknown>

      await db
        .update(dataSources)
        .set({
          lastSyncAt: new Date(),
          lastSyncStatus: 'SUCCESS',
          metadata: {
            ...existingMeta,
            lastTransactionFetchedAt: new Date().toISOString(),
            accounts: accountIds.map(a => ({
              id: a.id,
              name: a.name,
              type: a.type,
              subtype: a.subtype,
              number: a.number,
            })),
          },
          updatedAt: new Date(),
        })
        .where(and(
          eq(dataSources.id, dataSourceId),
          eq(dataSources.organizationId, organizationId),
        ))
    })

    if (allInsertedIds.length > 0) {
      await step.run('trigger-categorization', async () => {
        await inngest.send({
          name: 'transaction/batch-inserted',
          data: { transactionIds: allInsertedIds, organizationId },
        })
      })

      await step.run('trigger-reconciliation', async () => {
        await inngest.send({
          name: 'pluggy/reconcile.requested',
          data: { transactionIds: allInsertedIds, organizationId },
        })
      })
    }

    return { synced: allInsertedIds.length, accounts: accountIds.length, dateFrom }
  },
)
