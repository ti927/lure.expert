/**
 * Confere as migrations 0028 e 0029 JÁ APLICADAS contra o banco.
 *
 * Leituras do catálogo são inofensivas. As regras são exercitadas dentro de uma
 * transação com ROLLBACK — nada fica. Mesmo ritual das 0026 e 0027.
 *
 *   DATABASE_URL="<pooler>" npx tsx scripts/confere-0028-0029.ts
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

async function main() {
  // ═══ 0028 — painéis ═══════════════════════════════════════════════════════
  console.log('── migration 0028 (painéis) ──')

  const tabelas = await db.execute<{ table_name: string; n: number }>(sql`
    SELECT table_name, COUNT(*)::int AS n FROM information_schema.columns
    WHERE table_name IN ('dashboards','dashboard_blocks','dashboard_shares')
    GROUP BY 1 ORDER BY 1`)
  t(tabelas.length === 3, `3 tabelas (${tabelas.map(r => `${r.table_name}:${r.n}col`).join(' ')})`)

  const idx = await db.execute<{ indexname: string; indexdef: string }>(sql`
    SELECT indexname, indexdef FROM pg_indexes WHERE indexname LIKE 'idx_dashboard%' ORDER BY 1`)
  t(idx.length === 8, `8 índices (${idx.length})`)
  t(idx.some(i => i.indexname === 'idx_dashboards_um_padrao' && i.indexdef.includes('WHERE') && i.indexdef.includes('UNIQUE')),
    'idx_dashboards_um_padrao é UNIQUE e parcial (um painel padrão por dono)')
  t(idx.some(i => i.indexname === 'idx_dashboard_shares_unico' && i.indexdef.includes('UNIQUE')),
    'idx_dashboard_shares_unico é UNIQUE (alvo não repete no mesmo painel)')

  const rls28 = await db.execute<{ relname: string; on: boolean }>(sql`
    SELECT relname, relrowsecurity AS on FROM pg_class
    WHERE relname IN ('dashboards','dashboard_blocks','dashboard_shares')`)
  t(rls28.length === 3 && rls28.every(r => r.on === true), 'RLS habilitada nas 3')

  const pol28 = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM pg_policies
    WHERE tablename IN ('dashboards','dashboard_blocks','dashboard_shares')`)
  t(Number(pol28[0].n) === 12, `12 policies (${pol28[0].n})`)

  const trg28 = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM pg_trigger
    WHERE tgname IN ('trg_dashboards_updated_at','trg_dashboard_blocks_updated_at')`)
  t(Number(trg28[0].n) === 2, `2 triggers updated_at (${trg28[0].n})`)

  const fk28 = await db.execute<{ conname: string; confdeltype: string }>(sql`
    SELECT conname, confdeltype FROM pg_constraint
    WHERE conrelid IN ('dashboard_blocks'::regclass, 'dashboard_shares'::regclass)
      AND contype = 'f' AND conname LIKE '%dashboard_id%'`)
  t(fk28.length === 2 && fk28.every(f => f.confdeltype === 'c'),
    'blocos e compartilhamentos apontam para o painel com ON DELETE CASCADE')

  // ═══ 0029 — chave de IA ═══════════════════════════════════════════════════
  console.log('\n── migration 0029 (chave de IA) ──')

  const cols29 = await db.execute<{ column_name: string; data_type: string; numeric_precision: number | null; numeric_scale: number | null }>(sql`
    SELECT column_name, data_type, numeric_precision, numeric_scale
    FROM information_schema.columns WHERE table_name = 'organization_ai_settings'
    ORDER BY ordinal_position`)
  t(cols29.length === 11, `11 colunas (${cols29.length})`)
  const teto = cols29.find(c => c.column_name === 'monthly_limit_usd')
  t(teto?.numeric_precision === 10 && teto?.numeric_scale === 2,
    `monthly_limit_usd é numeric(10,2) — o menor teto possível é US$ 0,01`)

  const chk29 = await db.execute<{ conname: string }>(sql`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'organization_ai_settings'::regclass AND contype = 'c' ORDER BY 1`)
  t(chk29.length === 5, `5 CHECKs (${chk29.map(c => c.conname.replace('org_ai_', '')).join(', ')})`)

  const rls29 = await db.execute<{ on: boolean }>(sql`
    SELECT relrowsecurity AS on FROM pg_class WHERE relname = 'organization_ai_settings'`)
  t(rls29[0]?.on === true, 'RLS habilitada')

  const pol29 = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM pg_policies WHERE tablename = 'organization_ai_settings'`)
  t(Number(pol29[0].n) === 4, `4 policies (${pol29[0].n})`)

  // ── O backfill é o ponto crítico: sem ele, aplicar desligaria a IA. ───────
  const back = await db.execute<{ orgs: number; linhas: number; plataforma: number; comChave: number }>(sql`
    SELECT (SELECT COUNT(*)::int FROM organizations)                                          AS orgs,
           (SELECT COUNT(*)::int FROM organization_ai_settings)                               AS linhas,
           (SELECT COUNT(*)::int FROM organization_ai_settings WHERE key_source = 'platform') AS "plataforma",
           (SELECT COUNT(*)::int FROM organization_ai_settings WHERE api_key_encrypted IS NOT NULL) AS "comChave"`)
  const b = back[0]
  t(Number(b.linhas) === Number(b.orgs),
    `uma linha por organização (${b.linhas}/${b.orgs})`)
  t(Number(b.plataforma) === Number(b.orgs),
    `todas em 'platform' — nenhuma organização perdeu IA ao aplicar (${b.plataforma})`)
  t(Number(b.comChave) === 0, 'nenhuma chave cadastrada ainda, como esperado')

  // ── Regras exercitadas de verdade, revertidas ao fim ─────────────────────
  console.log('\n── regras exercitadas (com ROLLBACK) ──')
  try {
    await db.transaction(async (tx) => {
      const [{ org }] = await tx.execute<{ org: string }>(sql`
        SELECT organization_id::text AS org FROM transactions
        GROUP BY organization_id ORDER BY COUNT(*) DESC LIMIT 1`)
      const uid = '11111111-1111-1111-1111-111111111111'

      const recusa = async (rotulo: string, fn: () => Promise<unknown>) => {
        await tx.execute(sql`SAVEPOINT s`)
        try { await fn(); await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); t(false, `${rotulo} — aceito e não devia`) }
        catch { await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); t(true, `${rotulo} — recusado`) }
      }

      const [painel] = await tx.execute<{ id: string }>(sql`
        INSERT INTO dashboards (organization_id, owner_user_id, name, slug, is_default)
        VALUES (${org}::uuid, ${uid}::uuid, 'Conferência', 'conferencia', true)
        RETURNING id::text AS id`)
      t(!!painel.id, 'cria painel no banco de verdade')

      await recusa('slug com espaço', () =>
        tx.execute(sql`INSERT INTO dashboards (organization_id, owner_user_id, name, slug)
                       VALUES (${org}::uuid, ${uid}::uuid, 'X', 'com espaco')`))
      await recusa('segundo painel padrão do mesmo dono', () =>
        tx.execute(sql`INSERT INTO dashboards (organization_id, owner_user_id, name, slug, is_default)
                       VALUES (${org}::uuid, ${uid}::uuid, 'Y', 'outro', true)`))
      await recusa('spec que não é objeto', () =>
        tx.execute(sql`INSERT INTO dashboard_blocks (dashboard_id, organization_id, spec)
                       VALUES (${painel.id}::uuid, ${org}::uuid, '"texto"'::jsonb)`))
      await recusa('compartilhar com a organização nomeando pessoa', () =>
        tx.execute(sql`INSERT INTO dashboard_shares (dashboard_id, organization_id, scope, user_id)
                       VALUES (${painel.id}::uuid, ${org}::uuid, 'organizacao', ${uid}::uuid)`))

      await tx.execute(sql`
        INSERT INTO dashboard_blocks (dashboard_id, organization_id, position, spec)
        VALUES (${painel.id}::uuid, ${org}::uuid, 0, '{"versao":1,"tipo":"texto","markdown":"ok"}'::jsonb)`)
      await tx.execute(sql`DELETE FROM dashboards WHERE id = ${painel.id}::uuid`)
      const [{ sobrou }] = await tx.execute<{ sobrou: number }>(sql`
        SELECT COUNT(*)::int AS sobrou FROM dashboard_blocks WHERE dashboard_id = ${painel.id}::uuid`)
      t(Number(sobrou) === 0, 'apagar o painel leva os blocos (CASCADE)')

      await recusa('origem de chave inventada', () =>
        tx.execute(sql`UPDATE organization_ai_settings SET key_source = 'sei_la' WHERE organization_id = ${org}::uuid`))
      await recusa('teto negativo', () =>
        tx.execute(sql`UPDATE organization_ai_settings SET monthly_limit_usd = -1 WHERE organization_id = ${org}::uuid`))
      await recusa('limiar acima de 100', () =>
        tx.execute(sql`UPDATE organization_ai_settings SET alert_threshold = 150 WHERE organization_id = ${org}::uuid`))
      await recusa('chave cifrada sem os 4 últimos', () =>
        tx.execute(sql`UPDATE organization_ai_settings SET api_key_encrypted = 'v1.a.b.c' WHERE organization_id = ${org}::uuid`))
      await recusa('mês de alerta em formato livre', () =>
        tx.execute(sql`UPDATE organization_ai_settings SET alerted_month = 'agosto' WHERE organization_id = ${org}::uuid`))

      throw new Error('__ROLLBACK__')
    })
  } catch (e) {
    if ((e as Error).message !== '__ROLLBACK__') { console.error('ERRO:', e); falhas++ }
  }

  console.log(`\n${ok} ok, ${falhas} falha(s) — tudo que foi escrito no teste foi revertido`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(e => { console.error('ERRO:', e); process.exit(1) })
