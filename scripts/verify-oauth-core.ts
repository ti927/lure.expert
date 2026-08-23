/**
 * Fase 3.0 — miolo do OAuth e migration 0030.
 *
 * A parte criptográfica é pura e é testada de verdade: PKCE contra vetores
 * calculados, e as recusas que o spec do MCP exige. A migration roda inteira
 * dentro de uma transação com ROLLBACK.
 *
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-oauth-core.ts
 */
import { readFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import {
  gerarToken, hashToken, hashesIguais, tokenVivo, expiraEm,
  PREFIXO_ACCESS, PREFIXO_REFRESH, TTL_ACCESS_SEGUNDOS, TTL_CODE_SEGUNDOS,
} from '@/lib/oauth/tokens'
import { calcularChallenge, verificarPkce } from '@/lib/oauth/pkce'
import { redirectUriValido, redirectRegistrado, normalizarEscopos, registroSchema } from '@/lib/oauth/clients'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

async function main() {
  // ── 1. Tokens ───────────────────────────────────────────────────────────
  const at = gerarToken(PREFIXO_ACCESS)
  t(at.startsWith(PREFIXO_ACCESS) && at.length > 40, `token nasce com prefixo legível (${at.slice(0, 16)}…)`)
  t(gerarToken(PREFIXO_ACCESS) !== gerarToken(PREFIXO_ACCESS), 'dois tokens nunca são iguais')
  t(hashToken(at).length === 64 && /^[0-9a-f]+$/.test(hashToken(at)), 'hash é SHA-256 em hex')
  t(!hashToken(at).includes(at.slice(8, 30)), 'o hash NÃO contém o token — é hash, não codificação')
  t(hashToken(at) === hashToken(at), 'hash é determinístico (dá para buscar no banco por ele)')
  t(hashesIguais('abc', 'abc') && !hashesIguais('abc', 'abd') && !hashesIguais('abc', 'abcd'),
    'comparação em tempo constante distingue igual, diferente e tamanhos diferentes')

  const agora = new Date()
  t(tokenVivo({ expiresAt: expiraEm(60), revokedAt: null }, agora), 'token dentro da validade está vivo')
  t(!tokenVivo({ expiresAt: expiraEm(-1), revokedAt: null }, agora), 'token expirado não vale')
  t(!tokenVivo({ expiresAt: expiraEm(3600), revokedAt: agora }, agora),
    'REVOGAÇÃO VENCE VALIDADE: token revogado não vale mesmo dentro do prazo')
  t(TTL_CODE_SEGUNDOS <= 60 && TTL_ACCESS_SEGUNDOS <= 3600,
    `código vive ${TTL_CODE_SEGUNDOS}s e access ${TTL_ACCESS_SEGUNDOS}s — curtos, como o spec recomenda`)

  // ── 2. PKCE ─────────────────────────────────────────────────────────────
  // Vetor do RFC 7636, apêndice B.
  const verifierRfc  = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const challengeRfc = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  t(calcularChallenge(verifierRfc) === challengeRfc,
    'calcularChallenge bate com o vetor de teste do RFC 7636')

  const v = randomBytes(48).toString('base64url')
  const c = calcularChallenge(v)
  t(verificarPkce(v, c, 'S256').ok, 'verifier correto passa')

  const errado = verificarPkce(randomBytes(48).toString('base64url'), c, 'S256')
  t(!errado.ok && errado.erro === 'nao_confere', 'verifier errado é recusado')

  const plain = verificarPkce(v, v, 'plain')
  t(!plain.ok && plain.erro === 'metodo_invalido',
    'método "plain" é RECUSADO — ele manda o segredo em claro e anula o PKCE')

  t(!verificarPkce('curto', c, 'S256').ok, 'verifier abaixo de 43 caracteres é recusado')
  t(!verificarPkce('a'.repeat(129), c, 'S256').ok, 'verifier acima de 128 caracteres é recusado')
  t(!verificarPkce('tem espaço aqui!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!', c, 'S256').ok,
    'verifier com caractere fora do alfabeto é recusado')

  // ── 3. Redirecionamento ─────────────────────────────────────────────────
  t(redirectUriValido('https://claude.ai/api/mcp/auth_callback'), 'HTTPS aceito')
  t(redirectUriValido('http://localhost:3000/cb'), 'http em localhost aceito (cliente de desktop)')
  t(!redirectUriValido('http://exemplo.com/cb'), 'http fora de localhost recusado')
  t(!redirectUriValido('https://exemplo.com/cb#frag'), 'URI com fragmento recusado')
  t(!redirectUriValido('nao-e-url'), 'texto que não é URL recusado')

  const registrados = ['https://claude.ai/api/mcp/auth_callback']
  t(redirectRegistrado(registrados[0], registrados), 'redirect idêntico ao registrado passa')
  t(!redirectRegistrado('https://claude.ai/api/mcp/auth_callback/', registrados),
    'barra final a mais é OUTRO caminho — recusado')
  t(!redirectRegistrado('https://claude.ai.evil.com/api/mcp/auth_callback', registrados),
    'o buraco clássico do casamento por prefixo é recusado: claude.ai.evil.com')

  // ── 4. Registro dinâmico ────────────────────────────────────────────────
  const bom = registroSchema.safeParse({
    client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  })
  t(bom.success && bom.data.token_endpoint_auth_method === 'none',
    'registro válido assume cliente público (PKCE em vez de segredo)')
  t(!registroSchema.safeParse({ client_name: 'X', redirect_uris: ['http://evil.com/cb'] }).success,
    'registro com redirect http externo é recusado')
  t(!registroSchema.safeParse({ client_name: '', redirect_uris: ['https://a.com/cb'] }).success,
    'registro sem nome é recusado')
  t(registroSchema.safeParse({
      client_name: 'X', redirect_uris: ['https://a.com/cb'], campo_desconhecido: 1,
    }).success,
    'campo extra é aceito e ignorado, como o RFC 7591 manda')

  t(JSON.stringify(normalizarEscopos('escrita leitura')) === '["leitura","escrita"]',
    'escopos normalizam em ordem estável')
  t(JSON.stringify(normalizarEscopos('inventado')) === '["leitura"]',
    'escopo inexistente cai para leitura, nunca para escrita')
  t(JSON.stringify(normalizarEscopos(undefined)) === '["leitura"]',
    'sem escopo pedido, o padrão é o menos poderoso')

  // ── 5. A migration ──────────────────────────────────────────────────────
  const migration = readFileSync('db/migrations/rls/0030_oauth_mcp.sql', 'utf8')
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(migration))
      console.log('\n— migration executou sem erro de sintaxe —')

      const tabelas = await tx.execute<{ table_name: string; n: number }>(sql`
        SELECT table_name, COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name LIKE 'mcp_oauth_%'
        GROUP BY 1 ORDER BY 1`)
      t(tabelas.length === 4, `4 tabelas (${tabelas.map(r => r.table_name.replace('mcp_oauth_', '')).join(', ')})`)

      const rls = await tx.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM pg_class
        WHERE relname LIKE 'mcp_oauth_%' AND relrowsecurity`)
      t(Number(rls[0].n) === 4, `RLS habilitada nas 4 (${rls[0].n})`)

      const pol = await tx.execute<{ tablename: string }>(sql`
        SELECT tablename FROM pg_policies WHERE tablename LIKE 'mcp_oauth_%'`)
      t(pol.length === 2 && pol.every(p => p.tablename === 'mcp_oauth_access_grants'),
        'só os consentimentos têm policy — o usuário enxerga e revoga os próprios; o resto é do servidor')

      const recusa = async (rotulo: string, fn: () => Promise<unknown>) => {
        await tx.execute(sql`SAVEPOINT s`)
        try { await fn(); await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); t(false, `${rotulo} — aceito e não devia`) }
        catch { await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); t(true, `${rotulo} — recusado`) }
      }

      await tx.execute(sql`
        INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris)
        VALUES ('cli_teste', 'Claude', ARRAY['https://claude.ai/cb'])`)
      t(true, 'cria cliente')

      await recusa('cliente sem nenhum redirect', () =>
        tx.execute(sql`INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris)
                       VALUES ('cli_2', 'X', ARRAY[]::text[])`))
      await recusa('método de autenticação inventado', () =>
        tx.execute(sql`INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, token_endpoint_auth_method)
                       VALUES ('cli_3', 'X', ARRAY['https://a.com/cb'], 'magica')`))

      const [{ org }] = await tx.execute<{ org: string }>(sql`SELECT id::text AS org FROM organizations LIMIT 1`)
      const uid = '11111111-1111-1111-1111-111111111111'

      const [grant] = await tx.execute<{ id: string }>(sql`
        INSERT INTO mcp_oauth_access_grants (user_id, client_id, organization_ids, scopes)
        VALUES (${uid}::uuid, 'cli_teste', ARRAY[${org}::uuid], ARRAY['leitura'])
        RETURNING id::text AS id`)
      t(!!grant.id, 'cria consentimento com organizações e escopos')

      await recusa('consentimento sem nenhuma organização', () =>
        tx.execute(sql`INSERT INTO mcp_oauth_access_grants (user_id, client_id, organization_ids, scopes)
                       VALUES (${uid}::uuid, 'cli_teste', ARRAY[]::uuid[], ARRAY['leitura'])`))
      await recusa('código com PKCE "plain"', () =>
        tx.execute(sql`INSERT INTO mcp_oauth_authorization_codes
                       (code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scopes, organization_ids, expires_at)
                       VALUES ('h', 'cli_teste', ${uid}::uuid, 'https://claude.ai/cb', 'c', 'plain', ARRAY['leitura'], ARRAY[${org}::uuid], now())`))
      await recusa('token de tipo inventado', () =>
        tx.execute(sql`INSERT INTO mcp_oauth_tokens (grant_id, kind, token_hash, expires_at)
                       VALUES (${grant.id}::uuid, 'magico', 'h1', now())`))

      const tokenClaro = gerarToken(PREFIXO_REFRESH)
      await tx.execute(sql`
        INSERT INTO mcp_oauth_tokens (grant_id, kind, token_hash, expires_at)
        VALUES (${grant.id}::uuid, 'refresh', ${hashToken(tokenClaro)}, now() + interval '30 days')`)
      const [guardado] = await tx.execute<{ h: string }>(sql`
        SELECT token_hash AS h FROM mcp_oauth_tokens WHERE grant_id = ${grant.id}::uuid`)
      t(!guardado.h.startsWith(PREFIXO_REFRESH) && guardado.h.length === 64,
        'o banco guarda o HASH, não o token — nenhum valor começa com o prefixo')

      await recusa('o mesmo hash de token duas vezes', () =>
        tx.execute(sql`INSERT INTO mcp_oauth_tokens (grant_id, kind, token_hash, expires_at)
                       VALUES (${grant.id}::uuid, 'access', ${hashToken(tokenClaro)}, now())`))

      await tx.execute(sql`DELETE FROM mcp_oauth_clients WHERE client_id = 'cli_teste'`)
      const [{ sobrou }] = await tx.execute<{ sobrou: number }>(sql`
        SELECT COUNT(*)::int AS sobrou FROM mcp_oauth_access_grants WHERE id = ${grant.id}::uuid`)
      t(Number(sobrou) === 0, 'apagar o cliente leva consentimentos e tokens (CASCADE)')

      throw new Error('__ROLLBACK__')
    })
  } catch (e) {
    if ((e as Error).message !== '__ROLLBACK__') { console.error('ERRO:', e); falhas++ }
  }

  console.log(`\n${ok} ok, ${falhas} falha(s) — a migration foi revertida`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(e => { console.error('ERRO:', e); process.exit(1) })
