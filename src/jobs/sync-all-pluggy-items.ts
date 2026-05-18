import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { dataSources } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { daysAgoISO } from './sync-pluggy-item'

export const syncAllPluggyItems = inngest.createFunction(
  {
    id: 'sync-all-pluggy-items',
    name: 'Sync diário de itens Pluggy',
    triggers: [{ cron: '0 6 * * *' }], // 03:00 BRT (UTC-3, Brasil não usa horário de verão)
  },
  async ({ step }) => {
    const items = await step.run('fetch-active-items', async () => {
      return db
        .select({
          id: dataSources.id,
          externalItemId: dataSources.externalItemId,
          organizationId: dataSources.organizationId,
        })
        .from(dataSources)
        .where(and(
          eq(dataSources.provider, 'pluggy'),
          eq(dataSources.status, 'active'),
          isNotNull(dataSources.externalItemId),
        ))
    })

    if (items.length === 0) return { dispatched: 0 }

    await step.run('dispatch-syncs', async () => {
      await inngest.send(
        items.map(item => ({
          name: 'pluggy/item.connected' as const,
          data: {
            itemId: item.externalItemId!,
            organizationId: item.organizationId,
            dataSourceId: item.id,
            fromDate: daysAgoISO(7),
          },
        }))
      )
    })

    return { dispatched: items.length }
  },
)
