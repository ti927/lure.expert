// POST /api/oauth/token — troca de código por token e rotação de refresh.
//
// É o endpoint onde errar vaza entre organizações, então a ordem das checagens é
// deliberada:
//
//   1. autentica o cliente ANTES de tocar no código — senão qualquer um que
//      intercepte um código consegue queimá-lo só por tentar;
//   2. consome o código de forma atômica, e a partir daí ele não vale mais,
//      mesmo que tudo abaixo falhe — uso único é uso único;
//   3. só então confere dono do código, redirect e PKCE.
//
// Código reapresentado é tratado como roubo, não como engano: o RFC 6749 §4.1.2
// manda revogar o que foi emitido a partir dele.

import {
  autenticarCliente, consumirCodigo, garantirGrant, emitirTokens,
  rotacionarRefresh, revogarGrant, revogarTokensDoGrant, grantVivoDe, marcarClienteUsado,
} from '@/lib/oauth/store'
import { verificarPkce, MENSAGEM_PKCE } from '@/lib/oauth/pkce'
import { baseUrlDe, recursoCanonico, mesmaOrigem } from '@/lib/oauth/metadata'
import {
  respostaJson, erroOauth, preflight, corpoDaRequisicao, credenciaisDoCliente,
} from '@/lib/oauth/http'
import type { Escopo } from '@/lib/oauth/clients'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const base = baseUrlDe(req)
  const corpo = await corpoDaRequisicao(req)
  const cred = credenciaisDoCliente(req, corpo)

  if (!cred.clientId) {
    return erroOauth('invalid_client', 'client_id ausente.', 401,
      cred.viaBasic ? { 'WWW-Authenticate': 'Basic realm="lure.expert"' } : {})
  }

  const auth = await autenticarCliente(cred.clientId, cred.clientSecret)
  if (!auth.ok) {
    return erroOauth('invalid_client',
      auth.motivo === 'desconhecido'
        ? 'Cliente não registrado. Registre-se em /api/oauth/register.'
        : 'Segredo do cliente inválido.',
      401,
      cred.viaBasic ? { 'WWW-Authenticate': 'Basic realm="lure.expert"' } : {})
  }

  // O `resource` pedido, quando vem, tem de ser este servidor. É a validação de
  // audiência do RFC 8707 — o que impede um token nosso de ser aceito alhures e
  // vice-versa.
  const resourcePedido = corpo.resource
  if (resourcePedido && !mesmaOrigem(resourcePedido, base)) {
    return erroOauth('invalid_target',
      `Este servidor emite token apenas para ${recursoCanonico(base)}.`, 400)
  }
  const resource = resourcePedido || recursoCanonico(base)

  switch (corpo.grant_type) {
    case 'authorization_code': return porCodigo(corpo, cred.clientId, resource)
    case 'refresh_token':      return porRefresh(corpo, cred.clientId, resource)
    case undefined:
    case '':
      return erroOauth('invalid_request', 'grant_type ausente.', 400)
    default:
      return erroOauth('unsupported_grant_type',
        `grant_type "${corpo.grant_type}" não é suportado. Use authorization_code ou refresh_token.`, 400)
  }
}

async function porCodigo(
  corpo: Record<string, string>,
  clientId: string,
  resource: string,
): Promise<Response> {
  if (!corpo.code) return erroOauth('invalid_request', 'code ausente.', 400)
  if (!corpo.code_verifier) {
    return erroOauth('invalid_request', 'code_verifier ausente — o PKCE é obrigatório.', 400)
  }

  const troca = await consumirCodigo(corpo.code)

  if (troca.status === 'ausente') {
    return erroOauth('invalid_grant', 'Código de autorização desconhecido.', 400)
  }
  if (troca.status === 'expirado') {
    return erroOauth('invalid_grant', 'Código de autorização expirado — ele vale 60 segundos.', 400)
  }
  if (troca.status === 'reusado') {
    // Alguém apresentou duas vezes o mesmo código. O legítimo já trocou; quem
    // veio agora o interceptou. Derruba os tokens nascidos daquele consentimento
    // — o consentimento em si fica de pé, e o próximo uso pede autorização nova.
    const grantId = await grantVivoDe(troca.codigo.userId, troca.codigo.clientId)
    if (grantId) await revogarTokensDoGrant(grantId)
    return erroOauth('invalid_grant',
      'Este código já foi usado. Por segurança, os tokens emitidos a partir dele foram revogados.', 400)
  }

  const codigo = troca.codigo

  // Daqui para baixo o código já está queimado. Cada recusa é definitiva.
  if (codigo.clientId !== clientId) {
    return erroOauth('invalid_grant', 'Este código foi emitido para outro cliente.', 400)
  }
  if (!corpo.redirect_uri || corpo.redirect_uri !== codigo.redirectUri) {
    return erroOauth('invalid_grant',
      'redirect_uri não confere com o usado na autorização.', 400)
  }

  const pkce = verificarPkce(corpo.code_verifier, codigo.codeChallenge, codigo.codeChallengeMethod)
  if (!pkce.ok) return erroOauth('invalid_grant', MENSAGEM_PKCE[pkce.erro], 400)

  const escopos = codigo.scopes as Escopo[]
  const grantId = await garantirGrant({
    userId: codigo.userId,
    clientId,
    organizationIds: codigo.organizationIds,
    scopes: escopos,
  })

  const tokens = await emitirTokens(grantId, codigo.resource ?? resource, escopos)
  await marcarClienteUsado(clientId)

  return respostaJson({
    access_token: tokens.accessToken,
    token_type: 'Bearer',
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: escopos.join(' '),
  })
}

async function porRefresh(
  corpo: Record<string, string>,
  clientId: string,
  resource: string,
): Promise<Response> {
  if (!corpo.refresh_token) return erroOauth('invalid_request', 'refresh_token ausente.', 400)

  const r = await rotacionarRefresh(corpo.refresh_token, resource, clientId)

  if (r.status === 'reuso') {
    // Rotação já aconteceu para este token. Ou ele vazou, ou o cliente perdeu a
    // resposta e retentou. Nos dois casos a cadeia inteira cai: no primeiro
    // corta o ataque, no segundo custa um reconsentimento.
    await revogarGrant(r.grantId)
    return erroOauth('invalid_grant',
      'Este refresh token já havia sido trocado. A conexão foi revogada por segurança; autorize novamente.', 400)
  }
  if (r.status === 'ausente')       return erroOauth('invalid_grant', 'Refresh token desconhecido.', 400)
  if (r.status === 'outro_cliente') return erroOauth('invalid_grant', 'Este refresh token pertence a outro cliente.', 400)
  if (r.status === 'expirado')      return erroOauth('invalid_grant', 'Refresh token expirado — autorize novamente.', 400)
  if (r.status === 'revogado')      return erroOauth('invalid_grant', 'Esta conexão foi revogada. Autorize novamente.', 400)

  await marcarClienteUsado(clientId)

  return respostaJson({
    access_token: r.tokens.accessToken,
    token_type: 'Bearer',
    expires_in: r.tokens.expiresIn,
    refresh_token: r.tokens.refreshToken,
    scope: r.tokens.scopes.join(' '),
  })
}

export async function OPTIONS() {
  return preflight()
}
