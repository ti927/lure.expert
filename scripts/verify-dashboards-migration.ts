/**
 * Fase 1.4 — valida a migration 0028 e o schema Zod do bloco.
 *
 * A migration roda INTEIRA dentro de uma transação que termina em ROLLBACK, e
 * as regras são exercitadas de verdade: o que deve ser recusado tem de ser
 * recusado. É o mesmo ritual das migrations 0026 e 0027.
 *
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-dashboards-migration.ts
 */
import { readFileSync } from 'fs'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { blockSpecSchema, lerBlockSpec, layoutSchema, REGRAS_DE_ALERTA, INDICADORES } from '@/lib/dashboard/block-spec'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

async function main() {
  // ── Parte 1: o Zod do bloco, sem tocar o banco ──────────────────────────
  const kpiValido = {
    versao: 1, tipo: 'kpi', titulo: 'Receita do mês', largura: 3,
    query: {
      fonte: 'realizado', medidas: ['valor_liquido'],
      periodo: { tipo: 'relativo', meses: 1, regime: 'competencia' },
    },
  }
  t(blockSpecSchema.safeParse(kpiValido).success, 'bloco KPI válido passa')

  const rankingUen = {
    versao: 1, tipo: 'ranking', titulo: 'Top 5 unidades',
    query: {
      fonte: 'realizado', medidas: ['saidas'], agruparPor: ['unidade_de_negocio'],
      periodo: { tipo: 'relativo', meses: 12, regime: 'caixa' },
      ordenarPor: [{ por: 'saidas', direcao: 'desc' }], limite: 5,
    },
  }
  const rk = blockSpecSchema.safeParse(rankingUen)
  t(rk.success, 'o bloco que originou o projeto ("top 5 UENs") é uma spec válida')

  t(!blockSpecSchema.safeParse({ versao: 1, tipo: 'inexistente' }).success,
    'tipo de bloco desconhecido é recusado')
  t(!blockSpecSchema.safeParse({ versao: 99, tipo: 'texto', markdown: 'x' }).success,
    'versão futura é recusada — spec de schema novo não renderiza em código velho')
  t(!blockSpecSchema.safeParse({
      versao: 1, tipo: 'kpi',
      query: { fonte: 'realizado', medidas: [], periodo: { tipo: 'relativo', meses: 1 } },
    }).success,
    'consulta sem medida é recusada dentro do bloco (o Zod do motor vale aqui)')
  t(!blockSpecSchema.safeParse({
      versao: 1, tipo: 'serie',
      query: {
        fonte: 'realizado', medidas: ['valor_liquido'],
        agruparPor: ['mes', 'categoria', 'conta'],
        periodo: { tipo: 'relativo', meses: 12 },
      },
    }).success,
    'o teto de 2 agrupamentos vale dentro do bloco')

  const alerta = blockSpecSchema.safeParse({ versao: 1, tipo: 'alertas' })
  t(alerta.success && alerta.data.tipo === 'alertas' && alerta.data.regras.length === 8,
    `bloco de alertas nasce com as ${REGRAS_DE_ALERTA.length} regras da tela atual`)
  const ind = blockSpecSchema.safeParse({ versao: 1, tipo: 'indicador' })
  t(ind.success && ind.data.tipo === 'indicador' && ind.data.indicadores.length === 7,
    `bloco de indicadores nasce com os ${INDICADORES.length} da tela atual`)

  const quebrado = lerBlockSpec({ versao: 1, tipo: 'kpi' })
  t(!quebrado.ok && quebrado.erro.length > 0,
    `spec inválida devolve erro em vez de lançar: "${!quebrado.ok ? quebrado.erro : ''}"`)

  t(layoutSchema.safeParse({}).success && layoutSchema.parse({}).colunas === 12,
    'layout vazio assume grade de 12 colunas')

  // Ida e volta por JSON — é assim que a spec vive no banco.
  const roundTrip = lerBlockSpec(JSON.parse(JSON.stringify(rk.success ? rk.data : {})))
  t(roundTrip.ok, 'spec sobrevive a JSON.stringify/parse (o caminho jsonb)')

  // ── Parte 2: a migration, dentro de uma transação revertida ─────────────
  const migration = readFileSync('db/migrations/rls/0028_dashboards.sql', 'utf8')

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(migration))
      console.log('\n— migration executou sem erro de sintaxe —')

      const cols = await tx.execute<{ table_name: string; n: number }>(sql`
        SELECT table_name, COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_name IN ('dashboards','dashboard_blocks','dashboard_shares')
        GROUP BY 1 ORDER BY 1`)
      t(cols.length === 3, `3 tabelas criadas (${cols.map(c => `${c.table_name}:${c.n}`).join(' ')})`)

      const pol = await tx.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM pg_policies
        WHERE tablename IN ('dashboards','dashboard_blocks','dashboard_shares')`)
      t(Number(pol[0].n) === 12, `12 policies RLS (${pol[0].n})`)

      const idx = await tx.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM pg_indexes
        WHERE indexname LIKE 'idx_dashboard%'`)
      // 3 em dashboards (slug único, um padrão só, org+dono),
      // 2 em dashboard_blocks (painel+posição, org),
      // 3 em dashboard_shares (painel, usuário, alvo único).
      t(Number(idx[0].n) === 8, `8 índices (${idx[0].n})`)

      const [{ org }] = await tx.execute<{ org: string }>(sql`
        SELECT organization_id::text AS org FROM transactions
        GROUP BY organization_id ORDER BY COUNT(*) DESC LIMIT 1`)
      const uid = '11111111-1111-1111-1111-111111111111'

      const [painel] = await tx.execute<{ id: string }>(sql`
        INSERT INTO dashboards (organization_id, owner_user_id, name, slug, is_default)
        VALUES (${org}::uuid, ${uid}::uuid, 'Visão geral', 'visao-geral', true)
        RETURNING id::text AS id`)
      t(!!painel.id, 'cria painel')

      const recusa = async (rotulo: string, fn: () => Promise<unknown>) => {
        await tx.execute(sql`SAVEPOINT s`)
        try { await fn(); await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); t(false, `${rotulo} — aceito e não devia`) }
        catch { await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); t(true, `${rotulo} — recusado`) }
      }

      await recusa('slug com maiúscula ou espaço', () =>
        tx.execute(sql`INSERT INTO dashboards (organization_id, owner_user_id, name, slug)
                       VALUES (${org}::uuid, ${uid}::uuid, 'X', 'Visao Geral')`))
      await recusa('slug repetido para o mesmo dono', () =>
        tx.execute(sql`INSERT INTO dashboards (organization_id, owner_user_id, name, slug)
                       VALUES (${org}::uuid, ${uid}::uuid, 'Outro', 'visao-geral')`))
      await recusa('segundo painel padrão do mesmo dono', () =>
        tx.execute(sql`INSERT INTO dashboards (organization_id, owner_user_id, name, slug, is_default)
                       VALUES (${org}::uuid, ${uid}::uuid, 'Outro', 'outro', true)`))

      await tx.execute(sql`
        INSERT INTO dashboard_blocks (dashboard_id, organization_id, position, spec)
        VALUES (${painel.id}::uuid, ${org}::uuid, 0, ${JSON.stringify(rk.success ? rk.data : {})}::jsonb)`)
      const [blocos] = await tx.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM dashboard_blocks WHERE dashboard_id = ${painel.id}::uuid`)
      t(Number(blocos.n) === 1, 'grava bloco com a spec em jsonb')

      await recusa('spec que não é objeto', () =>
        tx.execute(sql`INSERT INTO dashboard_blocks (dashboard_id, organization_id, spec)
                       VALUES (${painel.id}::uuid, ${org}::uuid, '[]'::jsonb)`))

      await tx.execute(sql`
        INSERT INTO dashboard_shares (dashboard_id, organization_id, scope)
        VALUES (${painel.id}::uuid, ${org}::uuid, 'organizacao')`)
      await recusa('compartilhar com a organização nomeando usuário', () =>
        tx.execute(sql`INSERT INTO dashboard_shares (dashboard_id, organization_id, scope, user_id)
                       VALUES (${painel.id}::uuid, ${org}::uuid, 'organizacao', ${uid}::uuid)`))
      await recusa('compartilhar com pessoas sem dizer quem', () =>
        tx.execute(sql`INSERT INTO dashboard_shares (dashboard_id, organization_id, scope)
                       VALUES (${painel.id}::uuid, ${org}::uuid, 'usuarios')`))
      await recusa('o mesmo alvo duas vezes', () =>
        tx.execute(sql`INSERT INTO dashboard_shares (dashboard_id, organization_id, scope)
                       VALUES (${painel.id}::uuid, ${org}::uuid, 'organizacao')`))

      await tx.execute(sql`DELETE FROM dashboards WHERE id = ${painel.id}::uuid`)
      const [orfaos] = await tx.execute<{ b: number; s: number }>(sql`
        SELECT (SELECT COUNT(*)::int FROM dashboard_blocks WHERE dashboard_id = ${painel.id}::uuid) AS b,
               (SELECT COUNT(*)::int FROM dashboard_shares WHERE dashboard_id = ${painel.id}::uuid) AS s`)
      t(Number(orfaos.b) === 0 && Number(orfaos.s) === 0,
        'apagar o painel leva blocos e compartilhamentos (CASCADE)')

      throw new Error('__ROLLBACK__')
    })
  } catch (e) {
    if ((e as Error).message !== '__ROLLBACK__') { console.error('\nERRO:', e); falhas++ }
  }

  console.log(`\n${ok} ok, ${falhas} falha(s) — a migration foi revertida`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(e => { console.error('ERRO:', e); process.exit(1) })
