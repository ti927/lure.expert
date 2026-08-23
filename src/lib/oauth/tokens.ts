// Geração e conferência de tokens OAuth.
//
// HASH, não cifra. Ao contrário da chave de IA da Fase 2, aqui nada precisa
// voltar ao texto claro: o servidor recebe o token e compara o hash. Guardar
// de forma reversível seria dar a si mesmo um poder desnecessário — e um
// vazamento do banco entregaria acesso em vez de entregar hashes inúteis.
//
// O texto claro existe uma única vez: na resposta do endpoint de token.

import { createHash, randomBytes, timingSafeEqual } from 'crypto'

/** Prefixo legível na frente do token, para reconhecê-lo num log por engano. */
export const PREFIXO_ACCESS  = 'lure_at_'
export const PREFIXO_REFRESH = 'lure_rt_'
export const PREFIXO_CODE    = 'lure_ac_'

/**
 * Vidas.
 *
 * O spec do MCP recomenda access token curto para limitar o estrago de um
 * vazamento. Uma hora é o equilíbrio: curto o bastante para importar, longo o
 * bastante para não fazer o cliente renovar no meio de uma conversa.
 */
export const TTL_ACCESS_SEGUNDOS  = 60 * 60          // 1 hora
export const TTL_REFRESH_SEGUNDOS = 60 * 60 * 24 * 30 // 30 dias
/** O código vive o suficiente para o navegador redirecionar, e nada mais. */
export const TTL_CODE_SEGUNDOS    = 60

/** 32 bytes de aleatoriedade real, em base64url. */
export function gerarToken(prefixo: string): string {
  return prefixo + randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Comparação em tempo constante.
 *
 * A busca no banco é por hash indexado, então na prática o Postgres já decide.
 * Isto existe para as comparações em memória — segredo de cliente, sobretudo —
 * onde comparar com `===` vaza informação pelo tempo de resposta.
 */
export function hashesIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export function expiraEm(segundos: number): Date {
  return new Date(Date.now() + segundos * 1000)
}

/**
 * O token está vivo?
 *
 * Revogação vence expiração: um token revogado há um segundo não vale, mesmo
 * dentro da validade.
 */
export function tokenVivo(t: { expiresAt: Date; revokedAt: Date | null }, agora = new Date()): boolean {
  if (t.revokedAt !== null) return false
  return t.expiresAt.getTime() > agora.getTime()
}
