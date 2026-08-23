// PKCE (RFC 7636), obrigatório pelo spec de autorização do MCP.
//
// O problema que ele resolve: o código de autorização volta ao cliente pelo
// navegador, e quem interceptar a URL de redirecionamento pode trocá-lo por um
// token. Com PKCE, o cliente sorteia um segredo (`verifier`) antes de começar,
// manda só o hash dele (`challenge`) no pedido, e apresenta o segredo na troca.
// Quem interceptou o código não tem o segredo.
//
// SÓ S256. O método `plain` manda o segredo em claro no primeiro pedido, o que
// anula a proteção inteira — o OAuth 2.1 o removeu, e aceitá-lo aqui seria
// oferecer justamente a porta que o PKCE existe para fechar.

import { createHash } from 'crypto'
import { hashesIguais } from './tokens'

export const METODO_PKCE = 'S256' as const

/** O que o cliente calcula: base64url(SHA-256(verifier)), sem padding. */
export function calcularChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export type ResultadoPkce =
  | { ok: true }
  | { ok: false; erro: 'metodo_invalido' | 'verifier_invalido' | 'nao_confere' }

/**
 * O `code_verifier` apresentado corresponde ao `code_challenge` guardado?
 *
 * O RFC exige entre 43 e 128 caracteres do alfabeto reservado — um verifier
 * curto seria adivinhável por força bruta, e é por isso que o tamanho é regra e
 * não recomendação.
 */
export function verificarPkce(
  verifier: string,
  challengeGuardado: string,
  metodo: string,
): ResultadoPkce {
  if (metodo !== METODO_PKCE) return { ok: false, erro: 'metodo_invalido' }
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return { ok: false, erro: 'verifier_invalido' }
  return hashesIguais(calcularChallenge(verifier), challengeGuardado)
    ? { ok: true }
    : { ok: false, erro: 'nao_confere' }
}

export const MENSAGEM_PKCE: Record<Exclude<ResultadoPkce, { ok: true }>['erro'], string> = {
  metodo_invalido:   'Somente code_challenge_method=S256 é aceito.',
  verifier_invalido: 'O code_verifier precisa ter de 43 a 128 caracteres do alfabeto permitido.',
  nao_confere:       'O code_verifier não corresponde ao code_challenge apresentado na autorização.',
}
