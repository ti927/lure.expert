import { NextRequest } from 'next/server'
import { db } from '@/db'
import { dataSources } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { inngest } from '@/lib/inngest'
import { daysAgoISO } from '@/jobs/sync-pluggy-item'

type PluggyWebhookBody = {
  eventId?: string
  event: string
  itemId?: string
  error?: { code: string; message: string }
}

export async function POST(request: NextRequest) {
  let body: PluggyWebhookBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const { event, itemId } = body

  // Só processa eventos de item relevantes
  if (event !== 'item/updated' && event !== 'item/error') {
    return Response.json({ ok: true })
  }

  if (!itemId) {
    return Response.json({ ok: true })
  }

  // Verifica se o item pertence à nossa plataforma (segurança sem HMAC)
  const [dataSource] = await db
    .select({
      id: dataSources.id,
      organizationId: dataSources.organizationId,
      externalItemId: dataSources.externalItemId,
      metadata: dataSources.metadata,
    })
    .from(dataSources)
    .where(eq(dataSources.externalItemId, itemId))
    .limit(1)

  if (!dataSource) {
    return Response.json({ ok: true })
  }

  if (event === 'item/updated') {
    const meta = (dataSource.metadata ?? {}) as Record<string, string>
    const lastFetched = meta.lastTransactionFetchedAt
      ? new Date(meta.lastTransactionFetchedAt)
      : null

    // Janela segura: 1 dia antes do último fetch, ou 7 dias caso nunca sincronizado
    let fromDate: string
    if (lastFetched) {
      const d = new Date(lastFetched)
      d.setDate(d.getDate() - 1)
      fromDate = d.toISOString().split('T')[0]
    } else {
      fromDate = daysAgoISO(7)
    }

    try {
      await inngest.send({
        name: 'pluggy/item.connected',
        data: {
          itemId,
          organizationId: dataSource.organizationId,
          dataSourceId: dataSource.id,
          fromDate,
        },
      })
    } catch {
      // Não bloqueia a resposta ao Pluggy se o Inngest estiver offline
    }
  }

  if (event === 'item/error') {
    await db
      .update(dataSources)
      .set({
        status: 'error',
        lastSyncStatus: 'ERROR',
        lastSyncError: body.error?.message ?? 'Erro reportado pelo Pluggy',
        updatedAt: new Date(),
      })
      .where(eq(dataSources.id, dataSource.id))
  }

  return Response.json({ ok: true })
}
