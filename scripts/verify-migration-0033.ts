/**
 * Valida a 0033 e a reversa ANTES de aplicar: tudo numa transação que termina
 * em ROLLBACK. Nada persiste.
 *
 *   DATABASE_URL=<banco> npx tsx --env-file=.env.local scripts/verify-migration-0033.ts
 *
 * Roda no banco LOCAL durante o desenvolvimento e, no dia de subir, contra a
 * PRODUÇÃO (é ROLLBACK) — a base pode ter mudado desde o dump.
 *
 * O que precisa ser provado:
 * 1. Estrutura: as duas colunas, o índice, o gatilho olhando category_id, a
 *    view seguindo com security_invoker.
 * 2. Dado: nenhum lançamento rateado fica com natureza; toda parte de um
 *    lançamento que tinha natureza recebe a natureza dele; e — o número que
 *    importa — a soma por natureza da view é IDÊNTICA antes e depois.
 * 3. Regras exercitadas: natureza no lançamento rateado é recusada; trocar a
 *    natureza de UMA parte é aceito; lançamento sem rateio segue livre.
 * 4. A volta devolve o estado original: colunas fora, natureza de volta nos
 *    lançamentos, soma por natureza idêntica, gatilho antigo.
 * 5. A ida é idempotente.
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'

let ok = 0, falhas = 0
const t = (c: boolean, l: string) => { if (c) { ok++; console.log(`  OK    ${l}`) } else { falhas++; console.log(`  FALHA ${l}`) } }
class Reverter extends Error {}

const IDA   = readFileSync('db/migrations/rls/0033_rateio_de_natureza.sql', 'utf8')
const VOLTA = readFileSync('db/migrations/rls/0033_down_rateio_de_natureza.sql', 'utf8')

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Roda `corpo` num savepoint e força os gatilhos deferidos a dispararem agora.
 * Devolve a mensagem da recusa, ou null se passou. Volta ao savepoint também no
 * caminho de sucesso — senão o primeiro caso que passa contamina os seguintes.
 */
async function recusa(tx: Tx, corpo: () => Promise<unknown>): Promise<string | null> {
  await tx.execute(sql`SAVEPOINT sp`)
  let msg: string | null = null
  try {
    await corpo()
    await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
  } catch (e) {
    const pg = e as { message?: string; cause?: { message?: string } }
    msg = pg.cause?.message ?? pg.message ?? 'erro'
  }
  await tx.execute(sql`ROLLBACK TO SAVEPOINT sp`)
  await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`)
  return msg
}

const somaPorNatureza = (tx: Tx) => tx.execute<{ c: string | null; v: string }>(sql`
  SELECT category_id::text AS c, SUM(amount)::text AS v
    FROM transaction_lines GROUP BY 1 ORDER BY 1 NULLS FIRST
`).then(r => JSON.stringify(r))

async function main() {
  const [antes] = await db.execute<{ partes: number; rateados: number; com_nat: number; sem_nat: number }>(sql`
    SELECT (SELECT COUNT(*)::int FROM transaction_allocations) AS partes,
           (SELECT COUNT(DISTINCT transaction_id)::int FROM transaction_allocations) AS rateados,
           (SELECT COUNT(DISTINCT a.transaction_id)::int FROM transaction_allocations a
              JOIN transactions t ON t.id = a.transaction_id WHERE t.category_id IS NOT NULL) AS com_nat,
           (SELECT COUNT(DISTINCT a.transaction_id)::int FROM transaction_allocations a
              JOIN transactions t ON t.id = a.transaction_id WHERE t.category_id IS NULL) AS sem_nat
  `)
  console.log(`\nbase: ${antes.partes} partes, ${antes.rateados} lançamentos rateados (${antes.com_nat} com natureza, ${antes.sem_nat} sem)\n`)

  try {
    await db.transaction(async (tx) => {
      const somaAntes = await somaPorNatureza(tx)

      console.log('── ida ──')
      await tx.execute(sql.raw(IDA))

      const cols = await tx.execute(sql`
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'category_id' AND table_name IN ('transaction_allocations','allocation_template_lines')
      `)
      t(cols.length === 2, 'coluna category_id nas duas tabelas')
      const [idx] = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = 'idx_alloc_org_category'`)
      t(Number(idx.n) === 1, 'índice idx_alloc_org_category')
      const [trg] = await tx.execute<{ def: string }>(sql`
        SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'trg_transaction_allocation_guard'`)
      t(/category_id/.test(trg.def), 'gatilho do lançamento olha category_id')
      const [trgDef] = await tx.execute<{ d: boolean; i: boolean }>(sql`
        SELECT tgdeferrable AS d, tginitdeferred AS i FROM pg_trigger WHERE tgname = 'trg_transaction_allocation_guard'`)
      t(trgDef.d === true && trgDef.i === true, 'gatilho segue deferido até o commit')
      const [inv] = await tx.execute<{ v: boolean }>(sql`
        SELECT (reloptions @> ARRAY['security_invoker=true']) AS v FROM pg_class WHERE relname = 'transaction_lines'`)
      t(inv.v === true, 'view segue com security_invoker (senão furaria a RLS)')

      const [dep] = await tx.execute<{ pai_com: number; partes_herdaram: number; partes_de_pai_com_nat: number }>(sql`
        SELECT
          (SELECT COUNT(*)::int FROM transactions t WHERE t.category_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = t.id)) AS pai_com,
          (SELECT COUNT(DISTINCT transaction_id)::int FROM transaction_allocations WHERE category_id IS NOT NULL) AS partes_herdaram,
          (SELECT COUNT(*)::int FROM transaction_allocations WHERE category_id IS NULL) AS partes_de_pai_com_nat
      `)
      t(Number(dep.pai_com) === 0, `nenhum lançamento rateado ficou com natureza (${dep.pai_com})`)
      t(Number(dep.partes_herdaram) === Number(antes.com_nat),
        `os ${antes.com_nat} rateados que tinham natureza a passaram às partes (${dep.partes_herdaram})`)
      // As únicas partes sem natureza são as dos rateados cuja origem já não tinha.
      const [semAntes] = await tx.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM transaction_allocations a
         WHERE a.transaction_id IN (SELECT transaction_id FROM transaction_allocations GROUP BY 1
                                     HAVING bool_and(category_id IS NULL))`)
      t(Number(dep.partes_de_pai_com_nat) === Number(semAntes.n),
        `partes sem natureza são só as de origem sem natureza (${dep.partes_de_pai_com_nat})`)

      t(await somaPorNatureza(tx) === somaAntes, 'soma por natureza da view IDÊNTICA antes e depois')

      // ── as regras, exercitadas ─────────────────────────────────────────────
      const [alvo] = await tx.execute<{ tx: string; cat: string; org: string }>(sql`
        SELECT a.transaction_id::text AS tx, a.category_id::text AS cat, a.organization_id::text AS org
          FROM transaction_allocations a WHERE a.category_id IS NOT NULL ORDER BY a.transaction_id LIMIT 1`)
      const r1 = await recusa(tx, () => tx.execute(sql`
        UPDATE transactions SET category_id = ${alvo.cat}::uuid WHERE id = ${alvo.tx}::uuid`))
      t(r1 !== null && /natureza/.test(r1), `natureza no lançamento rateado é recusada: "${r1?.slice(0, 70)}…"`)

      const [outra] = await tx.execute<{ id: string }>(sql`
        SELECT c.id::text AS id FROM categories c
         WHERE c.organization_id = ${alvo.org}::uuid AND c.id <> ${alvo.cat}::uuid
           AND c.parent_id IS NOT NULL LIMIT 1`)
      const r2 = await recusa(tx, () => tx.execute(sql`
        UPDATE transaction_allocations SET category_id = ${outra.id}::uuid
         WHERE id = (SELECT id FROM transaction_allocations WHERE transaction_id = ${alvo.tx}::uuid ORDER BY sequence LIMIT 1)`))
      t(r2 === null, 'trocar a natureza de UMA parte é aceito')

      const r2b = await recusa(tx, () => tx.execute(sql`
        UPDATE transactions SET cost_center_id = (SELECT id FROM cost_centers WHERE organization_id = ${alvo.org}::uuid LIMIT 1)
         WHERE id = ${alvo.tx}::uuid`))
      t(r2b !== null, 'dimensão no lançamento rateado continua recusada')

      const [semRateio] = await tx.execute<{ id: string; cat: string | null }>(sql`
        SELECT t.id::text AS id, t.category_id::text AS cat FROM transactions t
         WHERE NOT EXISTS (SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = t.id)
           AND t.category_id IS NOT NULL LIMIT 1`)
      const r3 = await recusa(tx, () => tx.execute(sql`UPDATE transactions SET category_id = NULL WHERE id = ${semRateio.id}::uuid`))
      t(r3 === null, 'lançamento SEM rateio continua editável como antes')

      const r4 = await recusa(tx, () => tx.execute(sql`DELETE FROM transaction_allocations WHERE transaction_id = ${alvo.tx}::uuid`))
      t(r4 === null, 'remover todas as partes é aceito (o lançamento fica sem natureza — a aplicação a devolve)')

      // ── a volta ────────────────────────────────────────────────────────────
      console.log('── volta ──')
      await tx.execute(sql.raw(VOLTA))
      const colsDepois = await tx.execute(sql`
        SELECT 1 FROM information_schema.columns
        WHERE column_name = 'category_id' AND table_name IN ('transaction_allocations','allocation_template_lines')`)
      t(colsDepois.length === 0, 'colunas removidas')
      const [idx2] = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = 'idx_alloc_org_category'`)
      t(Number(idx2.n) === 0, 'índice removido')
      const [depois] = await tx.execute<{ com_nat: number }>(sql`
        SELECT COUNT(DISTINCT a.transaction_id)::int AS com_nat FROM transaction_allocations a
          JOIN transactions t ON t.id = a.transaction_id WHERE t.category_id IS NOT NULL`)
      t(Number(depois.com_nat) === Number(antes.com_nat), `natureza voltou aos ${antes.com_nat} rateados (${depois.com_nat})`)
      t(await somaPorNatureza(tx) === somaAntes, 'soma por natureza IDÊNTICA ao estado original')
      const [trg2] = await tx.execute<{ def: string }>(sql`
        SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'trg_transaction_allocation_guard'`)
      t(!/category_id/.test(trg2.def), 'gatilho restaurado')
      const r5 = await recusa(tx, () => tx.execute(sql`
        UPDATE transactions SET category_id = ${alvo.cat}::uuid WHERE id = (
          SELECT transaction_id FROM transaction_allocations ORDER BY transaction_id LIMIT 1)`))
      t(r5 === null, 'depois da volta, natureza no lançamento rateado é aceita de novo (regra antiga)')

      // ── idempotência da ida ────────────────────────────────────────────────
      console.log('── idempotência ──')
      await tx.execute(sql.raw(IDA))
      const somaIda1 = await somaPorNatureza(tx)
      await tx.execute(sql.raw(IDA))
      t(await somaPorNatureza(tx) === somaIda1 && somaIda1 === somaAntes, 'a ida roda duas vezes seguidas, sem efeito na segunda')

      throw new Reverter()
    })
  } catch (e) {
    if (!(e instanceof Reverter)) throw e
  }

  const [fim] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
    WHERE column_name = 'category_id' AND table_name = 'transaction_allocations'`)
  t(Number(fim.n) === 0, 'ROLLBACK: nada persistiu')

  console.log(`\n${ok + falhas} verificações — ${ok} OK, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
