import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { dataSources, organizations } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { daysAgoISO } from './sync-pluggy-item'
import { lerAgenda, deveRodarAgora, horaEmBrasilia } from '@/lib/sync-schedule'

export const syncAllPluggyItems = inngest.createFunction(
  {
    id: 'sync-all-pluggy-items',
    name: 'Sync dos itens Pluggy (agenda por organização)',
    // De hora em hora, e não uma vez por dia: o horário passou a ser escolhido
    // POR ORGANIZAÇÃO (`organizations.settings.syncBancos`), e um cron do
    // Inngest é estático — registrado no deploy, igual para todo mundo. O
    // padrão continua sendo 03:00 BRT, então quem nunca configurar nada
    // sincroniza no mesmo horário de sempre.
    triggers: [{ cron: '0 * * * *' }],
  },
  async ({ step }) => {
    const { hora, items } = await step.run('fetch-due-items', async () => {
      // A hora é lida DENTRO do step, junto da consulta: o Inngest memoiza o
      // resultado, então uma retentativa despacha exatamente o mesmo conjunto
      // em vez de recalcular numa hora diferente.
      const agora = horaEmBrasilia()

      const linhas = await db
        .select({
          id: dataSources.id,
          externalItemId: dataSources.externalItemId,
          organizationId: dataSources.organizationId,
          settings: organizations.settings,
        })
        .from(dataSources)
        .innerJoin(organizations, eq(organizations.id, dataSources.organizationId))
        .where(and(
          eq(dataSources.provider, 'pluggy'),
          eq(dataSources.status, 'active'),
          isNotNull(dataSources.externalItemId),
        ))

      return {
        hora: agora,
        items: linhas.filter(l => deveRodarAgora(lerAgenda(l.settings), agora)),
      }
    })

    if (items.length === 0) return { hora, dispatched: 0, organizacoes: 0 }

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

    return {
      hora,
      dispatched: items.length,
      organizacoes: new Set(items.map(i => i.organizationId)).size,
    }
  },
)
