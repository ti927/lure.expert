// RFC 7009 — revogação de token.
//
// A regra estranha do RFC, e ela é deliberada: **sempre 200**, mesmo para token
// inexistente ou já revogado. Responder 404 transformaria este endpoint num
// oráculo que diz se um token existe, e o cliente não tem o que fazer com a
// diferença de qualquer forma — o efeito desejado ("este token não vale mais")
// já é verdade nos dois casos.

import { autenticarCliente, revogarPorToken } from '@/lib/oauth/store'
import { erroOauth, preflight, corpoDaRequisicao, credenciaisDoCliente } from '@/lib/oauth/http'
import { CABECALHOS_CORS } from '@/lib/oauth/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const corpo = await corpoDaRequisicao(req)
  const cred = credenciaisDoCliente(req, corpo)

  if (!cred.clientId) return erroOauth('invalid_client', 'client_id ausente.', 401)

  const auth = await autenticarCliente(cred.clientId, cred.clientSecret)
  if (!auth.ok) return erroOauth('invalid_client', 'Cliente não autenticado.', 401)

  if (corpo.token) {
    try {
      await revogarPorToken(corpo.token)
    } catch (e) {
      console.error('[oauth/revoke] falha', e)
      return erroOauth('server_error', 'Não foi possível revogar agora.', 500)
    }
  }

  return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store', ...CABECALHOS_CORS } })
}

export async function OPTIONS() {
  return preflight()
}
