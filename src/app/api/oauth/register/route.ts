// RFC 7591 — registro dinâmico de cliente.
//
// O spec do MCP marca como SHOULD, mas na prática é o que dispensa combinar um
// client id de antemão: o claude.ai se registra sozinho na primeira conexão.
//
// Registro ABERTO, sem autenticação, que é o desenho previsto pelo RFC para este
// caso. O que um registro dá a quem o faz é uma linha em `mcp_oauth_clients` — e
// nada acontece com ela até um humano autenticado consentir na tela.

import { registroSchema } from '@/lib/oauth/clients'
import { registrarCliente } from '@/lib/oauth/store'
import { respostaJson, erroOauth, preflight } from '@/lib/oauth/http'
import { TTL_ACCESS_SEGUNDOS } from '@/lib/oauth/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // O corpo é lido UMA vez. Ao contrário do endpoint de token, aqui o formato é
  // JSON de verdade — `redirect_uris` é lista, e lista não sobrevive a
  // form-urlencoded —, então não passa pelo helper que achata tudo em string.
  let cru: unknown
  try {
    cru = JSON.parse(await req.text())
  } catch {
    return erroOauth('invalid_client_metadata', 'O corpo precisa ser JSON.', 400)
  }

  const lido = registroSchema.safeParse(cru)
  if (!lido.success) {
    const primeiro = lido.error.issues[0]
    const caminho = primeiro.path.join('.')
    const codigo = caminho.startsWith('redirect_uris') ? 'invalid_redirect_uri' : 'invalid_client_metadata'
    return erroOauth(codigo, `${caminho || 'corpo'}: ${primeiro.message}`, 400)
  }

  try {
    const { clientId, clientSecret } = await registrarCliente(lido.data)

    return respostaJson({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      client_name: lido.data.client_name,
      redirect_uris: lido.data.redirect_uris,
      grant_types: lido.data.grant_types,
      response_types: ['code'],
      token_endpoint_auth_method: lido.data.token_endpoint_auth_method,
      scope: 'leitura escrita',
      // Informativo: quanto vive o access token que este cliente vai receber.
      access_token_lifetime: TTL_ACCESS_SEGUNDOS,
    }, 201)
  } catch (e) {
    console.error('[oauth/register] falha', e)
    return erroOauth('server_error', 'Não foi possível registrar o cliente.', 500)
  }
}

export async function OPTIONS() {
  return preflight()
}
