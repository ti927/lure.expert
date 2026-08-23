// Testa uma chave da Anthropic contra a API, antes de guardá-la.
//
// Fica fora de `server/ai-settings.ts` porque aquela função também grava, e o
// teste precisa ser exercitável sem escrever no banco — é a mesma razão que pôs
// `budget-scope.ts` e `allocation-math.ts` em `/lib`.
//
// Testar antes de gravar não é zelo: chave errada guardada em silêncio só
// apareceria no próximo upload, como falha sem explicação, e o cliente não
// teria como ligar uma coisa à outra.

import Anthropic from '@anthropic-ai/sdk'
import { calcCostUsd, type TokenUsage } from './ai-pricing'

export const MODELO_TESTE = 'claude-haiku-4-5-20251001'

export type ResultadoTesteChave =
  | { ok: true; usage: TokenUsage; custoUsd: number }
  | { ok: false; mensagem: string; status?: number }

/**
 * Uma chamada de 1 token. Custa frações de centavo e é a única forma de saber
 * se a chave vale — validar o formato só pega erro de digitação.
 */
export async function testarChaveAnthropic(chave: string): Promise<ResultadoTesteChave> {
  try {
    const client = new Anthropic({ apiKey: chave })
    const r = await client.messages.create({
      model: MODELO_TESTE,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    })
    const usage: TokenUsage = {
      inputTokens:  r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
    }
    return { ok: true, usage, custoUsd: calcCostUsd(MODELO_TESTE, usage) }
  } catch (e) {
    const err = e as { status?: number; message?: string }
    return { ok: false, status: err.status, mensagem: mensagemDeErro(err.status, err.message) }
  }
}

/**
 * Traduz o erro da API para algo acionável.
 *
 * "401 Unauthorized" não diz ao cliente o que fazer; "confira se a chave está
 * ativa" diz. E 429 quase nunca é excesso de uso aqui — numa chamada de 1
 * token, é conta sem crédito.
 */
function mensagemDeErro(status: number | undefined, bruto: string | undefined): string {
  if (status === 401 || status === 403) {
    return 'A Anthropic recusou esta chave. Confira se ela está ativa e se foi copiada inteira.'
  }
  if (status === 429) {
    return 'A conta desta chave está sem crédito ou atingiu o limite de uso na Anthropic.'
  }
  if (status && status >= 500) {
    return 'A Anthropic está indisponível no momento. Tente de novo em alguns minutos.'
  }
  return `A Anthropic respondeu com erro: ${bruto ?? 'desconhecido'}`
}
