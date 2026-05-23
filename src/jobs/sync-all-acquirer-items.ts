import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { acquirerConnections } from '@/db/schema'
import { ne } from 'drizzle-orm'
import { daysAgoISO } from './sync-acquirer-item'

export const syncAllAcquirerItems = inngest.createFunction(
  {
    id: 'sync-all-acquirer-items',
    name: 'Sync diário de adquirentes',
    triggers: [{ cron: '0 7 * * *' }], // 04:00 BRT (UTC-3)
  },
  async ({ step }) => {
    const connections = await step.run('fetch-active-connections', async () => {
      return db
        .select({
          id: acquirerConnections.id,
          organizationId: acquirerConnections.organizationId,
          lastSyncAt: acquirerConnections.lastSyncAt,
          metadata: acquirerConnections.metadata,
        })
        .from(acquirerConnections)
        .where(ne(acquirerConnections.status, 'inactive'))
    })

    if (connections.length === 0) return { dispatched: 0 }

    const toDispatch = connections.filter(conn => {
      const meta = (conn.metadata as Record<string, unknown> | null) ?? {}
      // Nunca dispara cron em conexões aguardando primeiro sync manual
      return meta.awaitingFirstSync !== true
    })

    if (toDispatch.length === 0) return { dispatched: 0, skipped: connections.length }

    await step.run('dispatch-syncs', async () => {
      await inngest.send(
        toDispatch.map(conn => {
          // Janela segura: 1 dia antes do último sync, ou 7 dias se nunca sincronizado
          let from: string
          if (conn.lastSyncAt) {
            const d = new Date(conn.lastSyncAt)
            d.setDate(d.getDate() - 1)
            from = d.toISOString().split('T')[0]
          } else {
            from = daysAgoISO(7)
          }

          return {
            name: 'acquirer/item.sync-requested' as const,
            data: {
              acquirerConnectionId: conn.id,
              organizationId: conn.organizationId,
              fromDate: from,
            },
          }
        })
      )
    })

    return { dispatched: toDispatch.length }
  },
)
