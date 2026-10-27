/**
 * Conferência de saldo — a migration 0034 e `lib/account-ledger.ts`.
 *
 *   npx tsx --env-file=.env.local scripts/verify-conferencia-saldo.ts
 *
 * Tudo numa transação que termina em ROLLBACK: a 0034 é aplicada DENTRO dela, o
 * saldo inicial é gravado dentro dela, e nada persiste. Por isso pode rodar
 * contra a produção antes de a migration subir.
 *
 * O que precisa ser provado:
 * 1. Estrutura: tabela, unicidade por conta, RLS com 4 policies, gatilho.
 * 2. O fechamento de cada dia = saldo inicial + movimentos desde a âncora até
 *    aquele dia, calculado em JS a partir de uma leitura crua.
 * 3. O saldo corrido anda exatamente pelo movimento de cada linha, e o da
 *    última linha do dia é o fechamento.
 * 4. Trocar a ordem do dia muda o saldo corrido e NÃO muda o fechamento.
 * 5. Filtro esconde linhas e não muda o saldo de nenhuma.
 * 6. Paginação: as páginas juntas são o extrato inteiro, sem repetir.
 * 7. Antes da âncora não há saldo; sem âncora não há saldo nenhum.
 * 8. Isolamento: outra organização não lê o extrato nem a âncora (inclusive por RLS).
 * 9. `/transacoes` filtra igual a antes (o filtro mudou de casa).
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import {
  gravarSaldoInicial, lerSaldoInicial, lerExtratoDaConta, descreverConta, apagarSaldoInicial,
  type ExtratoParams,
} from '@/lib/account-ledger'

let ok = 0, falhas = 0
const t = (c: boolean, l: string) => { if (c) { ok++; console.log(`  OK    ${l}`) } else { falhas++; console.log(`  FALHA ${l}`) } }
class Reverter extends Error {}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const MIGRATION = readFileSync('db/migrations/rls/0034_account_opening_balances.sql', 'utf8')
const cent = (v: number | string | null) => v == null ? null : Math.round(Number(v) * 100)

type Linha = Awaited<ReturnType<typeof lerExtratoDaConta>>['rows'][number]

async function extratoInteiro(tx: Tx, org: string, conta: string, p: ExtratoParams = {}) {
  const todas: Linha[] = []
  for (let page = 1; ; page++) {
    const r = await lerExtratoDaConta(org, conta, { ...p, page, pageSize: 1000 }, tx)
    todas.push(...r.rows)
    if (page >= r.pages) return { linhas: todas, ultimo: r }
  }
}

async function main() {
  // A conta com mais lançamentos que não seja cartão — leitura só.
  const [alvo] = await db.execute<{ org: string; conta: string; n: number; nome: string | null }>(sql`
    SELECT organization_id::text AS org, account_id AS conta, COUNT(*)::int AS n,
           MAX(account_name) AS nome
      FROM transactions
     WHERE account_id IS NOT NULL AND status <> 'pending'
       AND COALESCE(account_type, '') <> 'CREDIT_CARD'
     GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 1
  `)
  const [outra] = await db.execute<{ id: string }>(sql`
    SELECT id::text FROM organizations WHERE id <> ${alvo.org}::uuid LIMIT 1
  `)
  console.log(`\nconta: ${alvo.nome} (${alvo.conta}) — ${alvo.n} lançamentos\n`)

  try {
    await db.transaction(async (tx) => {
      // Roda contra a PRODUÇÃO: nunca esperar trava nem segurar uma por muito tempo.
      // Em 27/out uma execução reaplicou a 0034 sobre a tabela em uso, pegou trava
      // EXCLUSIVA e, quando o processo morreu, a sessão ficou órfã no pooler
      // segurando-a — e a conferência de saldo travou para todo mundo.
      await tx.execute(sql`SET LOCAL lock_timeout = '3s'`)
      await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '60s'`)
      console.log('── 1. estrutura ──')
      // Antes da 0034 subir, ela era aplicada aqui (duas vezes, para provar a
      // idempotência). Aplicada, NÃO se reaplica: o DROP POLICY/TRIGGER pede trava
      // exclusiva numa tabela em uso e estoura o statement timeout.
      const [{ ja }] = await tx.execute<{ ja: boolean }>(sql`SELECT to_regclass('account_opening_balances') IS NOT NULL AS ja`)
      if (!ja) {
        await tx.execute(sql.raw(MIGRATION))
        await tx.execute(sql.raw(MIGRATION)) // idempotente
      }
      t(true, ja ? 'a 0034 já está aplicada' : 'a 0034 aplica duas vezes sem erro')
      const [est] = await tx.execute<{ rls: boolean; pol: number; trg: number; unq: number }>(sql`
        SELECT (SELECT relrowsecurity FROM pg_class WHERE relname = 'account_opening_balances') AS rls,
               (SELECT COUNT(*)::int FROM pg_policies WHERE tablename = 'account_opening_balances') AS pol,
               (SELECT COUNT(*)::int FROM pg_trigger WHERE tgname = 'trg_account_opening_balances_updated_at') AS trg,
               (SELECT COUNT(*)::int FROM pg_constraint WHERE conname = 'account_opening_balances_unq') AS unq
      `)
      t(est.rls && est.pol === 4, `RLS ligada com 4 policies (${est.pol})`)
      t(est.trg === 1 && est.unq === 1, 'gatilho updated_at e unicidade por conta')

      // A leitura crua, independente do módulo: o que o saldo DEVE ser.
      const crus = await tx.execute<{ id: string; caixa: string; mov: string }>(sql`
        SELECT id::text, COALESCE(effective_date, date)::text AS caixa,
               (CASE WHEN direction = 'inflow' THEN amount ELSE -amount END)::text AS mov
          FROM transactions
         WHERE organization_id = ${alvo.org}::uuid AND account_id = ${alvo.conta} AND status <> 'pending'
      `)
      const datas = Array.from(new Set(crus.map(c => c.caixa))).sort()
      const ancoraData = datas[Math.min(5, datas.length - 1)]
      const ancoraValor = 12345.67

      // A tabela já tem saldos reais: um saldo que alguém tenha informado nesta
      // conta é tirado DENTRO da transação (volta no ROLLBACK).
      await apagarSaldoInicial(alvo.org, alvo.conta, tx)
      console.log('\n── 7a. sem âncora ──')
      const sem = await extratoInteiro(tx, alvo.org, alvo.conta)
      t(sem.linhas.length === alvo.n, `lê os ${alvo.n} lançamentos`)
      t(sem.linhas.every(l => l.saldo == null && l.fechamentoDoDia == null), 'sem saldo inicial, nenhuma linha tem saldo')
      t(sem.ultimo.resumo.saldoFinal == null, 'e o resumo não afirma saldo final')

      console.log('\n── 2/3. com âncora ──')
      const g = await gravarSaldoInicial(alvo.org, alvo.conta, { data: ancoraData, valor: ancoraValor, nota: 'teste' }, null, tx)
      t('ok' in g, `grava o saldo inicial (${ancoraData}, ${ancoraValor})`)
      const g2 = await gravarSaldoInicial(alvo.org, alvo.conta, { data: ancoraData, valor: ancoraValor, nota: 'teste' }, null, tx)
      const [{ n: nAncoras }] = await tx.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM account_opening_balances WHERE organization_id = ${alvo.org}::uuid AND account_id = ${alvo.conta}`)
      t('ok' in g2 && nAncoras === 1, 'gravar de novo substitui (uma âncora por conta)')
      const recusa = await gravarSaldoInicial(alvo.org, alvo.conta, { data: '27/10/2026', valor: 1 }, null, tx)
      t('error' in recusa, 'data fora do formato é recusada')

      const esperado = new Map<string, number>() // fechamento por dia, em centavos
      let acc = Math.round(ancoraValor * 100)
      const porDia = new Map<string, number>()
      for (const c of crus) if (c.caixa >= ancoraData) porDia.set(c.caixa, (porDia.get(c.caixa) ?? 0) + cent(c.mov)!)
      for (const d of datas) if (d >= ancoraData) { acc += porDia.get(d) ?? 0; esperado.set(d, acc) }

      const base = await extratoInteiro(tx, alvo.org, alvo.conta)
      const L = base.linhas
      t(L.every(l => l.dataCaixa < ancoraData ? l.fechamentoDoDia == null : cent(l.fechamentoDoDia) === esperado.get(l.dataCaixa)),
        `fechamento de cada dia = saldo inicial + movimento até o dia (${esperado.size} dias)`)
      t(L.every((l, i) => i === 0 || L[i - 1].dataCaixa <= l.dataCaixa), 'ordem cronológica pela data de caixa')
      const movDe = new Map(crus.map(c => [c.id, cent(c.mov)!]))
      let anda = true
      for (let i = 1; i < L.length; i++) {
        if (L[i].saldo == null) continue
        const anterior = L[i - 1].saldo == null ? Math.round(ancoraValor * 100) : cent(L[i - 1].saldo)!
        if (cent(L[i].saldo) !== anterior + movDe.get(L[i].id)!) anda = false
      }
      t(anda, 'o saldo corrido anda exatamente pelo movimento de cada linha')
      t(L.filter(l => l.ultimaDoDia && l.saldo != null).every(l => cent(l.saldo) === cent(l.fechamentoDoDia)),
        'na última linha do dia, saldo corrido = fechamento')
      const antes = L.filter(l => l.dataCaixa < ancoraData)
      t(antes.length > 0 && antes.every(l => l.saldo == null), `antes da âncora, sem saldo (${antes.length} linhas)`)
      t(base.ultimo.resumo.antesDoSaldoInicial === antes.length, 'o resumo conta as linhas antes da âncora')
      t(cent(base.ultimo.resumo.saldoFinal) === Array.from(esperado.values()).pop(),
        `saldo final do resumo = último fechamento (${base.ultimo.resumo.saldoFinal})`)

      console.log('\n── 4. ordem do dia ──')
      const fechamentoPorId = new Map(L.map(l => [l.id, cent(l.fechamentoDoDia)]))
      for (const sort of ['amount_desc', 'desc_asc', 'category_asc', 'direction_desc']) {
        const o = (await extratoInteiro(tx, alvo.org, alvo.conta, { sort })).linhas
        const mesmoConjunto = o.length === L.length
        const fechamentoIgual = o.every(l => cent(l.fechamentoDoDia) === fechamentoPorId.get(l.id))
        const ultimaFecha = o.filter(l => l.ultimaDoDia && l.saldo != null).every(l => cent(l.saldo) === cent(l.fechamentoDoDia))
        const cronologico = o.every((l, i) => i === 0 || o[i - 1].dataCaixa <= l.dataCaixa)
        t(mesmoConjunto && fechamentoIgual && ultimaFecha && cronologico,
          `${sort}: data segue primeiro, fechamento idêntico, última linha fecha`)
      }
      const vd = (await extratoInteiro(tx, alvo.org, alvo.conta, { sort: 'amount_desc' })).linhas
      const diaCheio = vd.find((l, i) => i > 0 && vd[i - 1].dataCaixa === l.dataCaixa && cent(vd[i - 1].amount) !== cent(l.amount))
      if (diaCheio) {
        const dia = vd.filter(l => l.dataCaixa === diaCheio.dataCaixa)
        t(dia.every((l, i) => i === 0 || Number(dia[i - 1].amount) >= Number(l.amount)), `dentro do dia ${diaCheio.dataCaixa}, ordenado por valor`)
      }
      const inv = (await extratoInteiro(tx, alvo.org, alvo.conta, { sort: 'date_desc' })).linhas
      t(inv.map(l => l.id).join() === L.map(l => l.id).reverse().join(), 'date_desc é o espelho exato')

      console.log('\n── 5. filtros ──')
      const saldoPorId = new Map(L.map(l => [l.id, cent(l.saldo)]))
      for (const [nome, f] of [
        ['só entradas', { direction: 'inflow' }],
        ['só saídas', { direction: 'outflow' }],
        ['sem natureza', { category: '__none__' }],
        ['valor ≥ 1000', { amountMin: '1000' }],
      ] as const) {
        const r = await extratoInteiro(tx, alvo.org, alvo.conta, f)
        const intactos = r.linhas.every(l => cent(l.saldo) === saldoPorId.get(l.id) && cent(l.fechamentoDoDia) === fechamentoPorId.get(l.id))
        t(r.linhas.length <= L.length && intactos, `${nome}: ${r.linhas.length} linhas, saldos idênticos aos sem filtro`)
        const ultimas = r.linhas.filter((l, i) => r.linhas[i + 1]?.dataCaixa !== l.dataCaixa)
        t(r.linhas.filter(l => l.ultimaDoDia).length === ultimas.length && ultimas.every(l => l.ultimaDoDia),
          `${nome}: "última do dia" marca a última VISÍVEL`)
        t(r.ultimo.resumo.saldoFinal === base.ultimo.resumo.saldoFinal, `${nome}: o resumo não muda`)
      }
      const periodo = await extratoInteiro(tx, alvo.org, alvo.conta, { from: datas[0], to: ancoraData })
      t(periodo.linhas.every(l => l.dataCaixa >= datas[0] && l.dataCaixa <= ancoraData), 'período filtra pela data de CAIXA')

      console.log('\n── 6. paginação ──')
      const p1 = await lerExtratoDaConta(alvo.org, alvo.conta, { page: 1, pageSize: 100 }, tx)
      const p2 = await lerExtratoDaConta(alvo.org, alvo.conta, { page: 2, pageSize: 100 }, tx)
      t(p1.rows.map(r => r.id).join() === L.slice(0, 100).map(r => r.id).join() &&
        p2.rows.map(r => r.id).join() === L.slice(100, 200).map(r => r.id).join(),
        'páginas de 100 = fatias do extrato inteiro, na ordem')
      t(p2.rows.every(r => cent(r.saldo) === saldoPorId.get(r.id)), 'a página 2 chega com o saldo certo')
      t(new Set(L.map(l => l.id)).size === L.length, 'nenhum lançamento repetido entre páginas')

      console.log('\n── 8. isolamento ──')
      const alheio = await lerExtratoDaConta(outra.id, alvo.conta, {}, tx)
      t(alheio.total === 0 && alheio.resumo.saldoInicial == null, 'outra organização: 0 linhas e nenhuma âncora')
      t((await descreverConta(outra.id, alvo.conta, tx)) == null, 'outra organização: a conta não existe')
      t((await descreverConta(alvo.org, alvo.conta, tx))?.nome != null, 'a própria organização: a conta tem nome')
      await tx.execute(sql`SAVEPOINT rls`)
      await tx.execute(sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated' })}, true)`)
      await tx.execute(sql`SET LOCAL ROLE authenticated`)
      const [{ n: visiveis }] = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM account_opening_balances`)
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rls`)
      t(visiveis === 0, 'RLS: usuário sem membership não enxerga a âncora')
      // O outro lado — sem ele, o zero acima passaria também com uma policy que recusa todo mundo.
      const [membro] = await tx.execute<{ u: string }>(sql`
        SELECT user_id::text AS u FROM memberships WHERE organization_id = ${alvo.org}::uuid AND accepted_at IS NOT NULL LIMIT 1`)
      await tx.execute(sql`SAVEPOINT rls2`)
      await tx.execute(sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: membro.u, role: 'authenticated' })}, true)`)
      await tx.execute(sql`SET LOCAL ROLE authenticated`)
      const [{ n: doMembro }] = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM account_opening_balances WHERE account_id = ${alvo.conta} AND note = 'teste'`)
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rls2`)
      t(doMembro === 1, 'RLS: um membro da organização enxerga a âncora de teste (a tabela já tem saldos reais)')

      await apagarSaldoInicial(alvo.org, alvo.conta, tx)
      t((await lerSaldoInicial(alvo.org, alvo.conta, tx)) == null, 'apagar remove a âncora')

      console.log('\n── 9. /transacoes ──')
      // O filtro mudou de casa: a mesma pergunta pelo SQL antigo, escrito à mão.
      const { condicoesDaListagem } = await import('@/lib/transactions-list-filters')
      const { transactions } = await import('@/db/schema')
      const { and, eq, count } = await import('drizzle-orm')
      for (const [nome, f, crua] of [
        ['período (competência)', { from: datas[0], to: ancoraData }, sql`date BETWEEN ${datas[0]}::date AND ${ancoraData}::date`],
        ['descrição contém "pix"', { q: 'pix' }, sql`description ILIKE '%pix%'`],
        ['saídas ≥ 500', { direction: 'outflow', amountMin: '500' }, sql`direction = 'outflow' AND amount >= 500`],
      ] as const) {
        const [{ n: novo }] = await tx.select({ n: count() }).from(transactions)
          .where(and(eq(transactions.organizationId, alvo.org), ...condicoesDaListagem(f)))
        const [{ n: velho }] = await tx.execute<{ n: number }>(sql`
          SELECT COUNT(*)::int AS n FROM transactions WHERE organization_id = ${alvo.org}::uuid AND ${crua}`)
        t(Number(novo) === Number(velho), `${nome}: ${novo} = ${velho}`)
      }

      console.log('\n── 10. pré-pago e implantação de saldo (27/out, sessão 2) ──')
      const { lerTipoDeConta, temSaldoCorrido, ROTULO_DE_CONTA } = await import('@/lib/import-contract')
      t(['Cartão pré-pago', 'cartao pre pago', 'Pré-pago', 'PREPAID_CARD'].every(x => lerTipoDeConta(x) === 'PREPAID_CARD'),
        'planilha: "Cartão pré-pago", "pre pago", "Pré-pago" viram PREPAID_CARD')
      t(['Cartão', 'cartão de crédito', ROTULO_DE_CONTA.CREDIT_CARD].every(x => lerTipoDeConta(x) === 'CREDIT_CARD'),
        '"Cartão" sozinho continua sendo crédito (as planilhas já escritas)')
      t(temSaldoCorrido('PREPAID_CARD') && temSaldoCorrido('OTHER') && !temSaldoCorrido('CREDIT_CARD'),
        'pré-pago tem saldo corrido; crédito não')
      const [pp] = await tx.execute<{ org: string; conta: string; data: string }>(sql`
        SELECT organization_id::text AS org, account_id AS conta, MIN(COALESCE(effective_date, date))::text AS data
          FROM transactions WHERE upper(description) LIKE '%IMPLANTA%SALDO%' AND account_id IS NOT NULL
         GROUP BY 1, 2 LIMIT 1`)
      if (pp) {
        await gravarSaldoInicial(pp.org, pp.conta, { data: pp.data, valor: 0 }, null, tx)
        const noDia = await lerExtratoDaConta(pp.org, pp.conta, {}, tx)
        t(noDia.resumo.saldosDuplicados.length >= 1, `âncora no dia da implantação (${pp.data}): avisa da duplicidade`)
        const seguinte = new Date(`${pp.data}T12:00:00Z`); seguinte.setUTCDate(seguinte.getUTCDate() + 1)
        await gravarSaldoInicial(pp.org, pp.conta, { data: seguinte.toISOString().slice(0, 10), valor: 0 }, null, tx)
        const depois = await lerExtratoDaConta(pp.org, pp.conta, {}, tx)
        t(depois.resumo.saldosDuplicados.length === 0, 'âncora no dia seguinte: sem aviso')
      } else {
        t(false, 'não achei lançamento de implantação de saldo para testar')
      }

      throw new Reverter()
    })
  } catch (e) {
    if (!(e instanceof Reverter)) throw e
  }

  // Antes da 0034 a prova era "a tabela não existe"; depois dela, que o saldo
  // inicial de teste não ficou gravado.
  const [{ existe }] = await db.execute<{ existe: boolean }>(sql`SELECT to_regclass('account_opening_balances') IS NOT NULL AS existe`)
  const sobra = existe
    ? (await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM account_opening_balances
        WHERE organization_id = ${alvo.org}::uuid AND account_id = ${alvo.conta} AND note = 'teste'`))[0].n
    : 0
  t(sobra === 0, 'ROLLBACK: nada persistiu')
  console.log(`\n${ok} ok, ${falhas} falha(s)\n`)
  process.exit(falhas ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
