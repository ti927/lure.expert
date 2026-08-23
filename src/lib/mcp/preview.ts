// Preview → confirm sem tela.
//
// O molde são os 15 pares que já existem no app, onde o commit sempre recalcula
// do zero. O que muda aqui é que não há um humano olhando um diálogo: quem
// confirma é o modelo. Então o padrão precisa de dentes próprios, senão vira
// decoração — um modelo que propõe e confirma sozinho não está confirmando nada.
//
// Os dentes são três:
//
//   1. `aplicar_*` exige o `previaId` E a palavra literal "aplicar". Não é
//      cerimônia: é o que impede a aplicação de acontecer por acidente numa
//      chamada montada às pressas, e o que faz o texto da confirmação aparecer
//      na conversa, onde o humano lê.
//   2. O apply RECALCULA e compara com o resumo gravado. Divergiu a contagem ou
//      o total, recusa — o mundo mudou entre propor e aplicar, e aplicar sobre
//      uma fotografia velha é como se apaga o trabalho de outra pessoa.
//   3. A prévia é consumida ATOMICAMENTE. A mesma prévia não aplica duas vezes.
//
// SEM TABELA NOVA: a prévia mora em `agent_events`, que é onde o princípio 10
// manda registrar proposta, confirmação e aplicação de qualquer forma. O id do
// evento É o `previaId`, e lê-se por chave primária.

import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { agentEvents } from '@/db/schema'

/** Curta de propósito: prévia velha descreve um mundo que já não existe. */
export const VALIDADE_PREVIA_SEGUNDOS = 15 * 60

export const PALAVRA_DE_CONFIRMACAO = 'aplicar'

export interface ResumoComparavel {
  /** Quantos registros a operação atinge. */
  quantidade: number
  /** Soma em reais, quando faz sentido. Comparada com tolerância de centavo. */
  valorTotal?: number
}

export async function registrarPrevia(p: {
  organizationId: string
  ferramenta: string
  userId: string
  clientId: string
  resumo: ResumoComparavel & Record<string, unknown>
  /** O pedido original, gravado para o apply refazer exatamente o mesmo. */
  pedido: Record<string, unknown>
}): Promise<{ previaId: string; expiraEm: string }> {
  const expiraEm = new Date(Date.now() + VALIDADE_PREVIA_SEGUNDOS * 1000)

  const [linha] = await db.insert(agentEvents).values({
    organizationId: p.organizationId,
    type: 'mcp_preview',
    entityType: 'mcp_preview',
    payload: {
      ferramenta: p.ferramenta,
      userId: p.userId,
      clientId: p.clientId,
      resumo: p.resumo,
      pedido: p.pedido,
      expiraEm: expiraEm.toISOString(),
      // `proposed_change` é o nome que o princípio 10 usa; mantido para a
      // auditoria falar a mesma língua do resto do app.
      proposed_change: p.pedido,
    },
  }).returning({ id: agentEvents.id })

  return { previaId: linha.id, expiraEm: expiraEm.toISOString() }
}

export type LeituraPrevia =
  | { ok: true; resumo: ResumoComparavel & Record<string, unknown>; pedido: Record<string, unknown> }
  | { ok: false; motivo: string }

/**
 * Consome a prévia, de uma vez só.
 *
 * O `UPDATE ... WHERE payload->>'consumidoEm' IS NULL RETURNING` é o mesmo
 * truque do código de autorização do OAuth: se duas chamadas chegarem com o
 * mesmo `previaId`, o Postgres serializa e exatamente uma leva a linha.
 */
export async function consumirPrevia(p: {
  previaId: string
  ferramenta: string
  organizationId: string
  userId: string
}): Promise<LeituraPrevia> {
  const [linha] = await db.update(agentEvents)
    .set({ payload: sql`${agentEvents.payload} || jsonb_build_object('consumidoEm', now()::text)` })
    .where(and(
      eq(agentEvents.id, p.previaId),
      eq(agentEvents.type, 'mcp_preview'),
      eq(agentEvents.organizationId, p.organizationId),
      sql`${agentEvents.payload}->>'consumidoEm' IS NULL`,
    ))
    .returning({ payload: agentEvents.payload })

  if (!linha) {
    // Descobrir POR QUE não levou: as causas pedem mensagens diferentes, e o
    // modelo só se corrige se souber qual foi.
    const [existente] = await db
      .select({ payload: agentEvents.payload, type: agentEvents.type })
      .from(agentEvents)
      .where(eq(agentEvents.id, p.previaId))
      .limit(1)

    if (!existente || existente.type !== 'mcp_preview') {
      return { ok: false, motivo: 'Prévia não encontrada. Chame a ferramenta prever_ correspondente primeiro.' }
    }
    const pl = existente.payload as Record<string, unknown>
    if (pl.consumidoEm) {
      return { ok: false, motivo: 'Esta prévia já foi aplicada. Gere uma nova se quiser repetir a operação.' }
    }
    return { ok: false, motivo: 'Esta prévia é de outra empresa.' }
  }

  const pl = linha.payload as Record<string, unknown>

  if (pl.ferramenta !== p.ferramenta) {
    return { ok: false, motivo: `Esta prévia foi gerada por ${String(pl.ferramenta)}, não por esta ferramenta.` }
  }
  if (pl.userId !== p.userId) {
    return { ok: false, motivo: 'Esta prévia pertence a outro usuário.' }
  }
  if (typeof pl.expiraEm === 'string' && new Date(pl.expiraEm).getTime() <= Date.now()) {
    return { ok: false, motivo: `Prévia expirada (vale ${VALIDADE_PREVIA_SEGUNDOS / 60} minutos). Gere outra.` }
  }

  return {
    ok: true,
    resumo: (pl.resumo ?? {}) as ResumoComparavel & Record<string, unknown>,
    pedido: (pl.pedido ?? {}) as Record<string, unknown>,
  }
}

/**
 * O mundo ainda é o que a prévia descreveu?
 *
 * Tolerância de um centavo no total: `numeric` volta como string e a conversão
 * para `number` pode diferir na última casa. Contagem é exata — se um lançamento
 * entrou ou saiu do conjunto, a proposta que o humano leu já não é esta.
 */
export function divergiu(previsto: ResumoComparavel, agora: ResumoComparavel): string | null {
  if (previsto.quantidade !== agora.quantidade) {
    return `A prévia dizia ${previsto.quantidade} lançamento(s) e agora são ${agora.quantidade}. ` +
      'Algo mudou no intervalo. Gere uma prévia nova e confira antes de aplicar.'
  }
  if (previsto.valorTotal !== undefined && agora.valorTotal !== undefined
      && Math.abs(previsto.valorTotal - agora.valorTotal) > 0.01) {
    return `A prévia somava R$ ${previsto.valorTotal.toFixed(2)} e agora soma R$ ${agora.valorTotal.toFixed(2)}. ` +
      'Gere uma prévia nova e confira antes de aplicar.'
  }
  return null
}

export async function registrarAplicacao(p: {
  organizationId: string
  ferramenta: string
  previaId: string
  userId: string
  clientId: string
  resultado: Record<string, unknown>
  duracaoMs: number
}): Promise<void> {
  try {
    await db.insert(agentEvents).values({
      organizationId: p.organizationId,
      type: 'mcp_applied',
      entityType: 'mcp_preview',
      entityId: p.previaId,
      payload: {
        ferramenta: p.ferramenta,
        previaId: p.previaId,
        userId: p.userId,
        clientId: p.clientId,
        resultado: p.resultado,
        confirmed_at: new Date().toISOString(),
        applied_at: new Date().toISOString(),
      },
      durationMs: p.duracaoMs,
    })
  } catch (e) {
    console.error('[mcp] falha ao registrar aplicação', (e as Error).message)
  }
}

/** A recusa quando a palavra literal não veio. */
export function exigirConfirmacao(valor: unknown): string | null {
  if (valor === PALAVRA_DE_CONFIRMACAO) return null
  return `Para aplicar, passe confirmacao: "${PALAVRA_DE_CONFIRMACAO}". ` +
    'Mostre antes ao usuário o resumo da prévia e obtenha o aceite dele.'
}
