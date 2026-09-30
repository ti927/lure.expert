/**
 * Sessão 3 do rateio de natureza: o que o servidor entrega às telas.
 *
 *   DATABASE_URL=postgresql://postgres:local@localhost:55432/postgres \
 *     npx tsx --env-file=.env.local scripts/verify-rateio-natureza-telas.ts
 *
 * As telas em si só o Julio vê. Aqui se prova o SQL que as alimenta:
 * 1. a célula de natureza de `/transacoes` num rateado (uma natureza, várias,
 *    parte sem natureza, sem rateio) — pelos MESMOS fragmentos que
 *    `getTransactions` usa, importados de `lib/sql-dimensions`;
 * 2. a contagem de uso dos modelos de rateio, que vivia em zero (Decisão 18).
 *    A expressão da tela mora num `'use server'` e não é importável; o teste a
 *    reproduz nas duas formas, a antiga e a corrigida, e as compara com a
 *    contagem direta — a antiga TEM de dar zero, senão o teste não prova nada.
 *
 * Organização descartável, criada e apagada aqui.
 */
import { db } from '@/db'
import { sql, eq } from 'drizzle-orm'
import { transactions, allocationTemplates } from '@/db/schema'
import { naturezasDoRateioSql, rateioComParteSemNaturezaSql } from '@/lib/sql-dimensions'
import { gravarAllocations } from '@/lib/allocations-write'

let ok = 0, falhas = 0
const t = (c: boolean, l: string) => { if (c) { ok++; console.log(`  OK    ${l}`) } else { falhas++; console.log(`  FALHA ${l}`) } }

const ORG_NOME = 'ZZ Teste Rateio Natureza Telas'
const limpar = () => db.execute(sql`DELETE FROM organizations WHERE name = ${ORG_NOME}`)

async function main() {
  await limpar()
  const [org] = await db.execute<{ id: string }>(sql`
    INSERT INTO organizations (name, slug, cnpj) VALUES (${ORG_NOME}, 'zz-teste-rateio-natureza-telas', '00000000000434')
    RETURNING id::text AS id`)
  const ORG = org.id
  await db.execute(sql`DELETE FROM categories WHERE organization_id = ${ORG}::uuid`)
  const cat = async (code: string, nome: string, pai: string | null) => (await db.execute<{ id: string }>(sql`
    INSERT INTO categories (organization_id, code, name, type, parent_id)
    VALUES (${ORG}::uuid, ${code}, ${nome}, 'sga', ${pai ? sql`${pai}::uuid` : sql`NULL`}) RETURNING id::text AS id`))[0].id
  const pai = await cat('1', 'Pai', null)
  const A1 = await cat('1.1', 'Aluguel', pai)
  const A2 = await cat('1.2', 'Energia', pai)
  const [ds] = await db.execute<{ id: string }>(sql`
    INSERT INTO data_sources (organization_id, type, provider, name, status)
    VALUES (${ORG}::uuid, 'manual', 'manual', 'ZZ', 'active') RETURNING id::text AS id`)
  const lanc = async (c: string | null, v: string) => (await db.execute<{ id: string }>(sql`
    INSERT INTO transactions (organization_id, data_source_id, category_id, date, description, amount, direction, status, currency)
    VALUES (${ORG}::uuid, ${ds.id}::uuid, ${c ? sql`${c}::uuid` : sql`NULL`}, '2026-03-10', 'ZZ', ${v}, 'outflow', 'confirmed', 'BRL')
    RETURNING id::text AS id`))[0].id
  const semDim = { costCenterId: null, businessUnitId: null, legalEntityId: null, contactId: null }

  const umaSo = await lanc(A1, '100.00')
  await gravarAllocations(ORG, umaSo, [{ amount: 60, ...semDim }, { amount: 40, ...semDim }])
  const duas = await lanc(A1, '100.00')
  await gravarAllocations(ORG, duas, [{ amount: 60, categoryId: A1, ...semDim }, { amount: 40, categoryId: A2, ...semDim }])
  const comSem = await lanc(A1, '100.00')
  await gravarAllocations(ORG, comSem, [{ amount: 60, categoryId: A1, ...semDim }, { amount: 40, categoryId: null, ...semDim }])
  const direto = await lanc(A2, '100.00')

  // A consulta como getTransactions a faz: `transactions` sem join, os mesmos fragmentos.
  const q = db.select({
    id: transactions.id,
    ids: naturezasDoRateioSql(sql`${transactions}.id`),
    sem: rateioComParteSemNaturezaSql(sql`${transactions}.id`),
  }).from(transactions).where(eq(transactions.organizationId, ORG))
  t(/"transactions"\.id/.test(q.toSQL().sql) && !/= "id"/.test(q.toSQL().sql),
    'o SQL emitido correlaciona por "transactions".id, não por "id" cru (Decisão 18)')
  const linhas = new Map((await q).map(r => [r.id, r]))

  const r1 = linhas.get(umaSo)!, r2 = linhas.get(duas)!, r3 = linhas.get(comSem)!, r4 = linhas.get(direto)!
  t(JSON.stringify(r1.ids) === JSON.stringify([A1]) && r1.sem === false, 'rateio numa natureza só → [Aluguel], sem parte vazia')
  t(r2.ids.length === 2 && r2.ids.includes(A1) && r2.ids.includes(A2) && r2.sem === false, 'rateio em duas naturezas → as duas')
  t(JSON.stringify(r3.ids) === JSON.stringify([A1]) && r3.sem === true, 'parte sem natureza → sinalizada (a célula fica âmbar)')
  t(r4.ids.length === 0 && r4.sem === false, 'lançamento sem rateio → lista vazia (a célula usa a natureza dele)')

  // ── Contagem de uso dos modelos: a antiga × a corrigida ────────────────────
  const [tpl] = await db.insert(allocationTemplates).values({ organizationId: ORG, name: 'ZZ modelo' })
    .returning({ id: allocationTemplates.id })
  const tx5 = await lanc(A1, '50.00')
  const r = await gravarAllocations(ORG, tx5, [{ amount: 25, ...semDim }, { amount: 25, ...semDim }], tpl.id)
  t('success' in r, 'rateio carimbado com o modelo')

  const contar = (expr: ReturnType<typeof sql>) => db.select({ n: expr })
    .from(allocationTemplates).where(eq(allocationTemplates.id, tpl.id)).then(x => Number((x[0] as { n: number }).n))
  const antiga = await contar(sql<number>`(SELECT COUNT(DISTINCT a.transaction_id)::int FROM transaction_allocations a
    WHERE a.allocation_template_id = ${allocationTemplates.id})`)
  const nova = await contar(sql<number>`(SELECT COUNT(DISTINCT a.transaction_id)::int FROM transaction_allocations a
    WHERE a.allocation_template_id = ${allocationTemplates}.id)`)
  t(antiga === 0, `a forma ANTIGA dava ${antiga} — o defeito existia (senão este teste não provaria nada)`)
  t(nova === 1, `a forma corrigida conta o lançamento: ${nova}`)

  await limpar()
  const [resto] = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM organizations WHERE name = ${ORG_NOME}`)
  t(Number(resto.n) === 0, 'limpeza: a organização de teste não sobrou')

  console.log(`\n${ok + falhas} verificações — ${ok} OK, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}
main().catch(async e => { console.error(e); await limpar().catch(() => {}); process.exit(1) })
