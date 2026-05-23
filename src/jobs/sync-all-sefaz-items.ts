import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { sefazConnections } from '@/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { daysAgoISO } from './sync-pluggy-item'

export const syncAllSefazItems = inngest.createFunction(
  {
    id: 'sync-all-sefaz-items',
    name: 'Sync diário de conexões SEFAZ',
    triggers: [{ cron: '0 5 * * *' }], // 02:00 BRT (UTC-3)
  },
  async ({ step }) => {
    const connections = await step.run('fetch-active-connections', async () => {
      return db
        .select({
          id: sefazConnections.id,
          organizationId: sefazConnections.organizationId,
          metadata: sefazConnections.metadata,
          lastSyncAt: sefazConnections.lastSyncAt,
        })
        .from(sefazConnections)
        .where(and(
          eq(sefazConnections.status, 'active'),
          ne(sefazConnections.status, 'inactive'),
        ))
    })

    if (connections.length === 0) return { dispatched: 0 }

    await step.run('dispatch-syncs', async () => {
      await inngest.send(
        connections.map(conn => {
          const meta = (conn.metadata ?? {}) as Record<string, unknown>
          const lastFetched = conn.lastSyncAt
            ? new Date(conn.lastSyncAt)
            : null

          // Janela segura: 1 dia antes do último sync, ou 7 dias se nunca sincronizado
          let fromDate: string
          if (lastFetched) {
            const d = new Date(lastFetched)
            d.setDate(d.getDate() - 1)
            fromDate = d.toISOString().split('T')[0]
          } else {
            fromDate = daysAgoISO(7)
          }

          // Nunca dispara cron em conexões aguardando primeiro sync manual
          const isAwaiting = meta.awaitingFirstSync === true

          return {
            name: 'sefaz/item.sync-requested' as const,
            data: {
              connectionId: conn.id,
              organizationId: conn.organizationId,
              fromDate,
              forceFirstSync: !isAwaiting ? undefined : false,
            },
          }
        })
      )
    })

    return { dispatched: connections.length }
  },
)
