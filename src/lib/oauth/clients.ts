// Registro dinâmico de cliente (RFC 7591) e validação de redirecionamento.
//
// O spec do MCP marca o registro dinâmico como SHOULD, mas sem ele o claude.ai
// precisaria de um client id combinado de antemão — inviável para um servidor
// que quer ser conectável.
//
// Puro: nada aqui toca banco. É o que permite exercitar as recusas sem subir
// endpoint nenhum.

import { z } from 'zod'

/**
 * Escopos.
 *
 * `escrita` é separado de propósito: um grant só de leitura faz o servidor
 * sequer REGISTRAR as ferramentas de escrita, então o modelo não as enxerga —
 * é mais forte que recusar na chamada.
 */
export const ESCOPOS = ['leitura', 'escrita'] as const
export type Escopo = (typeof ESCOPOS)[number]

export const ESCOPO_DESCRICAO: Record<Escopo, string> = {
  leitura: 'Consultar DRE, fluxo, orçamento, lançamentos e painéis',
  escrita: 'Classificar lançamentos, ratear, importar arquivos e alterar orçamentos e painéis',
}

/**
 * Um redirect URI aceitável.
 *
 * HTTPS ou localhost, sem fragmento. O spec do MCP é explícito: todo redirect
 * tem de ser localhost ou HTTPS, e a validação no `/authorize` é por igualdade
 * EXATA contra o que foi registrado. Casar por prefixo é o buraco clássico —
 * `https://claude.ai.evil.com` começa com `https://claude.ai`.
 */
export function redirectUriValido(uri: string): boolean {
  let u: URL
  try { u = new URL(uri) } catch { return false }
  if (u.hash) return false
  if (u.protocol === 'https:') return true
  // Localhost em http só é aceitável porque é o caso do cliente de desktop.
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
}

export const registroSchema = z.object({
  client_name: z.string().trim().min(1).max(120),
  redirect_uris: z.array(z.string()).min(1).max(10)
    .refine(uris => uris.every(redirectUriValido),
      'Todo redirect_uri precisa ser HTTPS (ou http em localhost) e não pode ter fragmento.'),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token']))
    .default(['authorization_code', 'refresh_token']),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post', 'client_secret_basic'])
    .default('none'),
  // Aceitos e ignorados: o RFC manda o servidor não recusar campos extras.
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
}).passthrough()

export type RegistroCliente = z.infer<typeof registroSchema>

/**
 * O redirecionamento pedido está entre os registrados?
 *
 * Igualdade exata, e nada de normalizar barra final: `/cb` e `/cb/` são
 * caminhos diferentes para o servidor de quem recebe, e "ajudar" aqui abriria
 * espaço para um redirecionamento que o dono do cliente não registrou.
 */
export function redirectRegistrado(pedido: string, registrados: string[]): boolean {
  return registrados.includes(pedido)
}

/** Escopos pedidos → os que existem, sem duplicata e em ordem estável. */
export function normalizarEscopos(pedido: string | undefined): Escopo[] {
  if (!pedido) return ['leitura']
  const pedidos = new Set(pedido.split(/[\s,]+/).filter(Boolean))
  const validos = ESCOPOS.filter(e => pedidos.has(e))
  return validos.length > 0 ? validos : ['leitura']
}

/**
 * Identificador do cliente.
 *
 * Sem informação dentro: um client id que revele quem registrou vira vetor de
 * enumeração.
 */
export function gerarClientId(): string {
  return 'lure_cli_' + Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex')
}
