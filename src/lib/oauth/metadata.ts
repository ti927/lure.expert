// Os dois documentos de descoberta que o spec do MCP marca como MUST, e a
// resolução da URL base que ambos precisam.
//
// A base sai dos CABEÇALHOS da requisição, não de uma env. O `issuer` publicado
// tem de ser byte a byte o mesmo host pelo qual o cliente chegou — se ele
// descobriu por `lure-expert.vercel.app` e recebe `lure.expert` de volta, a
// validação dele recusa, com razão. Derivar do request faz produção, preview e
// localhost funcionarem sem configuração.

import { ESCOPOS } from './clients'

/** Onde o servidor MCP vive. É este o valor de `resource` (RFC 8707). */
export const CAMINHO_MCP = '/api/mcp'

function ehLocal(host: string): boolean {
  const semPorta = host.split(':')[0]
  return semPorta === 'localhost' || semPorta === '127.0.0.1' || semPorta === '[::1]'
}

/**
 * A origem pela qual esta requisição chegou.
 *
 * `x-forwarded-*` vem antes de `host` porque na Vercel o `host` interno não é o
 * que o cliente digitou. O primeiro valor da lista é o do cliente; os demais são
 * saltos intermediários.
 */
/** Só o que este módulo precisa de `Headers` — deixa passar o `headers()` de página. */
type LeitorDeCabecalho = { get(nome: string): string | null | undefined }

export function baseUrlDe(fonte: Request | LeitorDeCabecalho): string {
  const h: LeitorDeCabecalho = fonte instanceof Request ? fonte.headers : fonte
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0].trim()
  if (!host) throw new Error('Requisição sem Host: impossível montar o issuer.')
  const proto = ((h.get('x-forwarded-proto') ?? '').split(',')[0].trim())
    || (ehLocal(host) ? 'http' : 'https')
  return `${proto}://${host}`
}

export function recursoCanonico(base: string): string {
  return base + CAMINHO_MCP
}

/**
 * O `resource` pedido é este servidor?
 *
 * Comparação por ORIGEM, não por URL inteira. A regra dura — audiência de token
 * — é impedir que um token nascido para outro serviço valha aqui, e isso a
 * origem já garante. Exigir o caminho exato acrescenta zero segurança e quebra a
 * conexão por uma barra final ou por o cliente mandar a raiz do servidor, que é
 * exatamente o tipo de rigor que faz o usuário desistir sem entender por quê.
 */
export function mesmaOrigem(pedido: string, base: string): boolean {
  try {
    return new URL(pedido).origin.toLowerCase() === new URL(base).origin.toLowerCase()
  } catch {
    return false
  }
}

/** RFC 8414 — metadata do authorization server. */
export function metadataDoServidor(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    scopes_supported: [...ESCOPOS],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // Só S256. `plain` é o método que o OAuth 2.1 removeu, e anunciá-lo aqui
    // seria convidar um cliente a usá-lo para depois ser recusado no banco.
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    service_documentation: 'https://lure.expert',
  }
}

/** RFC 9728 — metadata do recurso protegido. */
export function metadataDoRecurso(base: string) {
  return {
    resource: recursoCanonico(base),
    authorization_servers: [base],
    scopes_supported: [...ESCOPOS],
    bearer_methods_supported: ['header'],
    resource_name: 'lure.expert',
    resource_documentation: 'https://lure.expert',
  }
}

/**
 * O cabeçalho que o 401 do servidor MCP tem de trazer (RFC 9728 §5.1).
 *
 * É ele que faz o cliente descobrir sozinho onde se autorizar em vez de só
 * mostrar "não autorizado" ao usuário.
 */
export function desafioWwwAuthenticate(base: string, descricao?: string): string {
  const partes = [`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`]
  if (descricao) partes.push(`error="invalid_token", error_description="${soAscii(descricao)}"`)
  return partes.join(', ')
}

/**
 * Cabeçalho HTTP não carrega acento.
 *
 * Descoberto na produção: "cabeçalho" saiu como `cabe%C3%A7alho` — o runtime
 * percent-encoda o que não couber em ISO-8859-1, e o cliente lê o escape cru. A
 * mensagem completa e acentuada continua no CORPO da resposta; o cabeçalho fica
 * com a versão sem acento, que é o que um parser estrito espera.
 */
function soAscii(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^ -~]/g, '')
    .replace(/"/g, "'")
}
