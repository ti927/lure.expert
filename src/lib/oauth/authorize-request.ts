// A leitura de um pedido de autorização, com as regras que decidem PARA ONDE
// cada erro vai.
//
// Essa é a parte do OAuth que mais se erra, e a regra é contraintuitiva: erro em
// `client_id` ou em `redirect_uri` NÃO pode voltar por redirecionamento. Se o
// destino não foi provado, redirecionar para ele é justamente o ataque —
// transformaria este endpoint num encaminhador aberto que empresta o domínio.
// Só depois de o par (cliente, redirect) conferir é que erros voltam pela URL,
// que é como o cliente OAuth espera recebê-los.
//
// Vive fora da página porque a decisão do formulário revalida exatamente as
// mesmas coisas. Duas cópias dessas regras é como uma delas fica para trás.

import { buscarCliente } from './store'
import { redirectRegistrado, normalizarEscopos, type Escopo } from './clients'
import { mesmaOrigem, recursoCanonico } from './metadata'

export interface PedidoAutorizacao {
  clientId: string
  clientName: string
  redirectUri: string
  state: string | null
  codeChallenge: string
  scopes: Escopo[]
  resource: string
}

export type LeituraPedido =
  /** Não dá para redirecionar: o destino não foi provado. Mostrar na tela. */
  | { status: 'fatal'; mensagem: string }
  /** O par confere; o erro volta pela URL, como o cliente espera. */
  | { status: 'erro'; url: string }
  | { status: 'ok'; pedido: PedidoAutorizacao }

/** Monta a volta com erro preservando o `state`, que é a defesa CSRF do cliente. */
export function urlDeErro(
  redirectUri: string,
  codigo: string,
  descricao: string,
  state: string | null,
): string {
  const u = new URL(redirectUri)
  u.searchParams.set('error', codigo)
  u.searchParams.set('error_description', descricao)
  if (state) u.searchParams.set('state', state)
  return u.toString()
}

export function urlDeSucesso(redirectUri: string, code: string, state: string | null): string {
  const u = new URL(redirectUri)
  u.searchParams.set('code', code)
  if (state) u.searchParams.set('state', state)
  return u.toString()
}

type Params = Record<string, string | string[] | undefined>

const um = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '')

export async function lerPedido(params: Params, base: string): Promise<LeituraPedido> {
  const clientId = um(params.client_id)
  if (!clientId) return { status: 'fatal', mensagem: 'O pedido chegou sem client_id.' }

  const cliente = await buscarCliente(clientId)
  if (!cliente) {
    return {
      status: 'fatal',
      mensagem: 'Cliente não registrado. Um aplicativo precisa se registrar antes de pedir acesso.',
    }
  }

  // Sem `redirect_uri` explícito, o RFC deixa usar o único registrado. Com mais
  // de um, não há como adivinhar — e adivinhar seria escolher para onde mandar
  // um código de autorização.
  const pedido = um(params.redirect_uri)
  let redirectUri: string
  if (pedido) {
    if (!redirectRegistrado(pedido, cliente.redirectUris)) {
      return {
        status: 'fatal',
        mensagem: 'O endereço de retorno não está entre os registrados por este aplicativo.',
      }
    }
    redirectUri = pedido
  } else if (cliente.redirectUris.length === 1) {
    redirectUri = cliente.redirectUris[0]
  } else {
    return {
      status: 'fatal',
      mensagem: 'O pedido chegou sem redirect_uri e o aplicativo registrou mais de um.',
    }
  }

  // Daqui para baixo o destino está provado: o erro volta por ele.
  const state = um(params.state) || null

  const responseType = um(params.response_type)
  if (responseType !== 'code') {
    return {
      status: 'erro',
      url: urlDeErro(redirectUri, 'unsupported_response_type',
        'Somente response_type=code é suportado.', state),
    }
  }

  const codeChallenge = um(params.code_challenge)
  const metodo = um(params.code_challenge_method)
  if (!codeChallenge) {
    return {
      status: 'erro',
      url: urlDeErro(redirectUri, 'invalid_request',
        'code_challenge ausente — o PKCE é obrigatório.', state),
    }
  }
  if (metodo !== 'S256') {
    return {
      status: 'erro',
      url: urlDeErro(redirectUri, 'invalid_request',
        'Somente code_challenge_method=S256 é aceito.', state),
    }
  }

  const resourcePedido = um(params.resource)
  if (resourcePedido && !mesmaOrigem(resourcePedido, base)) {
    return {
      status: 'erro',
      url: urlDeErro(redirectUri, 'invalid_target',
        `Este servidor autoriza acesso apenas a ${recursoCanonico(base)}.`, state),
    }
  }

  return {
    status: 'ok',
    pedido: {
      clientId,
      clientName: cliente.clientName,
      redirectUri,
      state,
      codeChallenge,
      scopes: normalizarEscopos(um(params.scope)),
      resource: resourcePedido || recursoCanonico(base),
    },
  }
}
