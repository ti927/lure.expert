import { NextRequest } from 'next/server'
import { db } from '@/db'
import { sefazConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { inngest } from '@/lib/inngest'
import { daysAgoISO } from '@/jobs/sync-pluggy-item'

// Webhook genérico para provedores SEFAZ (Focus NF-e, NFE.io, etc.)
// Cada provedor envia um formato diferente — campos mínimos extraídos abaixo.
// Segurança: lookup por connectionId no body (não há HMAC padronizado entre provedores).

type SefazWebhookBody = {
  event?: string           // 'nfe.authorized' | 'nfe.cancelled' | provider-specific
  connectionId?: string    // ID da conexão SEFAZ no lure.expert (passado pelo cliente na config do webhook)
  cnpj?: string            // CNPJ alternativo ao connectionId
  chaveAcesso?: string     // chNFe da NF que disparou o evento
  error?: string
}

export async function POST(request: NextRequest) {
  let body: SefazWebhookBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  // Resolve a conexão pelo connectionId ou cnpj enviados pelo provedor
  let conn: {
    id: string
    organizationId: string
    lastSyncAt: Date | null
  } | undefined

  if (body.connectionId) {
    const [row] = await db
      .select({ id: sefazConnections.id, organizationId: sefazConnections.organizationId, lastSyncAt: sefazConnections.lastSyncAt })
      .from(sefazConnections)
      .where(eq(sefazConnections.id, body.connectionId))
      .limit(1)
    conn = row
  } else if (body.cnpj) {
    const [row] = await db
      .select({ id: sefazConnections.id, organizationId: sefazConnections.organizationId, lastSyncAt: sefazConnections.lastSyncAt })
      .from(sefazConnections)
      .where(eq(sefazConnections.cnpj, body.cnpj))
      .limit(1)
    conn = row
  }

  // Ignora eventos de conexões desconhecidas (proteção contra chamadas indevidas)
  if (!conn) {
    return Response.json({ ok: true })
  }

  // NF autorizada ou qualquer evento que indica nova NF disponível → dispara sync incremental
  if (!body.event?.includes('error') && !body.event?.includes('cancelled')) {
    const lastFetched = conn.lastSyncAt ? new Date(conn.lastSyncAt) : null

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
        name: 'sefaz/item.sync-requested',
        data: {
          connectionId: conn.id,
          organizationId: conn.organizationId,
          fromDate,
        },
      })
    } catch {
      // Não bloqueia resposta ao provedor se Inngest estiver offline
    }
  }

  if (body.event?.includes('error')) {
    await db
      .update(sefazConnections)
      .set({
        status: 'error',
        lastSyncStatus: 'ERROR',
        lastSyncError: body.error ?? 'Erro reportado pelo provedor SEFAZ',
        updatedAt: new Date(),
      })
      .where(eq(sefazConnections.id, conn.id))
  }

  return Response.json({ ok: true })
}
