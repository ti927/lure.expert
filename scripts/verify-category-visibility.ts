/**
 * O selo de visibilidade herda do pai — as cinco leituras, contra o banco.
 *
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-category-visibility.ts
 *
 * Cria a própria organização e a apaga no fim. Além disso concilia contra as
 * organizações REAIS, só leitura: com nenhum pai oculto, o predicado novo tem
 * de devolver exatamente o que o antigo devolvia — senão a correção teria
 * mexido em número de cliente sem ninguém pedir.
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { filtroDeVisibilidade, campoDoRegime } from '@/lib/category-visibility'

let ok = 0, falhas = 0
const t = (c: boolean, l: string) => { if (c) { ok++; console.log(`OK   | ${l}`) } else { falhas++; console.log(`FALHA| ${l}`) } }

const ORG_NOME = 'ZZ Teste Visibilidade'
let ORG = ''

async function limpar() {
  await db.execute(sql`DELETE FROM organizations WHERE name = ${ORG_NOME}`)
}

/** A query do /fluxo, reduzida ao que importa aqui. */
async function lerFluxo() {
  return db.execute<{ code: string; n: string }>(sql`
    SELECT c.code, COUNT(*)::text AS n
    FROM transaction_lines tl
    JOIN categories c ON tl.category_id = c.id
    JOIN categories p ON c.parent_id = p.id
    WHERE tl.organization_id = ${ORG}::uuid
      AND tl.status NOT IN ('pending','duplicate')
      ${filtroDeVisibilidade('c', 'hide_in_cashflow')}
    GROUP BY 1 ORDER BY 1
  `)
}

/** A query da DRE, idem. */
async function lerDre() {
  return db.execute<{ code: string; n: string }>(sql`
    SELECT c.code, COUNT(*)::text AS n
    FROM transaction_lines tl
    JOIN categories c ON tl.category_id = c.id
    JOIN categories p ON c.parent_id = p.id
    WHERE tl.organization_id = ${ORG}::uuid
      AND tl.status NOT IN ('pending','duplicate')
      ${filtroDeVisibilidade('c', 'hide_in_dre')}
    GROUP BY 1 ORDER BY 1
  `)
}

const codigos = (r: { code: string }[]) => r.map(x => x.code).join(',')

async function main() {
  await limpar()

  // ── Cenário ────────────────────────────────────────────────────────────────
  const [org] = await db.execute<{ id: string }>(sql`
    INSERT INTO organizations (name, slug, cnpj)
    VALUES (${ORG_NOME}, 'zz-teste-visibilidade', '00000000000272')
    RETURNING id::text AS id
  `)
  ORG = org.id
  // O seed automático cria o plano padrão; apago para montar um previsível.
  await db.execute(sql`DELETE FROM categories WHERE organization_id = ${ORG}::uuid`)

  const cat = async (code: string, nome: string, tipo: string, pai: string | null) => {
    const [r] = await db.execute<{ id: string }>(sql`
      INSERT INTO categories (organization_id, code, name, type, parent_id)
      VALUES (${ORG}::uuid, ${code}, ${nome}, ${tipo},
              ${pai ? sql`${pai}::uuid` : sql`NULL`})
      RETURNING id::text AS id
    `)
    return r.id
  }

  const paiA = await cat('1', 'Pai Visível', 'sga', null)
  const a1   = await cat('1.1', 'Filho A1', 'sga', paiA)
  const a2   = await cat('1.2', 'Filho A2', 'sga', paiA)
  const paiB = await cat('2', 'Pai a Ocultar', 'transfer', null)
  const b1   = await cat('2.1', 'Filho B1', 'transfer', paiB)

  const [ds] = await db.execute<{ id: string }>(sql`
    INSERT INTO data_sources (organization_id, type, provider, name, status)
    VALUES (${ORG}::uuid, 'manual', 'manual', 'ZZ conta', 'active')
    RETURNING id::text AS id
  `)
  const lanc = async (catId: string, valor: string) => {
    await db.execute(sql`
      INSERT INTO transactions (organization_id, data_source_id, category_id, date, effective_date,
                                description, amount, direction, status, currency)
      VALUES (${ORG}::uuid, ${ds.id}::uuid, ${catId}::uuid, '2026-03-10', '2026-03-10',
              'ZZ lancamento', ${valor}, 'outflow', 'confirmed', 'BRL')
    `)
  }
  await lanc(a1, '100.00')
  await lanc(a2, '200.00')
  await lanc(b1, '300.00')

  // ── 1. Estado inicial: nada oculto ─────────────────────────────────────────
  console.log('\n── 1. nada oculto ──')
  t(codigos(await lerFluxo()) === '1.1,1.2,2.1', `as 3 folhas aparecem no fluxo (${codigos(await lerFluxo())})`)
  t(codigos(await lerDre()) === '1.1,1.2,2.1', 'e as 3 na DRE')

  // ── 2. O DEFEITO: ocultar o PAI ────────────────────────────────────────────
  console.log('\n── 2. ocultar a Natureza Pai (o defeito de 26/ago) ──')
  await db.execute(sql`UPDATE categories SET hide_in_cashflow = true WHERE id = ${paiB}::uuid`)
  const semRamo = codigos(await lerFluxo())
  t(semRamo === '1.1,1.2', `ocultar o pai tira o RAMO do fluxo (${semRamo})`)
  // O outro sentido, que é o que faz a asserção valer: a DRE não foi tocada.
  t(codigos(await lerDre()) === '1.1,1.2,2.1',
    'e NÃO mexe na DRE — o selo é por regime, não geral')

  // ── 3. O filho continua podendo ser ocultado sozinho ───────────────────────
  console.log('\n── 3. o selo do filho segue independente ──')
  await db.execute(sql`UPDATE categories SET hide_in_cashflow = false WHERE id = ${paiB}::uuid`)
  await db.execute(sql`UPDATE categories SET hide_in_cashflow = true  WHERE id = ${a1}::uuid`)
  const soFilho = codigos(await lerFluxo())
  t(soFilho === '1.2,2.1', `ocultar um filho tira só ele, e o irmão fica (${soFilho})`)

  // ── 4. Pai oculto vence filho visível ──────────────────────────────────────
  console.log('\n── 4. pai oculto + filho explicitamente visível ──')
  await db.execute(sql`UPDATE categories SET hide_in_cashflow = false WHERE id = ${a1}::uuid`)
  await db.execute(sql`UPDATE categories SET hide_in_cashflow = true  WHERE id = ${paiA}::uuid`)
  const paiVence = codigos(await lerFluxo())
  t(paiVence === '2.1', `pai oculto esconde os filhos mesmo com o selo deles em visível (${paiVence})`)

  // ── 5. DRE independente ────────────────────────────────────────────────────
  console.log('\n── 5. os dois regimes não se confundem ──')
  await db.execute(sql`UPDATE categories SET hide_in_cashflow = false WHERE id = ${paiA}::uuid`)
  await db.execute(sql`UPDATE categories SET hide_in_dre = true WHERE id = ${paiA}::uuid`)
  t(codigos(await lerDre()) === '2.1', 'pai oculto na DRE tira o ramo da DRE')
  t(codigos(await lerFluxo()) === '1.1,1.2,2.1', 'e o fluxo segue com as 3')
  t(campoDoRegime('caixa') === 'hide_in_cashflow' && campoDoRegime('competencia') === 'hide_in_dre',
    'campoDoRegime mapeia caixa→FC e competência→DRE')

  await db.execute(sql`UPDATE categories SET hide_in_dre = false WHERE id = ${paiA}::uuid`)

  // ── 6. Conciliação contra as organizações REAIS ────────────────────────────
  //
  // O predicado só pode DIFERIR do antigo onde há pai oculto. Onde não há, tem
  // de devolver exatamente o mesmo conjunto — é o que garante que a correção
  // não mexeu no número de nenhum cliente por tabela.
  console.log('\n── 6. conciliação com o dado real ──')
  const reais = await db.execute<{ id: string; nome: string }>(sql`
    SELECT id::text AS id, name AS nome FROM organizations WHERE name NOT LIKE 'ZZ Teste%'
  `)
  let iguais = 0, diferentes = 0
  for (const o of reais) {
    for (const campo of ['hide_in_dre', 'hide_in_cashflow'] as const) {
      const novo = await db.execute<{ n: string }>(sql`
        SELECT COUNT(*)::text AS n FROM transaction_lines tl
        JOIN categories c ON tl.category_id = c.id
        WHERE tl.organization_id = ${o.id}::uuid AND tl.status NOT IN ('pending','duplicate')
          ${filtroDeVisibilidade('c', campo)}
      `)
      const antigo = await db.execute<{ n: string }>(sql`
        SELECT COUNT(*)::text AS n FROM transaction_lines tl
        JOIN categories c ON tl.category_id = c.id
        WHERE tl.organization_id = ${o.id}::uuid AND tl.status NOT IN ('pending','duplicate')
          AND COALESCE(c.${sql.raw(campo)}, false) = false
      `)
      const paisOcultos = await db.execute<{ n: string; nomes: string | null }>(sql`
        SELECT COUNT(*)::text AS n, STRING_AGG(name, ', ') AS nomes FROM categories
        WHERE organization_id = ${o.id}::uuid AND parent_id IS NULL
          AND COALESCE(${sql.raw(campo)}, false) = true
      `)
      const dif = Number(antigo[0].n) - Number(novo[0].n)
      const temPaiOculto = Number(paisOcultos[0].n) > 0
      if (dif === 0) iguais++
      else diferentes++
      if (dif !== 0) {
        console.log(`     ${o.nome} / ${campo}: ${dif} lançamento(s) a menos — pai(s) oculto(s): ${paisOcultos[0].nomes}`)
      }
      t(dif === 0 || temPaiOculto,
        `${o.nome} / ${campo}: ${dif === 0 ? 'idêntico ao antigo' : `mudou em ${dif}, e há pai oculto que explica`}`)
    }
  }
  console.log(`     (${iguais} pares idênticos, ${diferentes} com diferença explicada por pai oculto)`)

  await limpar()
  const restou = await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n FROM organizations WHERE name = ${ORG_NOME}
  `)
  t(Number(restou[0].n) === 0, 'limpeza: a organização de teste não sobrou')

  console.log(`\n${ok + falhas} verificações — ${ok} OK, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error('\nERRO:', e); await limpar().catch(() => {}); process.exit(1) })
