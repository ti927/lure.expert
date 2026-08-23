// Resposta HTTP no formato que o OAuth exige, e leitura do corpo no formato que
// os clientes mandam.
//
// Separado dos endpoints porque as regras de forma (código de erro, cabeçalho de
// autenticação, CORS) são as mesmas nas quatro rotas, e repeti-las quatro vezes
// é como uma delas fica diferente das outras sem ninguém notar.

/**
 * CORS aberto — e é seguro justamente aqui.
 *
 * Estas rotas não autenticam por cookie: quem chama apresenta código, segredo ou
 * token no corpo. `Access-Control-Allow-Origin: *` só seria perigoso se a
 * credencial viajasse implicitamente, que é o caso das rotas de sessão — e essas
 * ficam de fora, em `/oauth/*`. Sem isto, um cliente MCP que roda no navegador
 * não consegue nem ler a descoberta.
 */
export const CABECALHOS_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
}

export function respostaJson(dados: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Token e código nunca podem ficar em cache de proxy.
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      ...CABECALHOS_CORS,
      ...extra,
    },
  })
}

/** Metadata é pública e estável — vale cachear, ao contrário de token. */
export function respostaMetadata(dados: unknown): Response {
  return new Response(JSON.stringify(dados), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      ...CABECALHOS_CORS,
    },
  })
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CABECALHOS_CORS })
}

/** Os códigos de erro que o RFC 6749 §5.2 define, mais os do RFC 8707. */
export type CodigoErroOauth =
  | 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unauthorized_client'
  | 'unsupported_grant_type' | 'invalid_scope' | 'invalid_target'
  | 'server_error' | 'access_denied' | 'unsupported_response_type'
  | 'invalid_redirect_uri' | 'invalid_client_metadata'

/**
 * Erro no formato do OAuth.
 *
 * `error_description` em português e legível: quem lê é o desenvolvedor de um
 * cliente MCP tentando entender por que a conexão não fecha, e "invalid_grant"
 * sozinho não diz se o código expirou, se já foi usado ou se o PKCE não bate.
 */
export function erroOauth(
  codigo: CodigoErroOauth,
  descricao: string,
  status = 400,
  extra: Record<string, string> = {},
): Response {
  return respostaJson({ error: codigo, error_description: descricao }, status, extra)
}

/**
 * Corpo do request como pares chave/valor.
 *
 * O RFC manda o endpoint de token aceitar `application/x-www-form-urlencoded`, e
 * é o que o claude.ai usa. JSON é aceito junto porque vários clientes mandam
 * assim e recusar seria pedantismo que só produz relato de bug.
 */
export async function corpoDaRequisicao(req: Request): Promise<Record<string, string>> {
  const tipo = (req.headers.get('content-type') ?? '').toLowerCase()
  try {
    if (tipo.includes('application/json')) {
      const j = await req.json()
      if (!j || typeof j !== 'object' || Array.isArray(j)) return {}
      return Object.fromEntries(
        Object.entries(j as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
      )
    }
    const texto = await req.text()
    const pares: Record<string, string> = {}
    new URLSearchParams(texto).forEach((v, k) => { pares[k] = v })
    return pares
  } catch {
    return {}
  }
}

export interface CredenciaisDoCliente {
  clientId: string | null
  clientSecret: string | null
  /** Veio no cabeçalho Basic? Muda o status do erro e o WWW-Authenticate. */
  viaBasic: boolean
}

/**
 * Credenciais do cliente, do cabeçalho Basic ou do corpo.
 *
 * O RFC 6749 §2.3.1 manda `application/x-www-form-urlencoded` nas duas partes do
 * Basic ANTES do base64 — daí o `decodeURIComponent`. Um segredo com `+` ou `%`
 * falharia em silêncio sem isso, e "falha só com alguns segredos" é o tipo de
 * defeito que leva um dia para ser reproduzido.
 */
export function credenciaisDoCliente(req: Request, corpo: Record<string, string>): CredenciaisDoCliente {
  const auth = req.headers.get('authorization') ?? ''
  if (/^basic /i.test(auth)) {
    try {
      const cru = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8')
      const corte = cru.indexOf(':')
      if (corte >= 0) {
        return {
          clientId: decodeURIComponent(cru.slice(0, corte)),
          clientSecret: decodeURIComponent(cru.slice(corte + 1)),
          viaBasic: true,
        }
      }
    } catch {
      // Basic malformado cai no corpo, e o erro sai de lá.
    }
  }
  return {
    clientId: corpo.client_id || null,
    clientSecret: corpo.client_secret || null,
    viaBasic: false,
  }
}

/**
 * A origem da requisição é esta mesma aplicação?
 *
 * Vale só para as rotas de navegador (`/oauth/*`), que autenticam por cookie e
 * por isso são passíveis de CSRF. Um POST vindo de outro site chega sem `Origin`
 * igual ao nosso, e é assim que a decisão de consentimento fica protegida sem
 * inventar um token de formulário.
 */
export function origemPropria(req: Request, base: string): boolean {
  const origem = req.headers.get('origin')
  if (origem) return origem.toLowerCase() === base.toLowerCase()

  // Sem `Origin`: o navegador manda em POST de formulário, mas há proxies que o
  // removem, e falhar aqui derrubaria o consentimento no momento em que o
  // usuário clicou "Autorizar". O `Referer` de mesma origem é a segunda prova —
  // mais fraca, e por isso segunda, não primeira.
  const referer = (req.headers.get('referer') ?? '').toLowerCase()
  return referer.startsWith(base.toLowerCase() + '/')
}
