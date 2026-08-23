// JSON-RPC 2.0, o suficiente para o MCP.
//
// Sem SDK de propósito: o transporte Streamable HTTP, para um servidor SEM
// sessão, é um POST com JSON entrando e JSON saindo. Trazer uma dependência para
// isso acrescentaria superfície e uma versão a acompanhar, e o que o spec exige
// de nós — validar audiência, responder 401 com WWW-Authenticate, não vazar
// `redirect()` — não está em SDK nenhum.

export interface PedidoJsonRpc {
  jsonrpc: '2.0'
  /** Ausente em notificação: notificação não recebe resposta. */
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

/** Códigos do JSON-RPC 2.0, mais o que o MCP usa para "não autorizado". */
export const CODIGO = {
  parse: -32700,
  pedidoInvalido: -32600,
  metodoDesconhecido: -32601,
  parametrosInvalidos: -32602,
  interno: -32603,
} as const

export function resposta(id: unknown, result: unknown) {
  return { jsonrpc: '2.0' as const, id: (id ?? null) as string | number | null, result }
}

export function erro(id: unknown, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0' as const,
    id: (id ?? null) as string | number | null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }
}

export function ehPedidoValido(v: unknown): v is PedidoJsonRpc {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return o.jsonrpc === '2.0' && typeof o.method === 'string'
}

/** Notificação é pedido sem `id` — e o protocolo proíbe responder a ela. */
export function ehNotificacao(p: PedidoJsonRpc): boolean {
  return p.id === undefined || p.id === null
}
