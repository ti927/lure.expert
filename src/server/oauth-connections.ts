'use server'

// As conexões que o usuário autorizou, e o botão de desfazer.
//
// A contrapartida da tela de consentimento: sem isto, quem autoriza um
// aplicativo depende de o próprio aplicativo chamar `/api/oauth/revoke` para
// desconectar — ou seja, depende da boa vontade de quem se quer desconectar.
//
// Conexão é do USUÁRIO, não da organização: um consentimento pode alcançar
// várias empresas, e é a pessoa que o concedeu.

import { revalidatePath } from 'next/cache'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { oauthAccessGrants, oauthClients, organizations } from '@/db/schema'
import { getAuthContext } from '@/lib/auth-context'
import { revogarGrant, registrarEventoOauth } from '@/lib/oauth/store'
import { ESCOPO_DESCRICAO, type Escopo } from '@/lib/oauth/clients'

export interface ConexaoListada {
  id: string
  clientName: string
  escopos: { chave: string; descricao: string }[]
  empresas: string[]
  criadoEm: string
  ultimoUsoEm: string | null
}

export async function listarConexoes(): Promise<ConexaoListada[]> {
  const { userId } = await getAuthContext()

  const linhas = await db
    .select({
      id: oauthAccessGrants.id,
      clientName: oauthClients.clientName,
      organizationIds: oauthAccessGrants.organizationIds,
      scopes: oauthAccessGrants.scopes,
      createdAt: oauthAccessGrants.createdAt,
      lastUsedAt: oauthAccessGrants.lastUsedAt,
    })
    .from(oauthAccessGrants)
    .innerJoin(oauthClients, eq(oauthAccessGrants.clientId, oauthClients.clientId))
    .where(and(eq(oauthAccessGrants.userId, userId), isNull(oauthAccessGrants.revokedAt)))
    .orderBy(desc(oauthAccessGrants.createdAt))

  if (linhas.length === 0) return []

  const ids = Array.from(new Set(linhas.flatMap(l => l.organizationIds)))
  const nomes = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(inArray(organizations.id, ids))
  const porId = new Map(nomes.map(n => [n.id, n.name]))

  return linhas.map(l => ({
    id: l.id,
    clientName: l.clientName,
    escopos: (l.scopes as Escopo[]).map(e => ({
      chave: e,
      descricao: ESCOPO_DESCRICAO[e] ?? e,
    })),
    // Nome de empresa que o usuário perdeu acesso desde então não deve sumir da
    // lista: ele precisa ver o alcance real do que autorizou.
    empresas: l.organizationIds.map(id => porId.get(id) ?? 'Empresa removida'),
    criadoEm: l.createdAt.toISOString(),
    ultimoUsoEm: l.lastUsedAt?.toISOString() ?? null,
  }))
}

export async function revogarConexao(grantId: string): Promise<{ erro?: string }> {
  const { userId } = await getAuthContext()

  const [grant] = await db
    .select({
      id: oauthAccessGrants.id,
      userId: oauthAccessGrants.userId,
      clientId: oauthAccessGrants.clientId,
      organizationIds: oauthAccessGrants.organizationIds,
      scopes: oauthAccessGrants.scopes,
      clientName: oauthClients.clientName,
    })
    .from(oauthAccessGrants)
    .innerJoin(oauthClients, eq(oauthAccessGrants.clientId, oauthClients.clientId))
    .where(eq(oauthAccessGrants.id, grantId))
    .limit(1)

  // Silêncio idêntico para "não existe" e "não é seu": responder diferente
  // transformaria a rota num oráculo de ids de consentimento alheios.
  if (!grant || grant.userId !== userId) {
    return { erro: 'Conexão não encontrada.' }
  }

  await revogarGrant(grantId)

  await registrarEventoOauth({
    organizationIds: grant.organizationIds,
    tipo: 'mcp_consent_revoked',
    userId,
    clientId: grant.clientId,
    clientName: grant.clientName,
    scopes: grant.scopes as string[],
  })

  revalidatePath('/configuracoes/conexoes')
  return {}
}
