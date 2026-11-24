import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { dataSources } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { getPluggyClient, isGenericPluggyConnector } from '@/lib/pluggy'
import {
  dataEmBrasilia, somarDias, inicioDaReleitura, pendenteMaisAntiga,
  gravarLancamentosPluggy, marcarPendentesQueSumiram,
} from '@/lib/pluggy-sync'

const DAYS_BACK = 365
const BATCH_SIZE = 100

export function daysAgoISO(days: number): string {
  return somarDias(todayISO(), -days)
}

// Em Brasília: o dia do calendário de quem lê a tela, não o de Greenwich.
function todayISO(): string {
  return dataEmBrasilia(new Date())
}

export const syncPluggyItem = inngest.createFunction(
  {
    id: 'sync-pluggy-item',
    name: 'Sincronizar item Pluggy',
    triggers: [{ event: 'pluggy/item.connected' }],
    concurrency: { limit: 1, key: 'event.data.dataSourceId' },
  },
  async ({ event, step }) => {
    const { itemId, organizationId, dataSourceId, fromDate, forceFirstSync } = event.data as {
      itemId: string
      organizationId: string
      dataSourceId: string
      fromDate?: string
      forceFirstSync?: boolean
    }

    // Conexões novas ficam aguardando o usuário escolher a data inicial via sync manual.
    // Webhooks/cron disparam o job, mas a flag bloqueia sync automático.
    const awaiting = await step.run('check-awaiting', async () => {
      const [row] = await db
        .select({ metadata: dataSources.metadata })
        .from(dataSources)
        .where(and(eq(dataSources.id, dataSourceId), eq(dataSources.organizationId, organizationId)))
        .limit(1)
      return (row?.metadata as Record<string, unknown> | null)?.awaitingFirstSync === true
    })
    if (awaiting && !forceFirstSync) {
      return { synced: 0, accounts: 0, skipped: 'awaiting-first-sync' as const }
    }

    const { accountIds, isSandbox } = await step.run('fetch-accounts', async () => {
      const client = getPluggyClient()
      const [result, item] = await Promise.all([
        client.fetchAccounts(itemId),
        client.fetchItem(itemId),
      ])
      return {
        isSandbox: (item.connector.isSandbox ?? false) || isGenericPluggyConnector(item.connector.name),
        accountIds: result.results.map(a => ({
          id: a.id,
          name: a.name,
          marketingName: a.marketingName,
          type: a.type as string,
          subtype: a.subtype as string,
          number: a.number,
        })),
      }
    })

    if (accountIds.length === 0) {
      return { synced: 0, accounts: 0 }
    }

    const dateTo = todayISO()
    // A janela volta até a pendente mais antiga (com teto): é a releitura que
    // descobre que ela foi efetivada — com o mesmo id ou com outro.
    const dateFrom = await step.run('resolve-window', async () => inicioDaReleitura(
      fromDate ?? daysAgoISO(DAYS_BACK),
      await pendenteMaisAntiga(db, organizationId, dataSourceId),
      dateTo,
    ))
    const allInsertedIds: string[] = []
    let updatedCount = 0
    let replacedCount = 0

    // Um step por página: evita timeout em step único quando há muitas transações.
    // O Inngest memoiza cada step — ao re-invocar a função, steps completos são
    // pulados e o cursor ('after') é derivado do resultado memoizado.
    for (const account of accountIds) {
      let after: string | undefined = undefined
      let pageNum = 0
      const readIds: string[] = []
      let oldestRead: string | null = null

      while (true) {
        const { insertedIds, updatedIds, pageIds, pageOldest, next } = await step.run(
          `sync-page-${account.id}-p${pageNum}`,
          async () => {
            const client = getPluggyClient()
            const page = await client.fetchTransactionsCursor(
              account.id,
              { dateFrom, ...(after ? { after } : {}) },
            )

            if (page.results.length === 0) {
              return {
                insertedIds: [] as string[], updatedIds: [] as string[],
                pageIds: [] as string[], pageOldest: null as string | null, next: null as string | null,
              }
            }

            const ids: string[] = []
            const updated: string[] = []
            for (let i = 0; i < page.results.length; i += BATCH_SIZE) {
              const batch = page.results.slice(i, i + BATCH_SIZE)
              const { inseridos, atualizados } = await gravarLancamentosPluggy(
                db,
                  batch.map(tx => ({
                    organizationId,
                    dataSourceId,
                    externalId: tx.id,
                    date: dataEmBrasilia(tx.date),
                    effectiveDate: dataEmBrasilia(tx.date),
                    amount: String(Math.abs(tx.amount)),
                    currency: tx.currencyCode ?? 'BRL',
                    direction: tx.type === 'CREDIT' ? 'inflow' : 'outflow',
                    description: tx.description,
                    // Colunas de conta — permitem filtros indexados sem JSONB
                    accountId:     account.id,
                    accountNumber: account.number,
                    accountType:   account.subtype as string,  // CHECKING_ACCOUNT | CREDIT_CARD | SAVINGS_ACCOUNT
                    accountName:   account.name,
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
                  })),
              )

              ids.push(...inseridos)
              updated.push(...atualizados)
            }

            const dates = page.results.map(tx => dataEmBrasilia(tx.date)).sort()
            return {
              insertedIds: ids,
              updatedIds: updated,
              pageIds: page.results.map(tx => tx.id),
              pageOldest: dates[0] ?? null,
              next: page.next,
            }
          },
        )

        allInsertedIds.push(...insertedIds)
        updatedCount += updatedIds.length
        readIds.push(...pageIds)
        if (pageOldest && (!oldestRead || pageOldest < oldestRead)) oldestRead = pageOldest

        if (!next) break
        const nextAfter = new URL(next, 'https://api.pluggy.ai').searchParams.get('after')
        if (!nextAfter) break
        after = nextAfter
        pageNum++
      }

      // Só depois de ler TODAS as páginas da conta — uma página que falhasse
      // derrubaria a função antes daqui, e nada seria marcado por falta de leitura.
      if (readIds.length > 0 && oldestRead) {
        const margem = somarDias(dateFrom, 1)
        const coberturaDesde = oldestRead > margem ? oldestRead : margem
        replacedCount += await step.run(`replace-pending-${account.id}`, () =>
          marcarPendentesQueSumiram(db, {
            organizationId, dataSourceId, accountId: account.id, idsLidos: readIds, coberturaDesde,
          }),
        )
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
      const nextMeta: Record<string, unknown> = {
        ...existingMeta,
        isSandbox,
        // O FIM da janela lida — gravar o início fazia a releitura nunca avançar.
        lastTransactionFetchedAt: dateTo,
        accounts: accountIds.map(a => ({
          id: a.id,
          name: a.name,
          marketingName: a.marketingName,
          type: a.type,
          subtype: a.subtype,
          number: a.number,
        })),
      }
      // Primeiro sync concluído — libera webhook/cron a sincronizar incrementalmente
      delete nextMeta.awaitingFirstSync

      await db
        .update(dataSources)
        .set({
          lastSyncAt: new Date(),
          lastSyncStatus: 'SUCCESS',
          metadata: nextMeta,
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

    return {
      synced: allInsertedIds.length, updated: updatedCount, replaced: replacedCount,
      accounts: accountIds.length, dateFrom,
    }
  },
)
