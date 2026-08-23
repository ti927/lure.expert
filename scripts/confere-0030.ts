/**
 * Confere a migration 0030 (OAuth do MCP) JÁ APLICADA contra o banco.
 *
 * Leituras do catálogo são inofensivas. As regras são exercitadas dentro de uma
 * transação com ROLLBACK — nada fica. Mesmo ritual das 0026, 0027, 0028 e 0029.
 *
 *   DATABASE_URL="<pooler>" npx tsx scripts/confere-0030.ts
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

const TABELAS = [
  'mcp_oauth_clients',
  'mcp_oauth_access_grants',
  'mcp_oauth_authorization_codes',
  'mcp_oauth_tokens',
] as const

async function main() {
  // ═══ Estrutura ════════════════════════════════════════════════════════════
  console.log('── estrutura ──')

  const cols = await db.execute<{ table_name: string; n: number }>(sql`
    SELECT table_name, COUNT(*)::int AS n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY(${sql.raw(`ARRAY['${TABELAS.join("','")}']`)})
    GROUP BY 1 ORDER BY 1`)
  t(cols.length === 4, `4 tabelas (${cols.map(r => `${r.table_name.replace('mcp_oauth_', '')}:${r.n}col`).join(' ')})`)

  const esperado: Record<string, number> = {
    mcp_oauth_clients: 8,
    mcp_oauth_access_grants: 8,
    mcp_oauth_authorization_codes: 12,
    mcp_oauth_tokens: 10,
  }
  for (const [tab, n] of Object.entries(esperado)) {
    const achou = cols.find(c => c.table_name === tab)
    t(Number(achou?.n) === n, `${tab.replace('mcp_oauth_', '')} tem ${n} colunas (${achou?.n ?? 'ausente'})`)
  }

  // O prefixo `mcp_` existe porque o Supabase tem servidor OAuth próprio.
  const doSupabase = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'auth' AND c.relname IN ('oauth_clients','oauth_consents','oauth_authorizations')`)
  t(Number(doSupabase[0].n) > 0,
    `o Supabase realmente tem as dele em auth.* (${doSupabase[0].n}) — o prefixo mcp_ não era paranoia`)

  // ═══ CHECKs ═══════════════════════════════════════════════════════════════
  console.log('\n── CHECKs ──')
  const chks = await db.execute<{ tab: string; conname: string; def: string }>(sql`
    SELECT c.conrelid::regclass::text AS tab, c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.conrelid = ANY(${sql.raw(`ARRAY['${TABELAS.join("'::regclass,'")}'::regclass]`)})
      AND c.contype = 'c'
    ORDER BY 1, 2`)
  t(chks.length === 6, `6 CHECKs (${chks.length})`)
  // A regressão que o teste da 3.0 pegou: array_length devolve NULL para vazio,
  // e CHECK que avalia para NULL passa. Os três guardas TÊM de usar cardinality.
  const porCardinality = chks.filter(c => c.def.includes('cardinality'))
  t(porCardinality.length === 3,
    `3 guardas de array vazio usam cardinality, não array_length (${porCardinality.length})`)
  t(chks.some(c => c.conname === 'mcp_oauth_codes_method_chk' && c.def.includes("'S256'")),
    'code_challenge_method preso em S256 — plain é a porta que o PKCE fecha')

  // ═══ Índices ══════════════════════════════════════════════════════════════
  console.log('\n── índices ──')
  const idx = await db.execute<{ indexname: string; indexdef: string }>(sql`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND indexname LIKE 'idx_mcp_oauth%' ORDER BY 1`)
  t(idx.length === 5, `5 índices idx_mcp_oauth_* (${idx.length})`)
  t(idx.some(i => i.indexname === 'idx_mcp_oauth_tokens_vivos' && i.indexdef.includes('revoked_at IS NULL')),
    'idx_mcp_oauth_tokens_vivos é parcial — só o que ainda vale entra')
  t(idx.some(i => i.indexname === 'idx_mcp_oauth_grants_user' && i.indexdef.includes('revoked_at IS NULL')),
    'idx_mcp_oauth_grants_user é parcial')

  const unico = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM pg_constraint
    WHERE conrelid = 'mcp_oauth_tokens'::regclass AND contype = 'u'`)
  t(Number(unico[0].n) === 1, 'token_hash é UNIQUE')

  // ═══ Chaves estrangeiras ══════════════════════════════════════════════════
  console.log('\n── chaves estrangeiras ──')
  const fks = await db.execute<{ tab: string; conname: string; del: string }>(sql`
    SELECT conrelid::regclass::text AS tab, conname, confdeltype AS del
    FROM pg_constraint
    WHERE conrelid = ANY(${sql.raw(`ARRAY['${TABELAS.join("'::regclass,'")}'::regclass]`)})
      AND contype = 'f' ORDER BY 1, 2`)
  t(fks.length === 4, `4 FKs (${fks.length})`)
  const cascata = fks.filter(f => f.del === 'c')
  t(cascata.length === 3, `3 em CASCADE — grant→cliente, código→cliente, token→grant (${cascata.length})`)
  t(fks.some(f => f.conname.includes('replaced_by') && f.del === 'n'),
    'replaced_by é SET NULL — a cadeia de rotação não some quando um elo é apagado')

  // ═══ RLS ══════════════════════════════════════════════════════════════════
  console.log('\n── RLS ──')
  const rls = await db.execute<{ relname: string; on: boolean }>(sql`
    SELECT relname, relrowsecurity AS on FROM pg_class
    WHERE relname = ANY(${sql.raw(`ARRAY['${TABELAS.join("','")}']`)})`)
  t(rls.length === 4 && rls.every(r => r.on === true), 'RLS habilitada nas 4')

  const pols = await db.execute<{ tablename: string; policyname: string; qual: string | null }>(sql`
    SELECT tablename, policyname, qual FROM pg_policies
    WHERE tablename = ANY(${sql.raw(`ARRAY['${TABELAS.join("','")}']`)}) ORDER BY 1, 2`)
  t(pols.length === 2, `2 policies no total (${pols.length})`)
  t(pols.every(p => p.tablename === 'mcp_oauth_access_grants'),
    'as duas em access_grants — clientes, códigos e tokens ficam sem policy de propósito')
  t(pols.every(p => (p.qual ?? '').includes('uid()')),
    'as duas amarram em auth.uid() — o dono só enxerga os próprios consentimentos')

  // ═══ Regras exercitadas de verdade, revertidas ao fim ═════════════════════
  console.log('\n── regras exercitadas (com ROLLBACK) ──')
  try {
    await db.transaction(async (tx) => {
      const uid = '11111111-1111-1111-1111-111111111111'
      const [{ org }] = await tx.execute<{ org: string }>(sql`
        SELECT organization_id::text AS org FROM transactions
        GROUP BY organization_id ORDER BY COUNT(*) DESC LIMIT 1`)

      const recusa = async (rotulo: string, fn: () => Promise<unknown>) => {
        await tx.execute(sql`SAVEPOINT s`)
        try { await fn(); await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); t(false, `${rotulo} — aceito e não devia`) }
        catch { await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); t(true, `${rotulo} — recusado`) }
      }

      const cli = 'lure_cli_conferencia_0030'
      await tx.execute(sql`
        INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris)
        VALUES (${cli}, 'Conferência', ARRAY['https://claude.ai/api/mcp/auth_callback'])`)
      t(true, 'registra cliente público (sem segredo, method none por default)')

      await recusa('cliente sem nenhum redirect', () =>
        tx.execute(sql`INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris)
                       VALUES ('x1', 'X', ARRAY[]::text[])`))
      await recusa('método de autenticação inventado', () =>
        tx.execute(sql`INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, token_endpoint_auth_method)
                       VALUES ('x2', 'X', ARRAY['https://a.b/cb'], 'sei_la')`))

      const [grant] = await tx.execute<{ id: string }>(sql`
        INSERT INTO mcp_oauth_access_grants (user_id, client_id, organization_ids, scopes)
        VALUES (${uid}::uuid, ${cli}, ARRAY[${org}::uuid], ARRAY['leitura'])
        RETURNING id::text AS id`)
      t(!!grant.id, 'grava o consentimento com a organização escolhida')

      await recusa('consentimento sem nenhuma organização', () =>
        tx.execute(sql`INSERT INTO mcp_oauth_access_grants (user_id, client_id, organization_ids, scopes)
                       VALUES (${uid}::uuid, ${cli}, ARRAY[]::uuid[], ARRAY['leitura'])`))
      await recusa('consentimento sem nenhum escopo', () =>
        tx.execute(sql`INSERT INTO mcp_oauth_access_grants (user_id, client_id, organization_ids, scopes)
                       VALUES (${uid}::uuid, ${cli}, ARRAY[${org}::uuid], ARRAY[]::text[])`))

      await recusa('código com PKCE plain', () =>
        tx.execute(sql`
          INSERT INTO mcp_oauth_authorization_codes
            (code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method,
             scopes, organization_ids, expires_at)
          VALUES ('h1', ${cli}, ${uid}::uuid, 'https://claude.ai/api/mcp/auth_callback',
                  'desafio', 'plain', ARRAY['leitura'], ARRAY[${org}::uuid], now() + interval '60 seconds')`))

      await tx.execute(sql`
        INSERT INTO mcp_oauth_authorization_codes
          (code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method,
           scopes, organization_ids, expires_at)
        VALUES ('h1', ${cli}, ${uid}::uuid, 'https://claude.ai/api/mcp/auth_callback',
                'desafio', 'S256', ARRAY['leitura'], ARRAY[${org}::uuid], now() + interval '60 seconds')`)
      t(true, 'código com S256 é aceito')

      const [tokVelho] = await tx.execute<{ id: string }>(sql`
        INSERT INTO mcp_oauth_tokens (grant_id, kind, token_hash, expires_at)
        VALUES (${grant.id}::uuid, 'refresh', 'hash_velho', now() + interval '30 days')
        RETURNING id::text AS id`)
      const [tokNovo] = await tx.execute<{ id: string }>(sql`
        INSERT INTO mcp_oauth_tokens (grant_id, kind, token_hash, expires_at, replaced_by)
        VALUES (${grant.id}::uuid, 'refresh', 'hash_novo', now() + interval '30 days', ${tokVelho.id}::uuid)
        RETURNING id::text AS id`)
      t(!!tokNovo.id, 'rotação de refresh: o novo aponta para o que substituiu')

      await recusa('tipo de token inventado', () =>
        tx.execute(sql`INSERT INTO mcp_oauth_tokens (grant_id, kind, token_hash, expires_at)
                       VALUES (${grant.id}::uuid, 'magico', 'h9', now() + interval '1 hour')`))
      await recusa('dois tokens com o mesmo hash', () =>
        tx.execute(sql`INSERT INTO mcp_oauth_tokens (grant_id, kind, token_hash, expires_at)
                       VALUES (${grant.id}::uuid, 'access', 'hash_velho', now() + interval '1 hour')`))

      // ── SET NULL: apagar o elo antigo não pode derrubar o novo ────────────
      await tx.execute(sql`DELETE FROM mcp_oauth_tokens WHERE id = ${tokVelho.id}::uuid`)
      const [sobrou] = await tx.execute<{ n: number; ref: string | null }>(sql`
        SELECT COUNT(*)::int AS n, MAX(replaced_by::text) AS ref
        FROM mcp_oauth_tokens WHERE id = ${tokNovo.id}::uuid`)
      t(Number(sobrou.n) === 1 && sobrou.ref === null,
        'apagar o token substituído deixa o novo vivo com replaced_by nulo')

      // ── CASCADE: revogar o cliente apaga tudo que dependia dele ───────────
      await tx.execute(sql`DELETE FROM mcp_oauth_clients WHERE client_id = ${cli}`)
      const [{ g, c, k }] = await tx.execute<{ g: number; c: number; k: number }>(sql`
        SELECT (SELECT COUNT(*)::int FROM mcp_oauth_access_grants       WHERE client_id = ${cli}) AS g,
               (SELECT COUNT(*)::int FROM mcp_oauth_authorization_codes WHERE client_id = ${cli}) AS c,
               (SELECT COUNT(*)::int FROM mcp_oauth_tokens WHERE grant_id = ${grant.id}::uuid)    AS k`)
      t(Number(g) === 0 && Number(c) === 0 && Number(k) === 0,
        'apagar o cliente leva consentimentos, códigos e — pela cadeia — os tokens')

      throw new Error('__ROLLBACK__')
    })
  } catch (e) {
    if ((e as Error).message !== '__ROLLBACK__') { console.error('ERRO:', e); falhas++ }
  }

  console.log(`\n${ok} ok, ${falhas} falha(s) — tudo que foi escrito no teste foi revertido`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(e => { console.error('ERRO:', e); process.exit(1) })
