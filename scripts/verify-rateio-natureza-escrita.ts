/**
 * Sessão 2 do rateio de natureza: a 0033 não muda número nenhum, e as escritas
 * cumprem a regra nova.
 *
 *   # ANTES da 0033 — tira o retrato (só leitura):
 *   DATABASE_URL=<banco> npx tsx --env-file=.env.local scripts/verify-rateio-natureza-escrita.ts --retrato <arquivo.json>
 *   # DEPOIS da 0033 — compara com o retrato e exercita as escritas:
 *   DATABASE_URL=<banco> npx tsx --env-file=.env.local scripts/verify-rateio-natureza-escrita.ts --comparar <arquivo.json>
 *
 * O retrato fica FORA do repositório: são números de cliente.
 *
 * O cenário de escrita roda numa organização descartável, criada e apagada
 * aqui — escrever no dado de um cliente para testar seria reclassificar a
 * contabilidade dele.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { runQuery } from '@/lib/query/engine'
import { scopeFromJob } from '@/lib/query/scope'
import { calcularKpisDoMes } from '@/lib/dashboard/kpis'
import { calcularIndicadores } from '@/lib/dashboard/indicators'
import { semNaturezaFilter } from '@/lib/sql-dimensions'
import { lerLinhasDoBalanco } from '@/lib/balance-sheet-read'
import { contarUsoDaNatureza } from '@/lib/category-usage'
import {
  gravarAllocations, listarAllocations, preverLoteDeRateio, aplicarLoteDeRateio,
} from '@/lib/allocations-write'
import { classificarPorIds, semRateio, resumirClassificacao } from '@/lib/transactions-write'
import { transactions } from '@/db/schema'

let ok = 0, falhas = 0
const t = (c: boolean, l: string) => { if (c) { ok++; console.log(`  OK    ${l}`) } else { falhas++; console.log(`  FALHA ${l}`) } }

// ─── O retrato ────────────────────────────────────────────────────────────────

async function tirarRetrato() {
  const orgs = await db.execute<{ id: string; nome: string }>(sql`
    SELECT o.id::text AS id, o.name AS nome FROM organizations o
    WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.organization_id = o.id)
      AND o.name NOT LIKE 'ZZ Teste%'
    ORDER BY o.name
  `)
  const retrato: Record<string, unknown> = {}
  let truncados = 0
  for (const o of orgs) {
    const meses = (await db.execute<{ m: string }>(sql`
      SELECT DISTINCT TO_CHAR(date::date, 'YYYY-MM') AS m FROM transactions
      WHERE organization_id = ${o.id}::uuid ORDER BY 1
    `)).map(x => x.m)
    const porMes: Record<string, unknown> = {}
    for (const m of meses) {
      const [y, mm] = m.split('-').map(Number)
      const de = `${m}-01`
      const ate = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10)
      const consultas: Record<string, unknown> = {}
      for (const regime of ['competencia', 'caixa'] as const) {
        const r = await runQuery(scopeFromJob(o.id), {
          fonte: 'realizado',
          medidas: ['valor_liquido', 'entradas', 'saidas', 'contagem'],
          agruparPor: ['categoria'],
          periodo: { tipo: 'intervalo', de, ate, regime },
          filtros: { visibilidade: regime === 'caixa' ? 'caixa' : 'dre' },
          limite: 500,
        })
        if (r.truncado) truncados++
        consultas[regime] = r.linhas
          .map(l => ({ k: l.chaves.map(c => c.id).join('|'), m: l.medidas }))
          .sort((a, b) => a.k.localeCompare(b.k))
      }
      porMes[m] = {
        consultas,
        kpis: await calcularKpisDoMes(o.id, m),
        indicadores: await calcularIndicadores(o.id, m),
      }
    }
    const [sn] = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM transactions t
      WHERE t.organization_id = ${o.id}::uuid AND ${semNaturezaFilter(sql.raw('t.id'))}
    `)
    retrato[o.nome] = { porMes, semNatureza: Number(sn.n) }
  }
  return { retrato, truncados, orgs: orgs.length }
}

// ─── O cenário de escrita ─────────────────────────────────────────────────────

const ORG_NOME = 'ZZ Teste Rateio Natureza'

async function limpar() {
  await db.execute(sql`DELETE FROM organizations WHERE name = ${ORG_NOME}`)
}

async function cenario() {
  await limpar()
  const [org] = await db.execute<{ id: string }>(sql`
    INSERT INTO organizations (name, slug, cnpj)
    VALUES (${ORG_NOME}, 'zz-teste-rateio-natureza', '00000000000353')
    RETURNING id::text AS id
  `)
  const ORG = org.id
  await db.execute(sql`DELETE FROM categories WHERE organization_id = ${ORG}::uuid`)

  const cat = async (code: string, nome: string, tipo: string, pai: string | null, ativo = true) => {
    const [r] = await db.execute<{ id: string }>(sql`
      INSERT INTO categories (organization_id, code, name, type, parent_id, is_active)
      VALUES (${ORG}::uuid, ${code}, ${nome}, ${tipo}, ${pai ? sql`${pai}::uuid` : sql`NULL`}, ${ativo})
      RETURNING id::text AS id
    `)
    return r.id
  }
  const paiA = await cat('1', 'Pai Despesa', 'sga', null)
  const A1 = await cat('1.1', 'Aluguel ZZ', 'sga', paiA)
  const A2 = await cat('1.2', 'Energia ZZ', 'sga', paiA)
  const A3 = await cat('1.3', 'Arquivada ZZ', 'sga', paiA, false)
  const paiP = await cat('9', 'Pai Ativo', 'ativo_circulante', null)
  const P1 = await cat('9.1', 'Caixa ZZ', 'ativo_circulante', paiP)
  const P2 = await cat('9.2', 'Bancos ZZ', 'ativo_circulante', paiP)

  const [ds] = await db.execute<{ id: string }>(sql`
    INSERT INTO data_sources (organization_id, type, provider, name, status)
    VALUES (${ORG}::uuid, 'manual', 'manual', 'ZZ conta', 'active')
    RETURNING id::text AS id
  `)
  const [docBp] = await db.execute<{ id: string }>(sql`
    INSERT INTO documents (organization_id, type, filename, storage_path, mime_type, size_bytes,
                           report_type, reference_date, extraction_status)
    VALUES (${ORG}::uuid, 'relatorio', 'zz-balanco.csv', 'zz://balanco', 'text/csv', 1,
            'balance_sheet', '2026-03-31', 'completed')
    RETURNING id::text AS id
  `)
  const lanc = async (catId: string | null, valor: string, docId: string | null = null, direcao = 'outflow') => {
    const [r] = await db.execute<{ id: string }>(sql`
      INSERT INTO transactions (organization_id, data_source_id, document_id, category_id, date, effective_date,
                                description, amount, direction, status, currency, needs_review)
      VALUES (${ORG}::uuid, ${ds.id}::uuid, ${docId ? sql`${docId}::uuid` : sql`NULL`},
              ${catId ? sql`${catId}::uuid` : sql`NULL`}, '2026-03-10', '2026-03-10',
              'ZZ lancamento', ${valor}, ${direcao}, 'confirmed', 'BRL', true)
      RETURNING id::text AS id
    `)
    return r.id
  }
  const linhas = (txId: string) => db.execute<{ c: string | null; v: string }>(sql`
    SELECT category_id::text AS c, amount::text AS v FROM transaction_lines
    WHERE transaction_id = ${txId}::uuid ORDER BY sequence
  `).then(r => r.map(x => `${x.c === A1 ? 'A1' : x.c === A2 ? 'A2' : x.c === P1 ? 'P1' : x.c === P2 ? 'P2' : x.c ?? 'nula'}=${Number(x.v)}`).join(' '))
  const origem = (txId: string) => db.execute<{ c: string | null; nr: boolean }>(sql`
    SELECT category_id::text AS c, needs_review AS nr FROM transactions WHERE id = ${txId}::uuid
  `).then(r => r[0])
  const semDim = { costCenterId: null, businessUnitId: null, legalEntityId: null, contactId: null }

  const tx1 = await lanc(A1, '1000.00')

  console.log('\n── chamador antigo (sem categoryId) — Review Focus 4 ──')
  let r = await gravarAllocations(ORG, tx1, [{ amount: 600, ...semDim }, { amount: 400, ...semDim }])
  t('success' in r, `grava (${JSON.stringify(r)})`)
  t(await linhas(tx1) === 'A1=600 A1=400', `as partes herdam a natureza do lançamento (${await linhas(tx1)})`)
  t((await origem(tx1)).c === null, 'o lançamento rateado fica sem natureza')
  t((await origem(tx1)).nr === false, 'e sai da fila de revisão')
  t((await listarAllocations(ORG, tx1)).every(p => p.categoryId === A1), 'listarAllocations devolve a natureza da parte')

  console.log('\n── naturezas diferentes ──')
  r = await gravarAllocations(ORG, tx1, [{ amount: 600, categoryId: A1, ...semDim }, { amount: 400, categoryId: A2, ...semDim }])
  t('success' in r, 'grava 600 Aluguel + 400 Energia')
  t(await linhas(tx1) === 'A1=600 A2=400', `a view separa por natureza (${await linhas(tx1)})`)
  t(await contarUsoDaNatureza(ORG, A2) === 1, 'a natureza que só existe numa parte conta como em uso')
  const kpis = await calcularKpisDoMes(ORG, '2026-03')
  t(kpis.despesas.current === 1000, `as despesas do mês somam 1.000 — não duplica nem some (${kpis.despesas.current})`)

  console.log('\n── validações ──')
  r = await gravarAllocations(ORG, tx1, [{ amount: 600, categoryId: A1, ...semDim }, { amount: 400, categoryId: P1, ...semDim }])
  t('error' in r && /Caixa ZZ/.test(r.error) && /Balanço/.test(r.error), `natureza de Balanço em movimento é recusada ("${'error' in r ? r.error : ''}")`)
  r = await gravarAllocations(ORG, tx1, [{ amount: 600, categoryId: paiA, ...semDim }, { amount: 400, categoryId: A1, ...semDim }])
  t('error' in r && /Natureza Pai/.test(r.error), 'Natureza Pai é recusada')
  r = await gravarAllocations(ORG, tx1, [{ amount: 600, categoryId: A3, ...semDim }, { amount: 400, categoryId: A1, ...semDim }])
  t('error' in r && /arquivada/.test(r.error), 'natureza arquivada é recusada')
  t(await linhas(tx1) === 'A1=600 A2=400', 'as recusas não mexeram no rateio anterior')

  console.log('\n── classificar o rateado ──')
  const c = await classificarPorIds(ORG, [tx1], { categoryId: A1 })
  t(c.atualizados === 0 && c.rateadosExcluidos === 1, `classificar natureza no rateado é excluído (${JSON.stringify(c)})`)
  t(await linhas(tx1) === 'A1=600 A2=400', 'e o rateio segue intacto')

  console.log('\n── filtro de lote do MCP pergunta às partes (revisão final, Important 2) ──')
  const porNatureza = await resumirClassificacao(ORG, { categorias: [A2] }, { categoryId: A1 })
  t(porNatureza.rateadosExcluidos === 1,
    `"reclassificar o que está em Energia" enxerga o rateado com parte em Energia e o declara excluído (${JSON.stringify({ q: porNatureza.quantidade, r: porNatureza.rateadosExcluidos })})`)
  const semNat = await resumirClassificacao(ORG, { semNatureza: true }, { categoryId: A1 })
  t(semNat.rateadosExcluidos === 0,
    `"sem natureza" NÃO pega o rateado cujas partes têm natureza (${semNat.rateadosExcluidos})`)

  console.log('\n── rateio com naturezas divergentes não é achatado em silêncio (revisão das sessões 3/4) ──')
  // tx1 está rateado em Aluguel 600 + Energia 400. Um novo rateio SEM natureza
  // não tem como "manter a do lançamento" — são duas. Antes, as partes ficavam
  // sem natureza e o valor saía da DRE sem ninguém pedir.
  r = await gravarAllocations(ORG, tx1, [{ amount: 500, ...semDim }, { amount: 500, ...semDim }])
  t('error' in r && /naturezas diferentes/.test(r.error), `gravar sem natureza sobre partes divergentes é recusado ("${'error' in r ? r.error.slice(0, 70) : ''}")`)
  t(await linhas(tx1) === 'A1=600 A2=400', 'e o rateio anterior fica intacto')
  const loteDiv = await preverLoteDeRateio(ORG, [tx1], [{ weight: 1, ...semDim }, { weight: 1, ...semDim }])
  t('error' in loteDiv && /naturezas diferentes/.test(loteDiv.error), 'no lote, a PRÉVIA recusa (antes de aplicar metade)')
  r = await gravarAllocations(ORG, tx1, [{ amount: 500, categoryId: A1, ...semDim }, { amount: 500, categoryId: A2, ...semDim }])
  t('success' in r, 'com a natureza informada em cada parte, grava')
  r = await gravarAllocations(ORG, tx1, [{ amount: 600, categoryId: A1, ...semDim }, { amount: 400, categoryId: A2, ...semDim }])

  console.log('\n── natureza herdada não é revalidada (revisão final, Important 1) ──')
  const tx5 = await lanc(A3, '80.00')   // classificado numa natureza que depois foi arquivada
  r = await gravarAllocations(ORG, tx5, [{ amount: 50, ...semDim }, { amount: 30, ...semDim }])
  t('success' in r, `re-ratear só centro de custo num lançamento de natureza arquivada funciona (${JSON.stringify(r)})`)
  t((await listarAllocations(ORG, tx5)).every(p => p.categoryId === A3), 'e as partes herdam a arquivada, como hoje')
  const tx6 = await lanc(A3, '40.00')
  const lote6 = await aplicarLoteDeRateio(ORG, [tx6], [{ weight: 1, ...semDim }, { weight: 1, ...semDim }])
  t('success' in lote6, 'no lote também')

  console.log('\n── remover o rateio — Review Focus 2 e 3 ──')
  r = await gravarAllocations(ORG, tx1, [])
  t('success' in r, 'remove')
  t((await origem(tx1)).c === null, 'partes divergentes: o lançamento fica SEM natureza (lacuna visível)')
  r = await gravarAllocations(ORG, tx1, [{ amount: 500, categoryId: A2, ...semDim }, { amount: 500, categoryId: A2, ...semDim }])
  r = await gravarAllocations(ORG, tx1, [])
  t((await origem(tx1)).c === A2, 'partes na mesma natureza: ela volta para o lançamento')

  console.log('\n── categorizador — Review Focus 5 ──')
  const tx4 = await lanc(null, '300.00')
  r = await gravarAllocations(ORG, tx4, [{ amount: 100, ...semDim }, { amount: 200, ...semDim }])
  t(await linhas(tx4) === 'nula=100 nula=200', 'rateado de origem sem natureza: partes sem natureza (Review Focus 1)')
  const naoCat = await db.select({ id: transactions.id }).from(transactions)
    .where(sql`${transactions.organizationId} = ${ORG}::uuid AND ${transactions.categoryId} IS NULL AND ${semRateio}`)
  t(!naoCat.some(x => x.id === tx4), '"Categorizar agora" não pega o rateado')
  const [sn] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM transactions t
    WHERE t.id = ${tx4}::uuid AND ${semNaturezaFilter(sql.raw('t.id'))}`)
  t(Number(sn.n) === 1, 'mas ele conta como "sem natureza" — as partes pedem classificação')

  console.log('\n── lote ──')
  const tx3 = await lanc(A2, '90.00')
  const prevErro = await preverLoteDeRateio(ORG, [tx3], [{ weight: 1, categoryId: P1, ...semDim }, { weight: 2, ...semDim }])
  t('error' in prevErro, 'lote com natureza de Balanço em movimento é recusado na PRÉVIA (antes de aplicar metade)')
  const lote = await aplicarLoteDeRateio(ORG, [tx3], [{ weight: 1, ...semDim }, { weight: 2, ...semDim }])
  t('success' in lote, 'lote sem natureza aplica')
  t(await linhas(tx3) === 'A2=30 A2=60', `cada lançamento herda a própria natureza (${await linhas(tx3)})`)

  console.log('\n── balanço ──')
  const tx2 = await lanc(P1, '500.00', docBp.id, 'inflow')
  let bp = await lerLinhasDoBalanco(ORG, docBp.id)
  t(bp.length === 1 && bp[0].childName === 'Caixa ZZ' && bp[0].total === 500, 'balanço lê o documento (sem rateio)')
  r = await gravarAllocations(ORG, tx2, [{ amount: 300, categoryId: P1, ...semDim }, { amount: 200, categoryId: P2, ...semDim }])
  t('success' in r, 'rateio de natureza num balanço, entre naturezas de Balanço')
  bp = await lerLinhasDoBalanco(ORG, docBp.id)
  t(bp.map(b => `${b.childName}=${b.total}`).sort().join(' ') === 'Bancos ZZ=200 Caixa ZZ=300', `o Balanço lê as partes (${bp.map(b => `${b.childName}=${b.total}`).join(' ')})`)
  r = await gravarAllocations(ORG, tx2, [{ amount: 300, categoryId: P1, ...semDim }, { amount: 200, categoryId: A1, ...semDim }])
  t('error' in r && /não é natureza de Balanço/.test(r.error), 'natureza de DRE num balanço é recusada')

  await limpar()
  const [restou] = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM organizations WHERE name = ${ORG_NOME}`)
  t(Number(restou.n) === 0, 'limpeza: a organização de teste não sobrou')
}

// ─── Principal ────────────────────────────────────────────────────────────────

async function main() {
  const modo = process.argv[2]
  const arquivo = process.argv[3]
  const [col] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'transaction_allocations' AND column_name = 'category_id'`)
  const com0033 = Number(col.n) === 1

  if (modo === '--retrato') {
    if (com0033) { console.error('O retrato é tirado ANTES da 0033 — ela já está aplicada neste banco.'); process.exit(1) }
    const r = await tirarRetrato()
    writeFileSync(arquivo, JSON.stringify(r.retrato))
    console.log(`retrato de ${r.orgs} organizações gravado em ${arquivo} (${r.truncados} consultas truncadas)`)
    process.exit(r.truncados > 0 ? 1 : 0)
  }

  if (modo === '--comparar') {
    if (!com0033) { console.error('A comparação é DEPOIS da 0033 — aplique-a primeiro.'); process.exit(1) }
    console.log('── conciliação: antes × depois da 0033 ──')
    const antes = JSON.parse(readFileSync(arquivo, 'utf8')) as Record<string, { porMes: Record<string, unknown>; semNatureza: number }>
    const depois = (await tirarRetrato()).retrato as typeof antes
    let meses = 0
    for (const [nome, a] of Object.entries(antes)) {
      const d = depois[nome]
      t(!!d, `${nome}: presente depois`)
      if (!d) continue
      for (const [m, va] of Object.entries(a.porMes)) {
        meses++
        const vd = d.porMes[m]
        if (JSON.stringify(va) !== JSON.stringify(vd)) {
          t(false, `${nome} ${m}: DRE/fluxo/KPIs/indicadores mudaram`)
          console.log('     antes :', JSON.stringify(va).slice(0, 300))
          console.log('     depois:', JSON.stringify(vd).slice(0, 300))
        } else ok++
      }
      t(a.semNatureza === d.semNatureza, `${nome}: sem natureza ${a.semNatureza} × ${d.semNatureza}`)
    }
    console.log(`  (${meses} meses × 2 regimes + KPIs + indicadores comparados)`)
    console.log('\n── cenário de escrita ──')
    await cenario()
    console.log(`\n${ok + falhas} verificações — ${ok} OK, ${falhas} falha(s)`)
    process.exit(falhas > 0 ? 1 : 0)
  }

  console.error('uso: --retrato <arquivo> | --comparar <arquivo>')
  process.exit(1)
}

main().catch(async (e) => { console.error('\nERRO:', e); await limpar().catch(() => {}); process.exit(1) })
