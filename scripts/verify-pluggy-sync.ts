/**
 * Verificação de 03/nov: os 4 defeitos do relatório Pluggy de 01/11.
 *
 * Três blocos: (1) as funções puras; (2) a gravação e a substituição de
 * pendentes contra o banco, numa organização descartável; (3) a migration de
 * dados 0035 contra a base REAL, medindo antes e depois. Os blocos 2 e 3 rodam
 * numa transação só, que termina em ROLLBACK — nada persiste, e a última
 * asserção confere isso fora da transação.
 *
 * Rodar com o pooler:
 *   DATABASE_URL="postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:6543/postgres" \
 *     npx tsx --env-file=.env.local scripts/verify-pluggy-sync.ts
 */

import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  dataEmBrasilia, somarDias, inicioDaReleitura, webhookAutorizado,
  gravarLancamentosPluggy, marcarPendentesQueSumiram, pendenteMaisAntiga, type LinhaPluggy,
} from '@/lib/pluggy-sync'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { if (bom) ok++; else falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }
const ROLLBACK = '__ROLLBACK__'
const SLUG = `verify-pluggy-sync-${Date.now()}`

// Conta das 530 / 35 medidas em 03/nov — recalculadas aqui, não fixas.
const SQL_DATA_UTC = sql`
  SELECT COUNT(*)::int n FROM transactions t JOIN data_sources ds ON ds.id = t.data_source_id
   WHERE ds.provider = 'pluggy' AND t.raw_data ? 'date' AND t.invoice_id IS NULL
     AND t.date = ((t.raw_data->>'date')::timestamptz AT TIME ZONE 'UTC')::date
     AND t.date <> ((t.raw_data->>'date')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date`
const SQL_NA_FILA = sql`
  SELECT COUNT(*)::int n FROM transactions WHERE metadata->>'reconciliationKind' = 'pendente'
     AND metadata->>'reconciliationPending' = 'true' AND status NOT IN ('duplicate','ignored')`

function puras() {
  console.log('\n— funções puras')
  t(dataEmBrasilia('2026-10-10T02:59:59.000Z') === '2026-10-09', '02:59:59Z cai no dia anterior em Brasília')
  t(dataEmBrasilia('2026-10-10T03:00:00.000Z') === '2026-10-10', '03:00Z é meia-noite em Brasília: mesmo dia')
  t(dataEmBrasilia('2026-01-01T02:10:13Z') === '2025-12-31', 'na virada do ano, vai para o ano anterior')
  t(somarDias('2026-03-01', -1) === '2026-02-28', 'somarDias atravessa fevereiro')
  t(inicioDaReleitura('2026-11-02', null, '2026-11-03') === '2026-11-02', 'sem pendente, a janela é o pedido')
  t(inicioDaReleitura('2026-11-02', '2026-10-20', '2026-11-03') === '2026-10-19', 'com pendente, volta até um dia antes dela')
  t(inicioDaReleitura('2026-11-02', '2026-06-01', '2026-11-03') === '2026-09-19', 'pendente muito antiga: para no teto de 45 dias')
  t(inicioDaReleitura('2026-01-01', '2026-10-20', '2026-11-03') === '2026-01-01', 'pedido mais antigo que a pendente vence')
  t(webhookAutorizado(null, undefined) === true, 'webhook sem segredo configurado aceita (como antes)')
  t(webhookAutorizado(null, 'abc') === false, 'segredo configurado e sem token: recusa')
  t(webhookAutorizado('abd', 'abc') === false, 'token errado: recusa')
  t(webhookAutorizado('ab', 'abc') === false, 'token de outro tamanho: recusa (sem estourar o timingSafeEqual)')
  t(webhookAutorizado('abc', ' abc\n') === true, 'segredo com espaço/quebra colada no painel ainda casa')
}

function linha(org: string, ds: string, id: string, p: {
  data: string; valor: number; desc: string; status: 'PENDING' | 'POSTED'
}): LinhaPluggy {
  return {
    organizationId: org, dataSourceId: ds, externalId: id,
    date: dataEmBrasilia(p.data), effectiveDate: dataEmBrasilia(p.data),
    amount: String(Math.abs(p.valor)), currency: 'BRL',
    direction: p.valor >= 0 ? 'inflow' : 'outflow', description: p.desc,
    accountId: 'conta-teste', accountType: 'CHECKING_ACCOUNT', accountName: 'Teste', accountNumber: '1',
    rawData: { id, date: p.data, amount: p.valor, description: p.desc, status: p.status },
    metadata: {}, needsReview: false, status: 'pending',
  }
}

async function noBanco(tx: typeof db) {
  console.log('\n— gravação e substituição (organização descartável)')
  await tx.execute(sql`SET LOCAL lock_timeout = '3s'`)
  const [org] = await tx.execute<{ id: string }>(sql`
    INSERT INTO organizations (name, slug) VALUES ('Verificação Pluggy', ${SLUG}) RETURNING id::text`)
  const [ds] = await tx.execute<{ id: string }>(sql`
    INSERT INTO data_sources (organization_id, type, provider, name)
    VALUES (${org.id}::uuid, 'bank', 'pluggy', 'Banco teste') RETURNING id::text`)
  const L = (id: string, p: Parameters<typeof linha>[3]) => linha(org.id, ds.id, id, p)
  const ler = async (ext: string) => (await tx.execute<{
    date: string; effective_date: string; amount: string; description: string; status: string
    raw: string; duplicate_of: string | null; motivo: string | null
  }>(sql`SELECT date::text, effective_date::text, amount::text, description, status,
                raw_data->>'status' AS raw, duplicate_of::text, metadata->>'motivoSubstituicao' AS motivo
           FROM transactions WHERE data_source_id = ${ds.id}::uuid AND external_id = ${ext}`))[0]

  const primeira = await gravarLancamentosPluggy(tx, [
    L('p1', { data: '2026-10-10T02:59:59.000Z', valor: -50, desc: 'MERCADO X', status: 'PENDING' }),
    L('c1', { data: '2026-10-12T15:00:00.000Z', valor: -20, desc: 'PADARIA', status: 'POSTED' }),
    L('d1', { data: '2026-10-13T15:00:00.000Z', valor: -100, desc: 'ALUGUEL', status: 'POSTED' }),
  ])
  t(primeira.inseridos.length === 3 && primeira.atualizados.length === 0, 'primeira leitura: 3 inseridos, 0 atualizados')
  t((await ler('p1')).date === '2026-10-09', 'gravado com a data de Brasília (02:59Z → dia 9)')

  const igual = await gravarLancamentosPluggy(tx, [
    L('p1', { data: '2026-10-10T02:59:59.000Z', valor: -50, desc: 'MERCADO X', status: 'PENDING' }),
  ])
  t(igual.inseridos.length === 0 && igual.atualizados.length === 0, 'releitura sem mudança não escreve nada')

  const efetivou = await gravarLancamentosPluggy(tx, [
    L('p1', { data: '2026-10-10T02:59:59.000Z', valor: -52.5, desc: 'MERCADO X LTDA', status: 'POSTED' }),
  ])
  const p1 = await ler('p1')
  t(efetivou.atualizados.length === 1 && efetivou.inseridos.length === 0, 'efetivada com o mesmo id: atualiza, não insere (não vai de novo à categorização)')
  t(p1.raw === 'POSTED' && p1.amount === '52.50' && p1.description === 'MERCADO X LTDA', 'status, valor e descrição seguem o banco')

  // Classificação manual: a descrição e a data editadas não podem ser desfeitas.
  await tx.execute(sql`UPDATE transactions SET description = 'Padaria do bairro', date = '2026-10-01', effective_date = '2026-10-01'
                        WHERE data_source_id = ${ds.id}::uuid AND external_id = 'c1'`)
  await gravarLancamentosPluggy(tx, [
    L('c1', { data: '2026-10-12T16:00:00.000Z', valor: -21, desc: 'PADARIA*2', status: 'POSTED' }),
  ])
  const c1 = await ler('c1')
  t(c1.description === 'Padaria do bairro' && c1.date === '2026-10-01', 'descrição e data editadas à mão ficam como estão')
  t(c1.amount === '21.00' && c1.raw === 'POSTED', '…mas o valor (não editado) e o raw_data seguem o banco')

  // Rateado: o gatilho recusaria valor novo — a releitura não pode quebrar o lote.
  const [d1] = await tx.execute<{ id: string }>(sql`SELECT id::text FROM transactions WHERE data_source_id = ${ds.id}::uuid AND external_id = 'd1'`)
  await tx.execute(sql`INSERT INTO transaction_allocations (organization_id, transaction_id, sequence, amount)
                        VALUES (${org.id}::uuid, ${d1.id}::uuid, 1, 60), (${org.id}::uuid, ${d1.id}::uuid, 2, 40)`)
  await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
  let recusou = false
  try {
    await gravarLancamentosPluggy(tx, [
      L('d1', { data: '2026-10-13T15:00:00.000Z', valor: -150, desc: 'ALUGUEL', status: 'POSTED' }),
      L('n1', { data: '2026-10-14T15:00:00.000Z', valor: -5, desc: 'NOVO', status: 'POSTED' }),
    ])
  } catch { recusou = true }
  t(!recusou, 'lote com lançamento rateado e valor novo não é recusado pelo gatilho')
  t((await ler('d1'))?.amount === '100.00' && !!(await ler('n1')), 'o rateado mantém o valor das partes; o novo do mesmo lote entra')

  // Linha antiga gravada em UTC: a releitura a alinha.
  await tx.execute(sql`INSERT INTO transactions (organization_id, data_source_id, external_id, date, effective_date, amount, direction, description, account_id, raw_data, status)
    VALUES (${org.id}::uuid, ${ds.id}::uuid, 'u1', '2026-10-10', '2026-10-10', 30, 'outflow', 'IOF', 'conta-teste',
            '{"id":"u1","date":"2026-10-10T02:10:13.000Z","amount":-30,"description":"IOF","status":"PENDING"}', 'confirmed')`)
  await gravarLancamentosPluggy(tx, [
    L('u1', { data: '2026-10-10T02:10:13.000Z', valor: -30, desc: 'IOF', status: 'POSTED' }),
  ])
  const u1 = await ler('u1')
  t(u1.date === '2026-10-09' && u1.effective_date === '2026-10-09', 'linha antiga com data UTC é alinhada a Brasília na releitura')

  console.log('\n— pendente que sumiu do Pluggy')
  await gravarLancamentosPluggy(tx, [
    L('p2', { data: '2026-10-20T15:00:00.000Z', valor: -80, desc: 'POSTO SHELL 123', status: 'PENDING' }),
    L('q2', { data: '2026-10-21T15:00:00.000Z', valor: -80, desc: 'POSTO SHELL 123 SP', status: 'POSTED' }),
    L('p3', { data: '2026-09-01T15:00:00.000Z', valor: -10, desc: 'ANTIGA', status: 'PENDING' }),
    L('p4', { data: '2026-10-22T15:00:00.000Z', valor: -7, desc: 'CANCELADA', status: 'PENDING' }),
  ])
  t(await pendenteMaisAntiga(tx, org.id, ds.id) === '2026-09-01', 'pendenteMaisAntiga acha a mais antiga ativa')

  const nada = await marcarPendentesQueSumiram(tx, {
    organizationId: org.id, dataSourceId: ds.id, accountId: 'conta-teste', idsLidos: [], coberturaDesde: '2026-10-01',
  })
  t(nada === 0, 'conta que voltou vazia não marca nada')

  const marcadas = await marcarPendentesQueSumiram(tx, {
    organizationId: org.id, dataSourceId: ds.id, accountId: 'conta-teste',
    idsLidos: ['p1', 'c1', 'd1', 'n1', 'u1', 'q2'], coberturaDesde: '2026-10-01',
  })
  const [p2, q2, p3, p4] = [await ler('p2'), await ler('q2'), await ler('p3'), await ler('p4')]
  const [q2id] = await tx.execute<{ id: string }>(sql`SELECT id::text FROM transactions WHERE data_source_id = ${ds.id}::uuid AND external_id = 'q2'`)
  t(marcadas === 2, `marca as 2 pendentes sumidas dentro da cobertura (marcou ${marcadas})`)
  t(p2.status === 'duplicate' && p2.duplicate_of === q2id.id && p2.motivo === 'pendente_sumiu_do_pluggy', 'a pendente com gêmea aponta para a efetivada, com o motivo')
  t(p4.status === 'duplicate' && p4.duplicate_of === null, 'a pendente sem gêmea (cancelada) sai das somas sem apontar para ninguém')
  t(p3.status !== 'duplicate', 'pendente fora da cobertura não é tocada — o Pluggy pode só não ter chegado lá')
  t(q2.status !== 'duplicate', 'a efetivada não é tocada')
}

async function migracao(tx: typeof db) {
  console.log('\n— migration 0035 contra a base real')
  const antesDatas = (await tx.execute<{ n: number }>(SQL_DATA_UTC))[0].n
  const antesFila = (await tx.execute<{ n: number }>(SQL_NA_FILA))[0].n
  const [antesInv] = await tx.execute<{ h: string }>(sql`
    SELECT md5(string_agg(t.id::text || t.date::text, ',' ORDER BY t.id)) h FROM transactions t WHERE t.invoice_id IS NOT NULL`)
  const [antesNaoPluggy] = await tx.execute<{ h: string }>(sql`
    SELECT md5(string_agg(t.id::text || t.date::text || coalesce(t.effective_date::text,''), ',' ORDER BY t.id)) h
      FROM transactions t JOIN data_sources ds ON ds.id = t.data_source_id WHERE ds.provider <> 'pluggy'`)
  console.log(`     antes: ${antesDatas} datas em UTC, ${antesFila} pendentes na fila`)

  const texto = readFileSync('db/migrations/rls/0035_pluggy_datas_e_pendentes.sql', 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  const sentencas = texto.split(/;\s*\n/).map(s => s.trim()).filter(s => s && !/^(BEGIN|COMMIT|SET LOCAL)/i.test(s))
  t(sentencas.length === 2, `o arquivo tem as 2 sentenças esperadas (${sentencas.length})`)
  for (const s of sentencas) await tx.execute(sql.raw(s))

  const depoisDatas = (await tx.execute<{ n: number }>(SQL_DATA_UTC))[0].n
  const depoisFila = (await tx.execute<{ n: number }>(SQL_NA_FILA))[0].n
  console.log(`     depois: ${depoisDatas} datas em UTC, ${depoisFila} pendentes na fila`)
  t(antesDatas > 0 && depoisDatas === 0, `as ${antesDatas} datas UTC foram alinhadas a Brasília`)
  t(depoisFila - antesFila >= 30, `pendentes com gêmea entram na fila de revisão (+${depoisFila - antesFila})`)

  const [errada] = await tx.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int n FROM transactions t JOIN data_sources ds ON ds.id = t.data_source_id
     WHERE ds.provider = 'pluggy' AND t.raw_data ? 'date' AND t.invoice_id IS NULL
       AND t.date <> ((t.raw_data->>'date')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
       AND t.organization_id NOT IN (SELECT id FROM organizations WHERE slug = ${SLUG})`)
  t(errada.n === 0, 'nenhum lançamento do Pluggy (sem NF-e) fica fora da data de Brasília')
  const [depoisInv] = await tx.execute<{ h: string }>(sql`
    SELECT md5(string_agg(t.id::text || t.date::text, ',' ORDER BY t.id)) h FROM transactions t WHERE t.invoice_id IS NOT NULL`)
  t(antesInv.h === depoisInv.h, 'lançamento casado com NF-e mantém a data')
  const [depoisNaoPluggy] = await tx.execute<{ h: string }>(sql`
    SELECT md5(string_agg(t.id::text || t.date::text || coalesce(t.effective_date::text,''), ',' ORDER BY t.id)) h
      FROM transactions t JOIN data_sources ds ON ds.id = t.data_source_id WHERE ds.provider <> 'pluggy'`)
  t(antesNaoPluggy.h === depoisNaoPluggy.h, 'nenhuma data de lançamento importado ou manual muda')
  const [semPar] = await tx.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int n FROM transactions t
     WHERE t.metadata->>'reconciliationKind' = 'pendente'
       AND NOT EXISTS (SELECT 1 FROM transactions q WHERE q.id = (t.metadata->>'reconciliationCandidateId')::uuid)`)
  t(semPar.n === 0, 'todo par na fila aponta para uma efetivada que existe')

  const filaAntes = depoisFila
  for (const s of sentencas) await tx.execute(sql.raw(s))
  t((await tx.execute<{ n: number }>(SQL_NA_FILA))[0].n === filaAntes, 'idempotente: rodar de novo não muda nada')
}

async function main() {
  puras()
  try {
    await db.transaction(async raw => {
      const tx = raw as unknown as typeof db
      await noBanco(tx)
      await migracao(tx)
      throw new Error(ROLLBACK)
    })
  } catch (e) {
    if ((e as Error).message !== ROLLBACK) { console.error(e); falhas++ }
  }
  const [rastro] = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int n FROM organizations WHERE slug = ${SLUG}`)
  t(rastro.n === 0, 'nada persistiu fora da transação')
  console.log(`\n${ok}/${ok + falhas}`)
  process.exit(falhas ? 1 : 0)
}
main()
