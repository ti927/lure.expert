// O funil pelo qual toda consulta do motor precisa passar.
//
// O isolamento entre organizações neste app é convencional: `db/index.ts`
// conecta com role `postgres` (superusuário, BYPASSRLS), as policies RLS são
// código morto em runtime, e a garantia vem de `.where(eq(X.organizationId,…))`
// escrito à mão em cada query. Isso funcionou enquanto todo caminho de dados
// nascia de uma sessão de navegador. Expor um servidor MCP muda o risco: uma
// ferramenta nova que esqueça o filtro vaza a base inteira.
//
// A trava aqui é de TIPO, não de disciplina. `QueryScope` carrega uma marca que
// só `makeScope` sabe produzir, e `makeScope` confirma o vínculo no banco antes
// de emitir. Como `runQuery` exige um `QueryScope`, não existe caminho para
// consultar sem ter provado o vínculo primeiro.

import { db } from '@/db'
import { memberships } from '@/db/schema'
import { eq, and, isNotNull, asc } from 'drizzle-orm'
import { ScopeDeniedError } from './errors'

declare const marca: unique symbol

/** Quem está consultando, e por qual organização. Só `makeScope` constrói. */
export interface QueryScope {
  readonly [marca]: 'QueryScope'
  readonly organizationId: string
  readonly userId:         string
  /** De onde veio a chamada — usado em auditoria e, na Fase 3, em limites. */
  readonly actor:          'session' | 'mcp' | 'job'
  readonly role:           string
}

/**
 * Único construtor. Confirma que existe membership **aceita** do usuário na
 * organização — não basta a linha existir, o convite tem de ter sido aceito.
 */
async function makeScope(
  userId: string,
  organizationId: string,
  actor: QueryScope['actor'],
): Promise<QueryScope> {
  const [vinculo] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(
      eq(memberships.userId, userId),
      eq(memberships.organizationId, organizationId),
      isNotNull(memberships.acceptedAt),
    ))
    .limit(1)

  if (!vinculo) throw new ScopeDeniedError()

  return {
    organizationId,
    userId,
    actor,
    role: vinculo.role,
  } as QueryScope
}

/**
 * Escopo a partir da sessão do navegador.
 *
 * Recebe o par já resolvido em vez de chamar `getAuthContext()` para não
 * arrastar `next/headers` e `redirect()` para dentro do motor — este módulo
 * precisa ser importável de job Inngest e do servidor MCP, onde `redirect()`
 * viraria exceção crua.
 */
export function scopeFromSession(userId: string, organizationId: string): Promise<QueryScope> {
  return makeScope(userId, organizationId, 'session')
}

/**
 * Escopo a partir de um grant OAuth do MCP (Fase 3).
 *
 * A dupla checagem é o ponto: o id tem de estar no que o humano autorizou na
 * tela de consentimento **e** a membership tem de continuar viva. A segunda
 * existe porque o vínculo pode ser revogado depois do consentimento, e o token
 * continuaria valendo.
 *
 * É o oposto do que os webhooks fazem hoje — o de SEFAZ resolve a organização
 * pelo CNPJ que vem no corpo, e CNPJ é público.
 */
export function scopeFromMcpGrant(
  grant: { userId: string; organizationIds: string[] },
  organizationId: string,
): Promise<QueryScope> {
  if (!grant.organizationIds.includes(organizationId)) {
    throw new ScopeDeniedError('Esta organização não está entre as autorizadas para esta conexão.')
  }
  return makeScope(grant.userId, organizationId, 'mcp')
}

/**
 * Escopo para job de background, que não tem usuário.
 *
 * Não passa por `makeScope`: não há membership para conferir. O job só recebe
 * `organizationId` de quem o disparou, e a validação aconteceu lá — é o mesmo
 * contrato que `sendCategorizationEvents` já usa.
 */
export function scopeFromJob(organizationId: string): QueryScope {
  return {
    organizationId,
    userId: '00000000-0000-0000-0000-000000000000',
    actor: 'job',
    role: 'system',
  } as QueryScope
}

/** As organizações onde o usuário tem vínculo aceito, em ordem estável. */
export async function organizacoesDoUsuario(userId: string) {
  return db
    .select({ organizationId: memberships.organizationId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), isNotNull(memberships.acceptedAt)))
    .orderBy(asc(memberships.createdAt), asc(memberships.organizationId))
}
