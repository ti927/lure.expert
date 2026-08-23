// Preço das chamadas de IA e conversão para real.
//
// Até a Fase 0 estes números viviam soltos dentro de `categorizer.ts`, como
// três multiplicações inline, e os outros consumidores (parsers de PDF e de
// CSV) simplesmente não calculavam custo nenhum. Concentrar aqui é o que
// permite `registrarUsoDeIa` cobrar o mesmo preço de todo mundo.
//
// Sem `'use server'`: é tabela e aritmética pura, importável pelo cliente para
// exibir estimativa antes de disparar um lote.

/** Preço em dólares por TOKEN (não por milhão). */
export interface ModelPricing {
  input:      number
  output:     number
  /** Leitura de cache é ~10× mais barata que input novo. */
  cacheRead:  number
  cacheWrite: number
}

/**
 * ATENÇÃO: os valores de Haiku 4.5 são exatamente os que `categorizer.ts` já
 * usava — foram movidos, não recalculados. Não conferi contra a tabela de
 * preços da Anthropic; se estiverem defasados, o histórico em `agent_events`
 * carrega o mesmo desvio, e corrigir aqui só afeta o que for gravado daqui
 * para frente. Vale conferir antes de mostrar valores ao cliente.
 */
export const AI_PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5-20251001': {
    input:      0.0000008,
    output:     0.000004,
    cacheRead:  0.00000008,
    cacheWrite: 0.000001,
  },
}

/** Usado quando o modelo não está na tabela: custo zero e sinalização. */
export const UNKNOWN_MODEL_PRICING: ModelPricing = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
}

export interface TokenUsage {
  inputTokens:      number
  outputTokens:     number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/**
 * Custo em dólares de uma chamada.
 *
 * Modelo desconhecido devolve 0 em vez de estourar: perder a medição de uma
 * chamada é ruim, derrubar a importação do cliente por causa de um modelo novo
 * é pior. Quem chama registra o `model` mesmo assim, então o buraco fica
 * visível na tela em vez de silencioso.
 */
export function calcCostUsd(model: string, usage: TokenUsage): number {
  const p = AI_PRICING[model] ?? UNKNOWN_MODEL_PRICING
  return (
    usage.inputTokens              * p.input +
    usage.outputTokens             * p.output +
    (usage.cacheReadTokens  ?? 0)  * p.cacheRead +
    (usage.cacheWriteTokens ?? 0)  * p.cacheWrite
  )
}

export function isKnownModel(model: string): boolean {
  return model in AI_PRICING
}

// ─── Conversão para real ─────────────────────────────────────────────────────
//
// `agent_events.cost_usd` guarda SEMPRE dólar. O real é conversão de exibição:
// gravar BRL congelaria uma taxa que muda toda semana, e o histórico deixaria
// de ser comparável consigo mesmo.

/** Taxa padrão quando a organização não configurou a sua. */
export const DEFAULT_USD_BRL = 5.4

export function usdToBrl(usd: number, rate: number = DEFAULT_USD_BRL): number {
  return usd * rate
}

/**
 * Estimativa de custo de um lote de categorização, para o preview do
 * "Categorizar agora".
 *
 * A média de ~1.540 tokens de entrada por lançamento saiu dos 4.309 eventos
 * reais em `agent_events` (6.379.752 de entrada, 495.005 de saída na maior
 * organização). É estimativa declarada, não promessa: o prompt cresce com o
 * tamanho do plano de contas e com a lista de contatos.
 */
export const MEDIA_TOKENS_ENTRADA = 1540
export const MEDIA_TOKENS_SAIDA   = 120

export function estimarCustoCategorizacao(quantidade: number, model = 'claude-haiku-4-5-20251001'): number {
  return calcCostUsd(model, {
    inputTokens:  quantidade * MEDIA_TOKENS_ENTRADA,
    outputTokens: quantidade * MEDIA_TOKENS_SAIDA,
  })
}
