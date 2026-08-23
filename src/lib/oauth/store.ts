// Tudo que o OAuth escreve e lê no banco.
//
// Vive em `/lib` e não em `/server` pela regra da casa: `'use server'` só deixa
// exportar função async, e — mais importante — o que está aqui precisa ser
// chamável do endpoint de token (sem sessão), da página de consentimento (com
// sessão) e do servidor MCP (com token). Nenhum desses três tem cookie em comum.
//
// A regra que este arquivo carrega inteira: o texto claro de um token existe uma
// única vez, na resposta que o cria. O banco guarda SHA-256.

import { db } from '@/db'
import {
  oauthClients, oauthAccessGrants, oauthAuthorizationCodes, oauthTokens, agentEvents,
} from '@/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  gerarToken, hashToken, hashesIguais, expiraEm,
  PREFIXO_ACCESS, PREFIXO_REFRESH, PREFIXO_CODE,
  TTL_ACCESS_SEGUNDOS, TTL_REFRESH_SEGUNDOS, TTL_CODE_SEGUNDOS,
} from './tokens'
import { gerarClientId, type Escopo, type RegistroCliente } from './clients'

// ─────────────────────────────────────────────────────────────────────────────
// Clientes
// ─────────────────────────────────────────────────────────────────────────────

export interface ClienteCriado {
  clientId: string
  /** Existe uma vez só, nesta resposta. Nulo para cliente público. */
  clientSecret: string | null
}

export async function registrarCliente(reg: RegistroCliente): Promise<ClienteCriado> {
  const clientId = gerarClientId()
  const publico = reg.token_endpoint_auth_method === 'none'
  const segredo = publico ? null : gerarToken('lure_cs_')

  await db.insert(oauthClients).values({
    clientId,
    clientSecretHash: segredo ? hashToken(segredo) : null,
    clientName: reg.client_name,
    redirectUris: reg.redirect_uris,
    grantTypes: reg.grant_types,
    tokenEndpointAuthMethod: reg.token_endpoint_auth_method,
  })

  return { clientId, clientSecret: segredo }
}

export async function buscarCliente(clientId: string) {
  const [c] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1)
  return c ?? null
}

export type ResultadoAutenticacao =
  | { ok: true; cliente: NonNullable<Awaited<ReturnType<typeof buscarCliente>>> }
  | { ok: false; motivo: 'desconhecido' | 'segredo_invalido' }

/**
 * O cliente é quem diz ser?
 *
 * Cliente público (`none`) não apresenta segredo — é o caso do claude.ai, e o
 * que o protege não é segredo nenhum e sim o PKCE. Cliente confidencial precisa
 * bater o hash, em comparação de tempo constante.
 */
export async function autenticarCliente(
  clientId: string,
  segredoApresentado: string | null,
): Promise<ResultadoAutenticacao> {
  const cliente = await buscarCliente(clientId)
  if (!cliente) return { ok: false, motivo: 'desconhecido' }

  if (cliente.tokenEndpointAuthMethod === 'none') return { ok: true, cliente }

  if (!segredoApresentado || !cliente.clientSecretHash) return { ok: false, motivo: 'segredo_invalido' }
  return hashesIguais(hashToken(segredoApresentado), cliente.clientSecretHash)
    ? { ok: true, cliente }
    : { ok: false, motivo: 'segredo_invalido' }
}

export async function marcarClienteUsado(clientId: string): Promise<void> {
  await db.update(oauthClients).set({ lastUsedAt: new Date() })
    .where(eq(oauthClients.clientId, clientId))
}

// ─────────────────────────────────────────────────────────────────────────────
// Códigos de autorização
// ─────────────────────────────────────────────────────────────────────────────

export interface NovoCodigo {
  clientId: string
  userId: string
  redirectUri: string
  codeChallenge: string
  scopes: Escopo[]
  organizationIds: string[]
  resource: string
}

/** Devolve o código em claro; o banco fica só com o hash. */
export async function criarCodigo(p: NovoCodigo): Promise<string> {
  const codigo = gerarToken(PREFIXO_CODE)
  await db.insert(oauthAuthorizationCodes).values({
    codeHash: hashToken(codigo),
    clientId: p.clientId,
    userId: p.userId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    codeChallengeMethod: 'S256',
    scopes: p.scopes,
    organizationIds: p.organizationIds,
    resource: p.resource,
    expiresAt: expiraEm(TTL_CODE_SEGUNDOS),
  })
  return codigo
}

type LinhaCodigo = typeof oauthAuthorizationCodes.$inferSelect

export type TrocaDeCodigo =
  | { status: 'ok'; codigo: LinhaCodigo }
  | { status: 'ausente' }
  | { status: 'expirado' }
  /** Já foi trocado antes. Sinal de código interceptado — a linha vem junto. */
  | { status: 'reusado'; codigo: LinhaCodigo }

/**
 * Consome o código, de uma vez só.
 *
 * O `UPDATE ... WHERE consumed_at IS NULL RETURNING` é o ponto: se duas
 * requisições chegarem com o mesmo código, o Postgres serializa e exatamente uma
 * leva a linha. Ler-e-depois-escrever deixaria a janela em que as duas passam, e
 * essa janela é o ataque que o uso único existe para fechar.
 */
export async function consumirCodigo(codigoClaro: string): Promise<TrocaDeCodigo> {
  const hash = hashToken(codigoClaro)

  const [linha] = await db.update(oauthAuthorizationCodes)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(oauthAuthorizationCodes.codeHash, hash),
      isNull(oauthAuthorizationCodes.consumedAt),
      sql`${oauthAuthorizationCodes.expiresAt} > now()`,
    ))
    .returning()

  if (linha) return { status: 'ok', codigo: linha }

  // Não levou a linha: descobrir por quê, porque as três causas pedem respostas
  // diferentes — e uma delas é sinal de ataque.
  const [existente] = await db.select().from(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.codeHash, hash)).limit(1)

  if (!existente) return { status: 'ausente' }
  if (existente.consumedAt !== null) return { status: 'reusado', codigo: existente }
  return { status: 'expirado' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Consentimentos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O consentimento vivo deste usuário para este cliente, criado ou atualizado.
 *
 * Reaproveitar em vez de acumular: reconectar o mesmo claude.ai três vezes tem
 * de deixar UM consentimento na tela de revogação, não três — senão o usuário
 * revoga um e continua conectado, que é pior que não ter a tela.
 *
 * Reaproveitar significa que a última decisão vale: se ele desmarcou uma
 * organização agora, ela sai do array e os tokens antigos deixam de alcançá-la,
 * porque `scopeFromMcpGrant` lê o grant, não o token.
 */
export async function garantirGrant(p: {
  userId: string
  clientId: string
  organizationIds: string[]
  scopes: Escopo[]
}): Promise<string> {
  const [vivo] = await db.select({ id: oauthAccessGrants.id })
    .from(oauthAccessGrants)
    .where(and(
      eq(oauthAccessGrants.userId, p.userId),
      eq(oauthAccessGrants.clientId, p.clientId),
      isNull(oauthAccessGrants.revokedAt),
    ))
    .limit(1)

  if (vivo) {
    await db.update(oauthAccessGrants)
      .set({ organizationIds: p.organizationIds, scopes: p.scopes, lastUsedAt: new Date() })
      .where(eq(oauthAccessGrants.id, vivo.id))
    return vivo.id
  }

  const [novo] = await db.insert(oauthAccessGrants).values({
    userId: p.userId,
    clientId: p.clientId,
    organizationIds: p.organizationIds,
    scopes: p.scopes,
  }).returning({ id: oauthAccessGrants.id })

  return novo.id
}

export async function revogarGrant(grantId: string): Promise<void> {
  const agora = new Date()
  await db.transaction(async (tx) => {
    await tx.update(oauthAccessGrants).set({ revokedAt: agora })
      .where(and(eq(oauthAccessGrants.id, grantId), isNull(oauthAccessGrants.revokedAt)))
    await tx.update(oauthTokens).set({ revokedAt: agora })
      .where(and(eq(oauthTokens.grantId, grantId), isNull(oauthTokens.revokedAt)))
  })
}

/** Derruba os tokens sem derrubar o consentimento — o caso do código reusado. */
export async function revogarTokensDoGrant(grantId: string): Promise<void> {
  await db.update(oauthTokens).set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.grantId, grantId), isNull(oauthTokens.revokedAt)))
}

export async function grantVivoDe(userId: string, clientId: string): Promise<string | null> {
  const [g] = await db.select({ id: oauthAccessGrants.id }).from(oauthAccessGrants)
    .where(and(
      eq(oauthAccessGrants.userId, userId),
      eq(oauthAccessGrants.clientId, clientId),
      isNull(oauthAccessGrants.revokedAt),
    ))
    .limit(1)
  return g?.id ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokens
// ─────────────────────────────────────────────────────────────────────────────

export interface ParDeTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: Escopo[]
}

export async function emitirTokens(
  grantId: string,
  resource: string,
  scopes: Escopo[],
): Promise<ParDeTokens> {
  const acesso = gerarToken(PREFIXO_ACCESS)
  const renovacao = gerarToken(PREFIXO_REFRESH)

  await db.insert(oauthTokens).values([
    {
      grantId, kind: 'access', tokenHash: hashToken(acesso),
      resource, expiresAt: expiraEm(TTL_ACCESS_SEGUNDOS),
    },
    {
      grantId, kind: 'refresh', tokenHash: hashToken(renovacao),
      resource, expiresAt: expiraEm(TTL_REFRESH_SEGUNDOS),
    },
  ])

  return { accessToken: acesso, refreshToken: renovacao, expiresIn: TTL_ACCESS_SEGUNDOS, scopes }
}

export type Rotacao =
  | { status: 'ok'; tokens: ParDeTokens }
  | { status: 'ausente' }
  | { status: 'expirado' }
  /** O refresh existe, mas pertence a outro cliente OAuth. */
  | { status: 'outro_cliente' }
  /** Revogado sem ter sido rotacionado: o usuário desconectou. */
  | { status: 'revogado' }
  /**
   * Apresentaram um refresh que JÁ foi trocado. O legítimo teria o novo; quem
   * tem o velho o interceptou — ou o cliente perdeu a resposta e retentou. Nos
   * dois casos a resposta certa é derrubar a cadeia inteira: no primeiro corta o
   * ataque, no segundo custa um reconsentimento.
   */
  | { status: 'reuso'; grantId: string }

/**
 * Troca um refresh por um par novo, invalidando o apresentado.
 *
 * Rotação é MUST do spec do MCP para cliente público. Sem ela, um refresh
 * vazado vale 30 dias e nada denuncia o vazamento; com ela, o uso pelo ladrão
 * ou pelo dono — o que vier depois — expõe o roubo.
 */
export async function rotacionarRefresh(
  tokenClaro: string,
  resource: string,
  clientId: string,
): Promise<Rotacao> {
  const hash = hashToken(tokenClaro)

  const [alvo] = await db.select({
    id: oauthTokens.id,
    grantId: oauthTokens.grantId,
    kind: oauthTokens.kind,
    expiresAt: oauthTokens.expiresAt,
    revokedAt: oauthTokens.revokedAt,
    replacedBy: oauthTokens.replacedBy,
  }).from(oauthTokens).where(eq(oauthTokens.tokenHash, hash)).limit(1)

  if (!alvo || alvo.kind !== 'refresh') return { status: 'ausente' }
  if (alvo.replacedBy !== null) return { status: 'reuso', grantId: alvo.grantId }
  if (alvo.revokedAt !== null) return { status: 'revogado' }
  if (alvo.expiresAt.getTime() <= Date.now()) return { status: 'expirado' }

  // O consentimento pode ter sido revogado depois de o token nascer.
  const [grant] = await db.select({
    id: oauthAccessGrants.id,
    clientId: oauthAccessGrants.clientId,
    scopes: oauthAccessGrants.scopes,
    revokedAt: oauthAccessGrants.revokedAt,
  }).from(oauthAccessGrants).where(eq(oauthAccessGrants.id, alvo.grantId)).limit(1)

  if (!grant || grant.revokedAt !== null) return { status: 'revogado' }
  // Um cliente não renova o token do outro, mesmo autenticando-se corretamente
  // como si mesmo — é o que impede um cliente registrado de usar um refresh que
  // tenha capturado de outro.
  if (grant.clientId !== clientId) return { status: 'outro_cliente' }

  const acesso = gerarToken(PREFIXO_ACCESS)
  const renovacao = gerarToken(PREFIXO_REFRESH)

  await db.transaction(async (tx) => {
    await tx.insert(oauthTokens).values({
      grantId: grant.id, kind: 'access', tokenHash: hashToken(acesso),
      resource, expiresAt: expiraEm(TTL_ACCESS_SEGUNDOS),
    })
    const [novoRefresh] = await tx.insert(oauthTokens).values({
      grantId: grant.id, kind: 'refresh', tokenHash: hashToken(renovacao),
      resource, expiresAt: expiraEm(TTL_REFRESH_SEGUNDOS),
    }).returning({ id: oauthTokens.id })

    // O VELHO aponta para o novo. É esta direção que faz a detecção de reuso ser
    // uma leitura da própria linha apresentada, sem consulta extra.
    await tx.update(oauthTokens)
      .set({ revokedAt: new Date(), replacedBy: novoRefresh.id })
      .where(eq(oauthTokens.id, alvo.id))

    // O access antigo do mesmo par também cai: o cliente já tem outro.
    await tx.update(oauthTokens).set({ revokedAt: new Date() })
      .where(and(
        eq(oauthTokens.grantId, grant.id),
        eq(oauthTokens.kind, 'access'),
        isNull(oauthTokens.revokedAt),
        sql`${oauthTokens.tokenHash} <> ${hashToken(acesso)}`,
      ))

    await tx.update(oauthAccessGrants).set({ lastUsedAt: new Date() })
      .where(eq(oauthAccessGrants.id, grant.id))
  })

  return {
    status: 'ok',
    tokens: {
      accessToken: acesso, refreshToken: renovacao,
      expiresIn: TTL_ACCESS_SEGUNDOS, scopes: grant.scopes as Escopo[],
    },
  }
}

/**
 * RFC 7009: revoga o token apresentado.
 *
 * Revogar um refresh derruba o consentimento inteiro; revogar um access derruba
 * só ele. É a leitura razoável de "desconectar" — o cliente guarda o refresh, e
 * mandá-lo é o que ele faz ao desconectar de propósito.
 */
export async function revogarPorToken(tokenClaro: string): Promise<void> {
  const [t] = await db.select({ id: oauthTokens.id, kind: oauthTokens.kind, grantId: oauthTokens.grantId })
    .from(oauthTokens).where(eq(oauthTokens.tokenHash, hashToken(tokenClaro))).limit(1)

  if (!t) return
  if (t.kind === 'refresh') return revogarGrant(t.grantId)

  await db.update(oauthTokens).set({ revokedAt: new Date() }).where(eq(oauthTokens.id, t.id))
}

export type TokenResolvido =
  | {
      ok: true
      grantId: string
      userId: string
      clientId: string
      organizationIds: string[]
      scopes: Escopo[]
      resource: string | null
      tokenId: string
    }
  | { ok: false; motivo: 'desconhecido' | 'expirado' | 'revogado' | 'consentimento_revogado' }

/**
 * Quem é o portador deste access token? (Usado pelo servidor MCP, na 3.2.)
 *
 * A checagem do consentimento é separada da do token de propósito: o token pode
 * estar dentro da validade e o humano já ter desconectado. Revogação vence
 * validade, aqui como em `tokenVivo`.
 */
export async function resolverTokenDeAcesso(tokenClaro: string): Promise<TokenResolvido> {
  const [linha] = await db.select({
    tokenId: oauthTokens.id,
    kind: oauthTokens.kind,
    expiresAt: oauthTokens.expiresAt,
    revokedAt: oauthTokens.revokedAt,
    resource: oauthTokens.resource,
    grantId: oauthAccessGrants.id,
    userId: oauthAccessGrants.userId,
    clientId: oauthAccessGrants.clientId,
    organizationIds: oauthAccessGrants.organizationIds,
    scopes: oauthAccessGrants.scopes,
    grantRevokedAt: oauthAccessGrants.revokedAt,
  })
    .from(oauthTokens)
    .innerJoin(oauthAccessGrants, eq(oauthTokens.grantId, oauthAccessGrants.id))
    .where(eq(oauthTokens.tokenHash, hashToken(tokenClaro)))
    .limit(1)

  if (!linha || linha.kind !== 'access') return { ok: false, motivo: 'desconhecido' }
  if (linha.revokedAt !== null) return { ok: false, motivo: 'revogado' }
  if (linha.expiresAt.getTime() <= Date.now()) return { ok: false, motivo: 'expirado' }
  if (linha.grantRevokedAt !== null) return { ok: false, motivo: 'consentimento_revogado' }

  return {
    ok: true,
    grantId: linha.grantId,
    userId: linha.userId,
    clientId: linha.clientId,
    organizationIds: linha.organizationIds,
    scopes: linha.scopes as Escopo[],
    resource: linha.resource,
    tokenId: linha.tokenId,
  }
}

/** Marca uso sem bloquear a resposta — o chamador não precisa esperar. */
export async function marcarUso(tokenId: string, grantId: string): Promise<void> {
  const agora = new Date()
  try {
    await db.transaction(async (tx) => {
      await tx.update(oauthTokens).set({ lastUsedAt: agora }).where(eq(oauthTokens.id, tokenId))
      await tx.update(oauthAccessGrants).set({ lastUsedAt: agora }).where(eq(oauthAccessGrants.id, grantId))
    })
  } catch (e) {
    console.error('[oauth] falha ao marcar uso', (e as Error).message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auditoria
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Consentimento em `agent_events`, uma linha por organização.
 *
 * Sem tabela nova: é o que o princípio 10 pede, e a coluna `organization_id` é
 * NOT NULL — um evento por organização é o que torna o registro consultável pela
 * mesma tela de consumo que já lê essa tabela.
 *
 * Nunca lança: perder a auditoria não pode derrubar a autorização.
 */
export async function registrarEventoOauth(p: {
  organizationIds: string[]
  tipo: 'mcp_consent_granted' | 'mcp_consent_revoked'
  userId: string
  clientId: string
  clientName: string
  scopes: string[]
}): Promise<void> {
  if (p.organizationIds.length === 0) return
  try {
    await db.insert(agentEvents).values(p.organizationIds.map(orgId => ({
      organizationId: orgId,
      type: p.tipo,
      entityType: 'oauth_grant',
      entityId: null,
      payload: {
        clientId: p.clientId,
        clientName: p.clientName,
        userId: p.userId,
        scopes: p.scopes,
        organizacoes: p.organizationIds.length,
      },
    })))
  } catch (e) {
    console.error('[oauth] falha ao registrar evento', (e as Error).message)
  }
}
