import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { transactions, dataSources } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { getPluggyClient } from '@/lib/pluggy'

const DAYS_BACK = 90
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

    // Busca todas as contas do item
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

    // Para cada conta, busca todas as transações dos últimos 90 dias
    for (const account of accountIds) {
      const insertedIds = await step.run(`sync-account-${account.id}`, async () => {
        const client = getPluggyClient()

        // Loop cursor manual: contorna possível bug do SDK ao parsear a URL de next,
        // e garante pageSize: 500 para minimizar roundtrips
        const txList: Awaited<ReturnType<typeof client.fetchAllTransactions>> = []
        let after: string | undefined = undefined
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const page = await client.fetchTransactionsCursor(
            account.id,
            // pageSize: 500 não está no tipo público mas é aceito pela API Pluggy v2
            { dateFrom, pageSize: 500, ...(after ? { after } : {}) } as Parameters<typeof client.fetchTransactionsCursor>[1] & { pageSize?: number },
          )
          txList.push(...page.results)
          if (!page.next) break
          const nextAfter = new URL(page.next, 'https://api.pluggy.ai').searchParams.get('after')
          if (!nextAfter) break
          after = nextAfter
        }

        if (txList.length === 0) return []

        const ids: string[] = []

        for (let i = 0; i < txList.length; i += BATCH_SIZE) {
          const batch = txList.slice(i, i + BATCH_SIZE)
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
                },
                needsReview: false,
                status: 'pending',
              }))
            )
            .onConflictDoNothing()
            .returning({ id: transactions.id })

          ids.push(...rows.map(r => r.id))
        }

        return ids
      })

      allInsertedIds.push(...insertedIds)
    }

    // Atualiza data_sources com lastSyncAt e lastTransactionFetchedAt no metadata
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

    // Dispara categorização automática e reconciliação das transações novas
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

    return { synced: allInsertedIds.length, accounts: accountIds.length }
  },
)
