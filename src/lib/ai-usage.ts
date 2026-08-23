// Registro de uso de IA — o ÚNICO ponto de escrita de custo em `agent_events`.
//
// Antes da Fase 0 só a categorização registrava consumo (`logCategorizationEvent`),
// e os outros três consumidores eram invisíveis: o parser de PDF (a chamada mais
// cara por unidade — manda o arquivo inteiro), o parser de CSV, e o chat (que
// gravava tokens em `messages`, uma tabela que ninguém somava). O resultado era
// não conseguir responder "quanto este cliente consumiu".
//
// Sem `'use server'`: precisa ser chamável de dentro de job Inngest e de parser,
// que não têm sessão HTTP.

import { db } from '@/db'
import { agentEvents } from '@/db/schema'
import { calcCostUsd, isKnownModel, type TokenUsage } from './ai-pricing'

/** De onde veio a chamada. Vira `agent_events.type`. */
export type AiUsageKind =
  | 'categorization'
  | 'document_parse_pdf'
  | 'document_parse_csv'
  // O teste de chave gasta de verdade (1 token), e o que nao e medido nao
  // entra em teto -- entao aparece no consumo como qualquer outra chamada.
  | 'key_validation'

/**
 * Rótulos para a tela de consumo.
 *
 * Vive aqui e não em `server/ai-consumption.ts` porque aquele arquivo é
 * `'use server'`, e a diretiva só deixa exportar função async.
 */
export const ROTULOS_USO_IA: Record<string, string> = {
  categorization:     'Classificação de lançamentos',
  document_parse_pdf: 'Leitura de extrato PDF',
  document_parse_csv: 'Leitura de planilha e CSV',
  key_validation:     'Teste de chave',
}

export interface RegistrarUsoParams {
  organizationId: string
  kind:           AiUsageKind
  model:          string
  usage:          TokenUsage
  entityType?:    string
  entityId?:      string | null
  /** Detalhes específicos do consumidor; entra em `payload`. */
  payload?:       Record<string, unknown>
  durationMs?:    number
  success?:       boolean
  errorMessage?:  string | null
}

/**
 * Grava uma linha de consumo.
 *
 * **Nunca lança.** Uma falha de telemetria não pode derrubar a importação nem a
 * categorização do cliente — o custo já foi gasto de qualquer forma, e perder o
 * registro é menos grave que perder o trabalho. O erro vai para o log do
 * servidor, onde é visível sem ser fatal.
 */
export async function registrarUsoDeIa(params: RegistrarUsoParams): Promise<void> {
  const {
    organizationId, kind, model, usage,
    entityType, entityId, payload, durationMs, success = true, errorMessage,
  } = params

  try {
    const costUsd = calcCostUsd(model, usage)

    await db.insert(agentEvents).values({
      organizationId,
      type:       kind,
      entityType: entityType ?? null,
      entityId:   entityId ?? null,
      payload: {
        ...(payload ?? {}),
        cacheReadTokens:  usage.cacheReadTokens  ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        // Modelo fora da tabela de preços custa 0 no cálculo. Marcar aqui é o
        // que impede o buraco de virar silêncio: a tela consegue avisar em vez
        // de mostrar um total que parece certo.
        ...(isKnownModel(model) ? {} : { precoDesconhecido: true }),
      },
      modelUsed:    model,
      tokensInput:  usage.inputTokens,
      tokensOutput: usage.outputTokens,
      costUsd:      costUsd.toFixed(6),
      durationMs:   durationMs ?? null,
      success,
      errorMessage: errorMessage ?? null,
    })
  } catch (e) {
    console.error('[ai-usage] falha ao registrar consumo', {
      organizationId, kind, model, erro: (e as Error).message,
    })
  }
}

/**
 * Extrai tokens da resposta do SDK da Anthropic.
 *
 * `cache_read_input_tokens` e `cache_creation_input_tokens` não estão no tipo
 * público do SDK em todas as versões, daí o acesso indexado — é o mesmo
 * contorno que `categorizer.ts` já fazia.
 */
export function tokensDaResposta(usage: unknown): Required<TokenUsage> {
  const u = (usage ?? {}) as Record<string, number>
  return {
    inputTokens:      u.input_tokens  ?? 0,
    outputTokens:     u.output_tokens ?? 0,
    cacheReadTokens:  u.cache_read_input_tokens     ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  }
}
