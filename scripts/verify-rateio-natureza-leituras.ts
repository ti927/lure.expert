/**
 * Sessão 1 do rateio de natureza: as leituras migradas para `transaction_lines`
 * devolvem EXATAMENTE o que devolviam. Enquanto a 0033 não existe, a natureza
 * da linha é a do lançamento — então qualquer diferença é defeito.
 *
 *   DATABASE_URL=postgresql://postgres:local@localhost:55432/postgres \
 *     npx tsx --env-file=.env.local scripts/verify-rateio-natureza-leituras.ts
 *
 * O "antigo" não é redigitado: os módulos são extraídos VERBATIM da tag
 * backup/antes-rateio-natureza-2026-09-29 (commit 1dc9469) para
 * scripts/_antigos/ e importados lado a lado com os novos — é a mesma função,
 * de antes e de depois, sobre o mesmo banco. O que era `'use server'` (Balanço,
 * contagem de categorias) não é importável fora de uma sessão; ali o antigo é o
 * SQL copiado do mesmo commit, e a contagem de uso é conferida contra um JOIN
 * correto, porque a antiga vivia em zero (Decisão 18).
 *
 * Só leitura. Depois da 0033 este script DEVE falhar nos lançamentos rateados —
 * é a prova de que a migração das leituras era necessária (plano, Tarefa 13).
 */
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

const PASTA = 'scripts/_antigos'
const TAG = 'backup/antes-rateio-natureza-2026-09-29'

function extrair(caminho: string, destino: string, relativoParaAlias: boolean) {
  let fonte = execSync(`git show ${TAG}:${caminho}`, { encoding: 'utf8' })
  if (relativoParaAlias) fonte = fonte.replace(/from '\.\//g, "from '@/lib/")
  writeFileSync(`${PASTA}/${destino}`, fonte)
}

mkdirSync(PASTA, { recursive: true })
extrair('src/lib/dashboard/kpis.ts', 'kpis.ts', false)
extrair('src/lib/dashboard/indicators.ts', 'indicators.ts', false)   // importa './kpis' — o antigo, ao lado
extrair('src/lib/recurrence-detect.ts', 'recurrence-detect.ts', true)
extrair('src/lib/budget-copy.ts', 'budget-copy.ts', true)

async function main() {
  const { db } = await import('@/db')
  const { sql } = await import('drizzle-orm')
  const novoKpis = await import('@/lib/dashboard/kpis')
  const novoInd = await import('@/lib/dashboard/indicators')
  const novoRec = await import('@/lib/recurrence-detect')
  const novoCopy = await import('@/lib/budget-copy')
  const { lerLinhasDoBalanco, somarBalancoPorDocumento } = await import('@/lib/balance-sheet-read')
  const { contarUsoPorNatureza, contarUsoDaNatureza } = await import('@/lib/category-usage')
  const { semNaturezaFilter, dimensionExistsFilter } = await import('@/lib/sql-dimensions')
  // Caminho em variável: os arquivos só existem durante a execução, e um import
  // literal faria o `next build` (que checa `scripts/`) procurá-los. O tipo é o
  // do módulo novo — a assinatura das funções comparadas não mudou.
  const antigo = (nome: string) => import(`./_antigos/${nome}`)
  const velhoKpis = await antigo('kpis') as typeof novoKpis
  const velhoInd = await antigo('indicators') as typeof novoInd
  const velhoRec = await antigo('recurrence-detect') as typeof novoRec
  const velhoCopy = await antigo('budget-copy') as typeof novoCopy

  let ok = 0, falhas = 0
  const t = (c: boolean, l: string) => { if (c) ok++; else { falhas++; console.log(`FALHA| ${l}`) } }
  const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const cont: Record<string, number> = {}
  const conta = (k: string) => { cont[k] = (cont[k] ?? 0) + 1 }

  const orgs = await db.execute<{ id: string; nome: string }>(sql`
    SELECT o.id::text AS id, o.name AS nome FROM organizations o
    WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.organization_id = o.id)
    ORDER BY o.name
  `)
  console.log(`${orgs.length} organizações com dado`)

  for (const o of orgs) {
    const meses = await db.execute<{ m: string }>(sql`
      SELECT DISTINCT TO_CHAR(date::date, 'YYYY-MM') AS m FROM transactions
      WHERE organization_id = ${o.id}::uuid ORDER BY 1
    `)

    // ── KPIs e indicadores: cada mês com dado ────────────────────────────────
    for (const { m } of meses) {
      t(igual(await velhoKpis.calcularKpisDoMes(o.id, m), await novoKpis.calcularKpisDoMes(o.id, m)),
        `${o.nome} ${m}: KPIs`)
      conta('kpis')
      t(igual(await velhoInd.calcularIndicadores(o.id, m), await novoInd.calcularIndicadores(o.id, m)),
        `${o.nome} ${m}: indicadores`)
      conta('indicadores')
    }

    // ── Copiar do realizado: os dois regimes, cada ano com dado ──────────────
    const anos = Array.from(new Set(meses.map(x => x.m.slice(0, 4))))
    for (const ano of anos) {
      for (const regime of ['competencia', 'caixa'] as const) {
        const input = {
          versionId: '00000000-0000-0000-0000-000000000000',
          sourceFrom: `${ano}-01`, sourceTo: `${ano}-12`, regime,
          shape: 'mensal' as const, granularity: 'dimensoes' as const, adjustmentPct: 0,
        }
        const a = await velhoCopy.collectActuals(db, o.id, input)
        const b = await novoCopy.collectActuals(db, o.id, input)
        t(igual(a.semCategoria, b.semCategoria), `${o.nome} ${ano} ${regime}: semCategoria ${JSON.stringify(a.semCategoria)} × ${JSON.stringify(b.semCategoria)}`)
        t(igual(a.inativas, b.inativas), `${o.nome} ${ano} ${regime}: inativas`)
        t(igual(a.actuals, b.actuals), `${o.nome} ${ano} ${regime}: linhas do realizado`)
        conta('copiar-do-realizado')
      }
    }

    // ── Recorrências ─────────────────────────────────────────────────────────
    t(igual(await velhoRec.detectarRecorrencias(o.id), await novoRec.detectarRecorrencias(o.id)),
      `${o.nome}: recorrências`)
    conta('recorrencias')

    // ── Balanço: todo documento de balanço (SQL antigo do commit 1dc9469) ────
    const docs = await db.execute<{ id: string }>(sql`
      SELECT id::text AS id FROM documents
      WHERE organization_id = ${o.id}::uuid AND report_type = 'balance_sheet'
    `)
    for (const d of docs) {
      const antigo = await db.execute<{ child_id: string; total: string }>(sql`
        SELECT c.id::text AS child_id, SUM(t.amount)::text AS total
          FROM transactions t JOIN categories c ON t.category_id = c.id
          JOIN categories p ON c.parent_id = p.id
         WHERE t.document_id = ${d.id}::uuid AND t.organization_id = ${o.id}::uuid
           AND p.type IN ('ativo_circulante','ativo_nao_circulante','passivo_circulante','passivo_nao_circulante','patrimonio_liquido')
         GROUP BY c.id ORDER BY 1
      `)
      const novo = (await lerLinhasDoBalanco(o.id, d.id))
        .map(r => ({ child_id: r.childId, total: r.total }))
        .sort((x, y) => x.child_id.localeCompare(y.child_id))
      t(igual(antigo.map(r => ({ child_id: r.child_id, total: Number(r.total) })), novo),
        `${o.nome}: balanço do documento ${d.id}`)
      conta('balanco')
    }
    if (docs.length > 0) {
      const antigo = await db.execute<{ d: string; c: string; v: string }>(sql`
        SELECT document_id::text AS d, category_id::text AS c, SUM(amount)::text AS v FROM transactions
         WHERE organization_id = ${o.id}::uuid AND category_id IS NOT NULL
           AND document_id IN (${sql.join(docs.map(d => sql`${d.id}::uuid`), sql`, `)})
         GROUP BY 1, 2 ORDER BY 1, 2
      `)
      const novo = (await somarBalancoPorDocumento(o.id, docs.map(d => d.id)))
        .sort((x, y) => (x.documentId + x.categoryId).localeCompare(y.documentId + y.categoryId))
      t(igual(antigo.map(r => ({ documentId: r.d, categoryId: r.c, total: Number(r.v) })), novo),
        `${o.nome}: balanço multi-data`)
      conta('balanco-multidata')
    }

    // ── Uso por natureza, contra um JOIN correto ─────────────────────────────
    const usoJoin = await db.execute<{ id: string; n: number }>(sql`
      SELECT c.id::text AS id, COUNT(t.id)::int AS n FROM categories c
        JOIN transactions t ON t.category_id = c.id
       WHERE c.organization_id = ${o.id}::uuid GROUP BY c.id
    `)
    const uso = await contarUsoPorNatureza(o.id)
    t(usoJoin.length === uso.size && usoJoin.every(r => uso.get(r.id) === Number(r.n)),
      `${o.nome}: uso por natureza (${usoJoin.length} em uso)`)
    if (usoJoin[0]) {
      t(await contarUsoDaNatureza(o.id, usoJoin[0].id) === Number(usoJoin[0].n), `${o.nome}: uso de uma natureza`)
    }
    conta('uso-por-natureza')

    // ── Sem natureza: `category_id IS NULL` × `semNaturezaFilter` ────────────
    const [sn] = await db.execute<{ antigo: number; novo: number }>(sql`
      SELECT COUNT(*) FILTER (WHERE t.category_id IS NULL)::int AS antigo,
             COUNT(*) FILTER (WHERE ${semNaturezaFilter(sql.raw('t.id'))})::int AS novo
        FROM transactions t WHERE t.organization_id = ${o.id}::uuid
    `)
    t(sn.antigo === sn.novo, `${o.nome}: sem natureza ${sn.antigo} × ${sn.novo}`)
    conta('sem-natureza')

    // ── Filtro de natureza de /transacoes e da revisão ───────────────────────
    const cats = await db.execute<{ id: string }>(sql`
      SELECT DISTINCT category_id::text AS id FROM transactions
      WHERE organization_id = ${o.id}::uuid AND category_id IS NOT NULL ORDER BY 1 LIMIT 3
    `)
    if (cats.length > 0) {
      const ids = cats.map(c => c.id)
      for (const includeNone of [false, true]) {
        const f = dimensionExistsFilter(sql.raw('t.id'), 'category_id', { ids, includeNone, includeClassified: false })!
        const antigoCond = includeNone
          ? sql`(t.category_id IS NULL OR t.category_id IN (${sql.join(ids.map(i => sql`${i}::uuid`), sql`, `)}))`
          : sql`t.category_id IN (${sql.join(ids.map(i => sql`${i}::uuid`), sql`, `)})`
        const [r] = await db.execute<{ antigo: number; novo: number }>(sql`
          SELECT COUNT(*) FILTER (WHERE ${antigoCond})::int AS antigo,
                 COUNT(*) FILTER (WHERE ${f})::int AS novo
            FROM transactions t WHERE t.organization_id = ${o.id}::uuid
        `)
        t(r.antigo === r.novo, `${o.nome}: filtro de natureza (sem natureza=${includeNone}) ${r.antigo} × ${r.novo}`)
        conta('filtro-natureza')
      }
      const f = dimensionExistsFilter(sql.raw('t.id'), 'category_id', { ids: [], includeNone: false, includeClassified: true })!
      const [r] = await db.execute<{ antigo: number; novo: number }>(sql`
        SELECT COUNT(*) FILTER (WHERE t.category_id IS NOT NULL)::int AS antigo,
               COUNT(*) FILTER (WHERE ${f})::int AS novo
          FROM transactions t WHERE t.organization_id = ${o.id}::uuid
      `)
      t(r.antigo === r.novo, `${o.nome}: filtro "classificadas" ${r.antigo} × ${r.novo}`)
    }
  }

  // Asserções que dão sentido às anteriores: sem dado, tudo passaria vazio.
  const [base] = await db.execute<{ classificados: number; rateados: number; semnat: number }>(sql`
    SELECT (SELECT COUNT(*)::int FROM transactions WHERE category_id IS NOT NULL) AS classificados,
           (SELECT COUNT(DISTINCT transaction_id)::int FROM transaction_allocations) AS rateados,
           (SELECT COUNT(*)::int FROM transactions WHERE category_id IS NULL) AS semnat
  `)
  t(Number(base.classificados) > 0, 'a base tem lançamento classificado')
  t(Number(base.rateados) > 0, `a base tem lançamento rateado (${base.rateados}) — é onde a view difere de transactions`)
  t(Number(base.semnat) > 0, `a base tem lançamento sem natureza (${base.semnat})`)

  console.log('comparações por leitura:', JSON.stringify(cont))
  console.log(`\n${ok + falhas} verificações — ${ok} OK, ${falhas} falha(s)`)
  return falhas
}

main()
  .then(f => { rmSync(PASTA, { recursive: true, force: true }); process.exit(f > 0 ? 1 : 0) })
  .catch(e => { rmSync(PASTA, { recursive: true, force: true }); console.error(e); process.exit(1) })
