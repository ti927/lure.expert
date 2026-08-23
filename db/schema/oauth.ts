import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const tz = { withTimezone: true }

/**
 * Cliente OAuth registrado dinamicamente (RFC 7591) — migration 0030.
 *
 * Prefixo `mcp_` porque o Supabase ja tem `auth.oauth_clients`: ele tem servidor
 * OAuth proprio, e nome igual em schema diferente e confusao esperando acontecer.
 *
 * Global, sem organização: o claude.ai é um cliente, não pertence a ninguém.
 * Quem pertence a alguém é o GRANT.
 */
export const oauthClients = pgTable('mcp_oauth_clients', {
  clientId: text('client_id').primaryKey(),
  /** Nulo para cliente público (o caso do claude.ai, que usa PKCE). */
  clientSecretHash: text('client_secret_hash'),
  clientName: text('client_name').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  grantTypes: text('grant_types').array().notNull()
    .default(sql`ARRAY['authorization_code','refresh_token']`),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  lastUsedAt: timestamp('last_used_at', tz),
})

/**
 * O consentimento durável: o que o humano autorizou na tela.
 *
 * `organizationIds` é o coração do desenho multi-organização. A ferramenta MCP
 * recebe `organizationId` no corpo, mas o corpo só PROPÕE — quem dispõe é este
 * array mais a membership viva. É a inversão do anti-padrão do webhook SEFAZ,
 * que resolve a organização pelo CNPJ vindo da requisição.
 */
export const oauthAccessGrants = pgTable(
  'mcp_oauth_access_grants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull(),
    clientId: text('client_id').notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    organizationIds: uuid('organization_ids').array().notNull(),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    lastUsedAt: timestamp('last_used_at', tz),
    revokedAt: timestamp('revoked_at', tz),
  },
  (t) => ({
    userIdx: index('idx_mcp_oauth_grants_user').on(t.userId),
    clientIdx: index('idx_mcp_oauth_grants_client').on(t.clientId),
  })
)

/** Código de autorização: vida curta, uso único, PKCE obrigatório. */
export const oauthAuthorizationCodes = pgTable('mcp_oauth_authorization_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id').notNull()
    .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull(),
  scopes: text('scopes').array().notNull(),
  organizationIds: uuid('organization_ids').array().notNull(),
  /** RFC 8707 — para qual servidor o token nascerá. */
  resource: text('resource'),
  expiresAt: timestamp('expires_at', tz).notNull(),
  consumedAt: timestamp('consumed_at', tz),
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
})

/**
 * Tokens de acesso e de renovação.
 *
 * `replacedBy` implementa a rotação de refresh que o spec exige para cliente
 * público: apresentar um refresh já rotacionado é sinal de roubo, e derruba a
 * cadeia inteira em vez de só recusar aquele pedido.
 *
 * A direção é VELHO → novo. Assim a detecção de reuso é uma leitura da linha que
 * o cliente apresentou (`replacedBy` preenchido = já foi trocado), sem consulta
 * extra em todo pedido de renovação.
 */
export const oauthTokens = pgTable(
  'mcp_oauth_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    grantId: uuid('grant_id').notNull()
      .references(() => oauthAccessGrants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** SHA-256 em hex. O texto claro existe uma vez só, na resposta. */
    tokenHash: text('token_hash').notNull(),
    /** Audiência (RFC 8707): token de outro recurso não vale aqui. */
    resource: text('resource'),
    expiresAt: timestamp('expires_at', tz).notNull(),
    lastUsedAt: timestamp('last_used_at', tz),
    revokedAt: timestamp('revoked_at', tz),
    replacedBy: uuid('replaced_by'),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    hashIdx: uniqueIndex('mcp_oauth_tokens_token_hash_key').on(t.tokenHash),
    grantIdx: index('idx_mcp_oauth_tokens_grant').on(t.grantId, t.kind),
  })
)

export type OauthClient = typeof oauthClients.$inferSelect
export type OauthAccessGrant = typeof oauthAccessGrants.$inferSelect
export type OauthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect
export type OauthToken = typeof oauthTokens.$inferSelect
