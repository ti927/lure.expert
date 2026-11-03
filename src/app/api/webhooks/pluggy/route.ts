import { NextRequest } from 'next/server'
import { db } from '@/db'
import { dataSources } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { inngest } from '@/lib/inngest'
import { daysAgoISO } from '@/jobs/sync-pluggy-item'
import { somarDias, webhookAutorizado } from '@/lib/pluggy-sync'

type PluggyWebhookBody = {
  eventId?: string
  event: string
  itemId?: string
  error?: { code: string; message: string }
}

export async function POST(request: NextRequest) {
  // O Pluggy não assina o corpo: o segredo vai na URL cadastrada no painel dele.
  // 401 e não 200 — um 200 silencioso esconderia uma URL mal configurada.
  if (!webhookAutorizado(request.nextUrl.searchParams.get('token'), process.env.PLUGGY_WEBHOOK_SECRET)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

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
    // Janela: 1 dia antes de onde a última leitura terminou (`YYYY-MM-DD`), ou 7
    // dias se nunca sincronizou. O job ainda a estende até a pendente mais antiga.
    const lastFetched = /^\d{4}-\d{2}-\d{2}/.test(meta.lastTransactionFetchedAt ?? '')
      ? meta.lastTransactionFetchedAt.slice(0, 10)
      : null
    const fromDate = lastFetched ? somarDias(lastFetched, -1) : daysAgoISO(7)

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
