/**
 * Análise de fornecedores (Decisão 33) — migration 0037 + lib/fornecedores.ts.
 *
 *   PERMITIR_BANCO_REMOTO=1 DATABASE_URL=<pooler> npx tsx --env-file=.env.local \
 *     scripts/verify-fornecedores.ts [painel-quick-lancamentos.json]
 *
 * TUDO numa transação que termina em ROLLBACK: aplica a 0037, exercita mesa e
 * agrupamentos sobre a Quick Aviação real, aplica a reversa, e desfaz tudo. Nada
 * persiste. `lock_timeout` curto (lição de 27/out).
 *
 * O que precisa ser provado:
 * 1. Estrutura: 2 tabelas com RLS e 4 policies cada; unicidade (org, chave).
 * 2. CHECKs: tipo inválido, % acima de 100, redução negativa e padrão curto recusados.
 * 3. Agrupamentos: Natureza Filho recusada como "pai"; id de outra organização recusado.
 * 4. Consolidação: com os dois agrupamentos da Quick (folha em TED de lote e câmbio
 *    Ebury), o total e o valor de cada fornecedor batem com o painel de 24/nov —
 *    a menos dos lançamentos pendentes/duplicados, que o painel não excluía.
 * 5. Mesa: levar, atualizar (sem duplicar), recusar % > 100, tirar, tirar de novo
 *    recusado; cada escrita registrada em agent_events.
 * 6. Funções puras: meses-base, redução, classe ABC e a curva somando o total.
 * 7. A volta: as duas tabelas somem.
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { existsSync, readFileSync } from 'node:fs'
import { lerSaidasPorFornecedor, salvarAgrupamento, salvarItemMesa, tirarDaMesa, lerMesa } from '@/lib/fornecedores'
import { aplicarReducao, classeAbc, curvaAbc, mesesBase } from '@/lib/fornecedores-types'

let ok = 0, falhas = 0
const t = (c: boolean, l: string) => { if (c) { ok++; console.log(`  OK    ${l}`) } else { falhas++; console.log(`  FALHA ${l}`) } }
class Reverter extends Error {}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const url = process.env.DATABASE_URL ?? ''
if (!/localhost:55432/.test(url) && !process.env.PERMITIR_BANCO_REMOTO) {
  console.error('ABORTADO: banco remoto sem PERMITIR_BANCO_REMOTO=1.')
  process.exit(2)
}
const IDA = readFileSync('db/migrations/rls/0037_fornecedores.sql', 'utf8')
const VOLTA = readFileSync('db/migrations/rls/0037_down_fornecedores.sql', 'utf8')
const PAINEL = process.argv[2]
const QUICK = '54358d88-bf7d-489b-b07b-aecfc031401d'
const USER = '00000000-0000-0000-0000-000000000000'
const cent = (v: number) => Math.round(v * 100)

/** Espera que a sentença falhe, sem derrubar a transação (savepoint). */
async function recusa(tx: Tx, f: () => Promise<unknown>): Promise<boolean> {
  try { await tx.transaction(async () => { await f() }); return false } catch { return true }
}

async function main() {
  console.log('\n6. Funções puras')
  t(mesesBase('2026-11-23', '2026-11-24').join() === '2026-08,2026-09,2026-10', 'até 23/nov (mês aberto): base = ago, set, out')
  t(mesesBase('2026-10-31', '2026-11-24').join() === '2026-08,2026-09,2026-10', 'até 31/out, já passado: out conta')
  t(mesesBase('2026-10-31', '2026-10-31').join() === '2026-07,2026-08,2026-09', 'até 31/out visto no próprio 31/out: out ainda não acabou')
  t(mesesBase('2026-02-15', '2026-03-01').join() === '2025-11,2025-12,2026-01', 'a base atravessa a virada do ano')
  t(aplicarReducao(1000, 'pct', 10).depois === 900 && aplicarReducao(1000, 'pct', 10).economiaAnual === 1200, '10% de 1.000 → 900, economia anual 1.200')
  t(aplicarReducao(1000, 'valor', 5000).depois === 0, 'redução em R$ maior que o gasto para no zero')
  t(aplicarReducao(1000, 'pct', 250).depois === 0, '% acima de 100 é aparado em 100')
  t(classeAbc(0) === 'A' && classeAbc(0.6999) === 'A' && classeAbc(0.7) === 'B' && classeAbc(0.8999) === 'B' && classeAbc(0.9) === 'C', 'cortes 70/20/10 pelo acumulado ANTES do item')

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '3s'`)
      await tx.execute(sql`SET LOCAL statement_timeout = '120s'`)
      await tx.execute(sql.raw(IDA))

      console.log('\n1. Estrutura')
      const [e] = await tx.execute<{ tabelas: number; rls: number; policies: number; unicos: number }>(sql`
        SELECT (SELECT count(*)::int FROM pg_class WHERE relname IN ('supplier_negotiations','supplier_groupings') AND relkind = 'r') AS tabelas,
               (SELECT count(*)::int FROM pg_class WHERE relname IN ('supplier_negotiations','supplier_groupings') AND relrowsecurity) AS rls,
               (SELECT count(*)::int FROM pg_policies WHERE tablename IN ('supplier_negotiations','supplier_groupings')) AS policies,
               (SELECT count(*)::int FROM pg_indexes WHERE indexname = 'supplier_negotiations_org_chave_unq') AS unicos`)
      t(e.tabelas === 2, '2 tabelas criadas')
      t(e.rls === 2, 'RLS ligado nas 2')
      t(e.policies === 8, '4 policies em cada')
      t(e.unicos === 1, 'índice único (organização, chave)')
      await tx.execute(sql.raw(IDA))
      t(true, 'a migration é idempotente (reaplicada sem erro)')

      console.log('\n2. CHECKs')
      const ins = (tipo: string, red: number) => tx.execute(sql`INSERT INTO supplier_negotiations (organization_id, chave, rotulo, tipo, reducao) VALUES (${QUICK}::uuid, 'D:teste', 'teste', ${tipo}, ${red})`)
      t(await recusa(tx, () => ins('outro', 1)), "tipo fora de 'pct'/'valor' recusado")
      t(await recusa(tx, () => ins('pct', 120)), '% acima de 100 recusado')
      t(await recusa(tx, () => ins('valor', -1)), 'redução negativa recusada')
      t(!(await recusa(tx, () => ins('valor', 150000))), 'redução em R$ acima de 100 aceita')
      await tx.execute(sql`DELETE FROM supplier_negotiations WHERE chave = 'D:teste'`)
      t(await recusa(tx, () => tx.execute(sql`INSERT INTO supplier_groupings (organization_id, nome, padrao) VALUES (${QUICK}::uuid, 'x', 'ab')`)), 'padrão com menos de 3 letras recusado')

      console.log('\n3. Agrupamentos da Quick')
      const [pai] = await tx.execute<{ id: string }>(sql`SELECT id::text AS id FROM categories WHERE organization_id = ${QUICK}::uuid AND parent_id IS NULL AND name = 'Despesas com Pessoal'`)
      const [filho] = await tx.execute<{ id: string }>(sql`SELECT id::text AS id FROM categories WHERE organization_id = ${QUICK}::uuid AND parent_id IS NOT NULL LIMIT 1`)
      const [ebury] = await tx.execute<{ id: string }>(sql`SELECT id::text AS id FROM contacts WHERE organization_id = ${QUICK}::uuid AND btrim(name) = 'EBURY CAMBIOS'`)
      const [alheia] = await tx.execute<{ id: string }>(sql`SELECT id::text AS id FROM categories WHERE organization_id <> ${QUICK}::uuid AND parent_id IS NULL LIMIT 1`)
      t(!!pai && !!ebury, 'achou "Despesas com Pessoal" e o contato EBURY CAMBIOS')
      const rFilho = await salvarAgrupamento(tx, QUICK, USER, { nome: 'x', padrao: 'teste xyz', naturezaPaiId: filho.id })
      t('error' in rFilho && /Pai/.test(rFilho.error), 'Natureza Filho como pai é recusada')
      const rAlheia = await salvarAgrupamento(tx, QUICK, USER, { nome: 'x', padrao: 'teste xyz', naturezaPaiId: alheia.id })
      t('error' in rAlheia && /não existe/.test(rAlheia.error), 'natureza de outra organização é recusada')
      const rCurto = await salvarAgrupamento(tx, QUICK, USER, { nome: 'x', padrao: '12 a' })
      t('error' in rCurto, 'padrão que normaliza para menos de 3 letras é recusado na escrita')
      const g1 = await salvarAgrupamento(tx, QUICK, USER, { nome: 'Folha de pagamento (TEDs em lote)', padrao: 'TED PAGAMENTO FORNECEDOR', naturezaPaiId: pai.id, sobrepoeContato: true })
      const g2 = await salvarAgrupamento(tx, QUICK, USER, { nome: 'Câmbio Ebury (fornecedor a definir)', padrao: 'ebury', contactId: ebury.id })
      t(!('error' in g1) && !('error' in g2), 'os dois agrupamentos gravam')

      console.log('\n4. Consolidação contra o painel de 24/nov')
      const lancs = await lerSaidasPorFornecedor(tx, QUICK, { de: '2026-01-01', ate: '2026-11-23' })
      const desp = lancs.filter((l) => l.grupo === 'Despesas')
      const total = desp.reduce((s, l) => s + l.valor, 0)
      const curva = curvaAbc(desp)
      t(cent(curva.reduce((s, r) => s + r.valor, 0)) === cent(total), 'a curva soma o total das despesas')
      t(Math.abs(curva[curva.length - 1].pctAcumulado - 1) < 1e-9, 'o acumulado termina em 100%')
      const folha = curva.find((r) => r.fornecedor.startsWith('Folha'))
      const cambio = curva.find((r) => r.fornecedor.startsWith('Câmbio'))
      t(!!folha && !!cambio, 'folha e câmbio aparecem como fornecedores')
      console.log(`        total ${total.toFixed(2)} · ${curva.length} fornecedores · classe A ${curva.filter((r) => r.classe === 'A').length}`)

      const [exc] = await tx.execute<{ n: number; v: string }>(sql`
        SELECT count(*)::int AS n, coalesce(sum(amount), 0)::text AS v FROM transactions
         WHERE organization_id = ${QUICK}::uuid AND direction = 'outflow' AND status IN ('pending', 'duplicate')
           AND date BETWEEN '2026-01-01' AND '2026-11-23'`)
      console.log(`        pendentes/duplicados excluídos: ${exc.n} lançamentos, ${exc.v}`)

      if (PAINEL && existsSync(PAINEL)) {
        const painel = JSON.parse(readFileSync(PAINEL, 'utf8')).rows as { id: string; grupo: string; fornecedor: string; valor: number }[]
        const pd = painel.filter((r) => r.grupo === 'Despesas')
        const porNome = (rows: { fornecedor: string; valor: number }[]) => {
          const m = new Map<string, number>(); for (const r of rows) m.set(r.fornecedor, (m.get(r.fornecedor) ?? 0) + r.valor); return m
        }
        // ids do painel são posição, não id do banco; compara-se pelo fornecedor
        const a = porNome(pd), b = porNome(desp)
        const nomes = new Set<string>(); a.forEach((_, k) => nomes.add(k)); b.forEach((_, k) => nomes.add(k))
        const difs: string[] = []
        nomes.forEach((k) => { if (cent(a.get(k) ?? 0) !== cent(b.get(k) ?? 0)) difs.push(`${k}: painel ${(a.get(k) ?? 0).toFixed(2)} × tela ${(b.get(k) ?? 0).toFixed(2)}`) })
        const totPainel = pd.reduce((s, r) => s + r.valor, 0)
        console.log(`        painel ${totPainel.toFixed(2)} · tela ${total.toFixed(2)} · diferença ${(totPainel - total).toFixed(2)}`)
        // A tela só pode TIRAR (pendentes/duplicados): nenhum fornecedor pode ter mais que no painel,
        // e a diferença total não passa do que foi excluído.
        let sobe = 0
        nomes.forEach((k) => { if (cent(b.get(k) ?? 0) > cent(a.get(k) ?? 0)) sobe++ })
        t(sobe === 0, 'nenhum fornecedor tem MAIS na tela que no painel')
        t(cent(totPainel - total) >= 0 && cent(totPainel - total) <= cent(Number(exc.v)), 'a diferença total não passa do que é pendente/duplicado')
        console.log(`        fornecedores com valor diferente do painel: ${difs.length}`)
        for (const d of difs.slice(0, 25)) console.log('          ' + d)
      } else {
        console.log('        (sem o arquivo do painel: comparação pulada)')
      }

      console.log('\n5. Mesa')
      const chave = curva[2].chave, rotulo = curva[2].fornecedor
      const m1 = await salvarItemMesa(tx, QUICK, USER, { chave, rotulo, tipo: 'pct', reducao: 5, nota: '' })
      const m2 = await salvarItemMesa(tx, QUICK, USER, { chave, rotulo, tipo: 'valor', reducao: 1000, nota: 'pedir proposta' })
      const mesa = await lerMesa(tx, QUICK)
      t(!('error' in m1) && !('error' in m2) && mesa.length === 1, 'levar e atualizar o mesmo fornecedor deixa UMA linha')
      t(mesa[0]?.tipo === 'valor' && mesa[0]?.reducao === 1000 && mesa[0]?.nota === 'pedir proposta', 'a atualização vale')
      const m3 = await salvarItemMesa(tx, QUICK, USER, { chave, rotulo, tipo: 'pct', reducao: 120, nota: '' })
      t('error' in m3, '% acima de 100 recusado na escrita')
      const t1 = await tirarDaMesa(tx, QUICK, USER, chave)
      const t2 = await tirarDaMesa(tx, QUICK, USER, chave)
      t(!('error' in t1) && 'error' in t2, 'tirar funciona; tirar de novo é recusado com motivo')
      const outra = await tirarDaMesa(tx, '00000000-0000-0000-0000-000000000001', USER, chave)
      t('error' in outra, 'outra organização não alcança a mesa da Quick')
      const [ev] = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM agent_events WHERE organization_id = ${QUICK}::uuid AND type LIKE 'fornecedores.%' AND created_at >= now() - interval '5 minutes'`)
      t(ev.n === 5, `agent_events: 2 agrupamentos + 2 alterações + 1 retirada = 5 (achou ${ev.n})`)

      console.log('\n7. A volta')
      await tx.execute(sql.raw(VOLTA))
      const [v] = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('supplier_negotiations','supplier_groupings')`)
      t(v.n === 0, 'as duas tabelas saem')
      throw new Reverter()
    })
  } catch (e) {
    if (!(e instanceof Reverter)) { console.error(e); falhas++ }
  }
  const [depois] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('supplier_negotiations','supplier_groupings')`)
  t(depois.n === 0, 'nada persistiu (ROLLBACK)')

  console.log(`\n${ok} ok, ${falhas} falha(s)`)
  process.exit(falhas ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
