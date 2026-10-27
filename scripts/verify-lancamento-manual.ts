/**
 * Lançamento manual — `lib/lancamento-manual.ts` (Decisão 30).
 *
 *   npx tsx --env-file=.env.local scripts/verify-lancamento-manual.ts
 *
 * Tudo numa transação que termina em ROLLBACK — roda contra a produção sem
 * deixar rastro. Com `lock_timeout` curto: nunca esperar trava de ninguém.
 *
 * O que precisa ser provado:
 * 1. O navegador e o sistema saem legíveis do User-Agent (Edge e Opera se dizem
 *    Chrome; o Chrome se diz Safari).
 * 2. Criar: só em conta manual; a origem e a autoria ficam no metadata, carimbadas;
 *    a conta vem do cadastro; o evento `criado` é registrado.
 * 3. Recusas: conta do Pluggy, valor negativo, natureza pai, natureza de outra empresa.
 * 4. O lançamento entra no saldo da conferência e no filtro de origem.
 * 5. Apagar guarda o retrato SÓ dos manuais; restaurar devolve o MESMO lançamento,
 *    com as partes do rateio; restaurar duas vezes é recusado; outra empresa não restaura.
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import {
  descreverUserAgent, criarLancamentoManual, registrarApagamentoDeManuais,
  listarManuaisApagados, restaurarLancamentoManual, ehManual, type Autoria,
} from '@/lib/lancamento-manual'
import { descreverAutoria } from '@/lib/lancamento-manual-types'
import { lerExtratoDaConta, gravarSaldoInicial } from '@/lib/account-ledger'

let ok = 0, falhas = 0
const t = (c: boolean, l: string) => { if (c) { ok++; console.log(`  OK    ${l}`) } else { falhas++; console.log(`  FALHA ${l}`) } }
class Reverter extends Error {}

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.92 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
}

async function main() {
  console.log('\n── 1. User-Agent ──')
  const d = (ua: string) => { const r = descreverUserAgent(ua); return `${r.navegador} · ${r.sistema}` }
  t(d(UA.chromeWin) === 'Chrome 130 · Windows', `Chrome no Windows → ${d(UA.chromeWin)}`)
  t(d(UA.edge) === 'Edge 130 · Windows', `Edge (que se diz Chrome) → ${d(UA.edge)}`)
  t(d(UA.iphone) === 'Safari 17 · iOS', `Safari no iPhone → ${d(UA.iphone)}`)
  t(d(UA.firefoxLinux) === 'Firefox 131 · Linux', `Firefox no Linux → ${d(UA.firefoxLinux)}`)
  t(d(UA.android) === 'Chrome 130 · Android', `Chrome no Android (que diz Linux) → ${d(UA.android)}`)
  t(descreverUserAgent(null).navegador === null, 'sem User-Agent: nulo, não inventado')

  // Uma conta manual de saldo e uma conta do Pluggy, de verdade — leitura só.
  const [manual] = await db.execute<{ org: string; conta: string; nome: string; tipo: string }>(sql`
    SELECT organization_id::text AS org, metadata->>'accountId' AS conta, name AS nome,
           metadata->'accounts'->0->>'subtype' AS tipo
      FROM data_sources WHERE provider = 'manual' AND metadata->'accounts'->0->>'subtype' <> 'CREDIT_CARD' LIMIT 1`)
  const [pluggy] = await db.execute<{ org: string; conta: string }>(sql`
    SELECT t.organization_id::text AS org, t.account_id AS conta FROM transactions t
      JOIN data_sources ds ON ds.id = t.data_source_id WHERE ds.provider = 'pluggy' LIMIT 1`)
  const [outra] = await db.execute<{ id: string }>(sql`SELECT id::text FROM organizations WHERE id <> ${manual.org}::uuid LIMIT 1`)
  const [pai] = await db.execute<{ id: string }>(sql`
    SELECT c.id::text FROM categories c WHERE c.organization_id = ${manual.org}::uuid
       AND EXISTS (SELECT 1 FROM categories f WHERE f.parent_id = c.id) LIMIT 1`)
  const [folha] = await db.execute<{ id: string }>(sql`
    SELECT c.id::text FROM categories c WHERE c.organization_id = ${manual.org}::uuid AND c.is_active
       AND NOT EXISTS (SELECT 1 FROM categories f WHERE f.parent_id = c.id) LIMIT 1`)
  const [deOutra] = await db.execute<{ id: string }>(sql`
    SELECT id::text FROM categories WHERE organization_id <> ${manual.org}::uuid LIMIT 1`)
  console.log(`\nconta manual: ${manual.nome} (${manual.conta})`)

  const autoria: Autoria = {
    userId: '00000000-0000-0000-0000-0000000000aa', email: 'teste@lure.expert',
    userAgent: UA.chromeWin, ip: '200.1.2.3', dispositivoId: 'a3f2c9d1',
  }
  const base = { data: '2026-10-15', valor: 123.45, sentido: 'outflow' as const, descricao: 'TESTE tarifa manual' }

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '3s'`)
      await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '60s'`)

      console.log('\n── 2. criar ──')
      const r = await criarLancamentoManual(manual.org, manual.conta, { ...base, categoryId: folha.id }, autoria, tx)
      t('ok' in r, 'cria na conta manual')
      if (!('ok' in r)) throw new Error(r.error)
      const [linha] = await tx.execute<{
        external_id: string; account_id: string; account_name: string; account_type: string
        metadata: Record<string, unknown>; status: string; effective_date: string | null; category_id: string
      }>(sql`SELECT external_id, account_id, account_name, account_type, metadata, status, effective_date::text, category_id::text
               FROM transactions WHERE id = ${r.id}::uuid`)
      t(linha.external_id.startsWith('man:'), `chave própria (${linha.external_id.slice(0, 12)}…), fora da dedup de arquivo`)
      t(linha.account_id === manual.conta && linha.account_name === manual.nome && linha.account_type === manual.tipo,
        'a conta vem do cadastro (nome e tipo)')
      t(ehManual(linha.metadata), 'metadata.origem = manual')
      const m = linha.metadata as { lancadoPor: { email: string }; lancadoEm: string; dispositivo: Record<string, string> }
      t(m.lancadoPor.email === 'teste@lure.expert' && Math.abs(Date.parse(m.lancadoEm) - Date.now()) < 120_000,
        'quem e quando, carimbados pelo servidor')
      t(m.dispositivo.navegador === 'Chrome 130' && m.dispositivo.sistema === 'Windows'
        && m.dispositivo.ip === '200.1.2.3' && m.dispositivo.id === 'a3f2c9d1', 'navegador, sistema, IP e identificador')
      t(linha.effective_date === null && linha.status === 'confirmed' && linha.category_id === folha.id,
        'caixa vazia = competência; confirmado; com a natureza escolhida')
      const frase = descreverAutoria(linha.metadata as never)
      t(frase.includes('teste@lure.expert') && frase.includes('Chrome 130 no Windows') && frase.includes('#a3f2c9d1'),
        `selo: "${frase}"`)
      const [ev] = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM agent_events
        WHERE type = 'lancamento_manual.criado' AND entity_id = ${r.id}::uuid`)
      t(ev.n === 1, 'evento lancamento_manual.criado registrado')
      const comCaixa = await criarLancamentoManual(manual.org, manual.conta, { ...base, dataCaixa: '2026-10-20' }, autoria, tx)
      const [cx] = 'ok' in comCaixa
        ? await tx.execute<{ e: string }>(sql`SELECT effective_date::text AS e FROM transactions WHERE id = ${comCaixa.id}::uuid`)
        : [{ e: '' }]
      t(cx.e === '2026-10-20', 'data de caixa diferente é gravada')

      console.log('\n── 3. recusas ──')
      const naoManual = pluggy ? await criarLancamentoManual(pluggy.org, pluggy.conta, base, autoria, tx) : { error: 'sem pluggy' }
      t('error' in naoManual && /conta manual/.test(naoManual.error), 'conta do Pluggy: recusada')
      const neg = await criarLancamentoManual(manual.org, manual.conta, { ...base, valor: -5 }, autoria, tx)
      t('error' in neg, 'valor negativo: recusado (o sentido diz se sai)')
      const naturezaPai = pai ? await criarLancamentoManual(manual.org, manual.conta, { ...base, categoryId: pai.id }, autoria, tx) : { error: 'x' }
      t('error' in naturezaPai, 'natureza pai: recusada')
      const alheia = await criarLancamentoManual(manual.org, manual.conta, { ...base, categoryId: deOutra.id }, autoria, tx)
      t('error' in alheia, 'natureza de outra empresa: recusada')
      const vazia = await criarLancamentoManual(manual.org, manual.conta, { ...base, descricao: '   ' }, autoria, tx)
      t('error' in vazia, 'descrição vazia: recusada')

      console.log('\n── 4. conferência e filtro ──')
      await gravarSaldoInicial(manual.org, manual.conta, { data: '2026-01-01', valor: 1000 }, null, tx)
      const ext = await lerExtratoDaConta(manual.org, manual.conta, { pageSize: 1000 }, tx)
      const minha = ext.rows.find(x => x.id === r.id)
      t(!!minha && minha.saldo != null, 'o manual aparece na conferência, com saldo')
      const so = await lerExtratoDaConta(manual.org, manual.conta, { origem: 'manual', pageSize: 1000 }, tx)
      t(so.total === 2 && so.rows.every(x => ehManual(x.metadata)), 'filtro "manual": só os 2 lançados à mão')
      const imp = await lerExtratoDaConta(manual.org, manual.conta, { origem: 'importado', pageSize: 1000 }, tx)
      t(imp.total === ext.total - 2 && !imp.rows.some(x => ehManual(x.metadata)), 'filtro "importado": todo o resto')
      t(so.rows.every(x => ext.rows.find(y => y.id === x.id)?.saldo === x.saldo), 'o filtro de origem não muda o saldo')

      console.log('\n── 5. apagar e restaurar ──')
      // Rateio em duas partes, para provar que as partes voltam.
      await tx.execute(sql`
        INSERT INTO transaction_allocations (organization_id, transaction_id, sequence, amount, category_id)
        VALUES (${manual.org}::uuid, ${r.id}::uuid, 1, 100.00, ${folha.id}::uuid),
               (${manual.org}::uuid, ${r.id}::uuid, 2, 23.45, ${folha.id}::uuid)`)
      await tx.execute(sql`UPDATE transactions SET category_id = NULL WHERE id = ${r.id}::uuid`)
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
      await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`)
      const [antes] = await tx.execute<{ j: Record<string, unknown> }>(sql`
        SELECT to_jsonb(t) - 'embedding' - 'updated_at' - 'metadata' AS j FROM transactions t WHERE id = ${r.id}::uuid`)
      const [importado] = await tx.execute<{ id: string }>(sql`
        SELECT id::text FROM transactions WHERE account_id = ${manual.conta} AND organization_id = ${manual.org}::uuid
           AND metadata->>'origem' IS DISTINCT FROM 'manual' LIMIT 1`)
      const ids = [r.id, ...(importado ? [importado.id] : [])]
      const n = await registrarApagamentoDeManuais(manual.org, ids, { userId: autoria.userId, email: 'apagou@lure.expert' }, tx)
      t(n === 1, `apagar ${ids.length}: guarda o retrato só do manual (${n})`)
      await tx.execute(sql`DELETE FROM transactions WHERE id IN (${sql.join(ids.map(i => sql`${i}::uuid`), sql`, `)})`)
      const apagados = await listarManuaisApagados(manual.org, manual.conta, tx)
      const meu = apagados.find(a => a.descricao === base.descricao && a.valor === base.valor && a.apagadoPor === 'apagou@lure.expert')
      t(!!meu && meu.lancadoPor === 'teste@lure.expert', 'aparece em "Apagados", com quem lançou e quem apagou')

      const alheio = await restaurarLancamentoManual(outra.id, meu!.eventoId, { userId: autoria.userId, email: null }, tx as never)
      t('error' in alheio, 'outra empresa não restaura')
      const volta = await restaurarLancamentoManual(manual.org, meu!.eventoId, { userId: autoria.userId, email: 'restaurou@lure.expert' }, tx as never)
      t('ok' in volta && volta.id === r.id, 'restaura com o MESMO id')
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
      t(true, 'as partes restauradas fecham a soma (o gatilho do rateio aceitou)')
      await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`)
      const [depois] = await tx.execute<{ j: Record<string, unknown>; meta: Record<string, unknown> }>(sql`
        SELECT to_jsonb(t) - 'embedding' - 'updated_at' - 'metadata' AS j, metadata AS meta FROM transactions t WHERE id = ${r.id}::uuid`)
      t(JSON.stringify(depois.j) === JSON.stringify(antes.j), 'todas as colunas voltam idênticas (datas, valor, conta, dimensões)')
      const meta = depois.meta as { restauradoEm?: string; restauradoPor?: { email: string }; lancadoPor: { email: string } }
      t(!!meta.restauradoEm && meta.restauradoPor?.email === 'restaurou@lure.expert' && meta.lancadoPor.email === 'teste@lure.expert',
        'a autoria original fica, e ganha quem restaurou')
      const [partes] = await tx.execute<{ n: number; s: string }>(sql`
        SELECT COUNT(*)::int AS n, SUM(amount)::text AS s FROM transaction_allocations WHERE transaction_id = ${r.id}::uuid`)
      t(partes.n === 2 && Number(partes.s) === 123.45, 'as 2 partes do rateio voltam')
      const deNovo = await restaurarLancamentoManual(manual.org, meu!.eventoId, { userId: autoria.userId, email: null }, tx as never)
      t('error' in deNovo, 'restaurar duas vezes: recusado')
      t(!(await listarManuaisApagados(manual.org, manual.conta, tx)).some(a => a.eventoId === meu!.eventoId),
        'restaurado sai de "Apagados"')

      throw new Reverter()
    })
  } catch (e) {
    if (!(e instanceof Reverter)) throw e
  }

  const [{ n: sobra }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM transactions WHERE description = ${base.descricao}`)
  t(sobra === 0, 'ROLLBACK: nada persistiu')
  console.log(`\n${ok} ok, ${falhas} falha(s)\n`)
  process.exit(falhas ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
