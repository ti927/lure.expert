/**
 * Verificação de 20/out: `detalhar_lancamentos` + agrupamento por descrição +
 * medida `naturezas_distintas`. SÓ LEITURA — roda contra a produção sem gravar.
 *
 * O pedido que originou: "lançamentos com a mesma DESCRIÇÃO mas com CATEGORIAS
 * diferentes", que o expert respondia não conseguir fazer. Cada número do motor
 * é conferido contra um cálculo INDEPENDENTE (JS sobre as linhas cruas), e a
 * leitura linha a linha é conferida contra o motor — duas portas, um número.
 *
 * Rodar com o pooler:
 *   DATABASE_URL="postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:6543/postgres" \
 *     npx tsx --env-file=.env.local scripts/verify-detalhar-lancamentos.ts
 */

import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { runQuery } from '@/lib/query/engine'
import { scopeFromJob } from '@/lib/query/scope'
import { normalizarDescricao, descricaoNormalizadaSql } from '@/lib/descricao-normalizada'
import { detalharLancamentos } from '@/lib/transactions-read'
import { acharFerramenta, schemaDeEntrada } from '@/lib/mcp/tools'
import { querySpecSchema } from '@/lib/query/spec'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

async function main() {
  // A organização com mais lançamentos — nunca LIMIT 1, que já pegou org vazia.
  const [org] = await db.execute<{ id: string; name: string }>(sql`
    SELECT o.id::text, o.name FROM organizations o JOIN transactions tx ON tx.organization_id = o.id
    GROUP BY o.id, o.name ORDER BY COUNT(*) DESC LIMIT 1`)
  const quick = await db.execute<{ id: string }>(sql`SELECT id::text FROM organizations WHERE name ILIKE '%quick%' LIMIT 1`)
  const orgId = quick[0]?.id ?? org.id
  console.log(`organização: ${orgId}\n`)
  const scope = await scopeFromJob(orgId)

  // ── 1. A normalização em SQL e em TS concordam, sobre as descrições reais ──
  const desc = await db.execute<{ d: string; n: string | null }>(sql`
    SELECT DISTINCT description AS d, ${descricaoNormalizadaSql(sql`description`)} AS n
      FROM transactions WHERE organization_id = ${orgId}::uuid`)
  const divergentes = desc.filter(r => normalizarDescricao(r.d) !== r.n)
  t(desc.length > 50, `há descrições suficientes para provar algo (${desc.length})`)
  t(divergentes.length === 0, `SQL e TS normalizam igual (${divergentes.length} divergentes${divergentes[0] ? `: "${divergentes[0].d}"` : ''})`)
  t(normalizarDescricao('PIX JOÃO 12/09') === normalizarDescricao('pix joao 15/09'), 'datas, acento e caixa somem da chave')
  t(normalizarDescricao('12/09 123') === null, 'descrição só de números não tem chave (vira nula, não "")')

  // ── 2. O motor: descrição normalizada × naturezas distintas ────────────────
  const linhas = await db.execute<{ tx: string; d: string; cat: string | null }>(sql`
    SELECT tl.transaction_id::text AS tx, tl.description AS d, tl.category_id::text AS cat
      FROM transaction_lines tl
     WHERE tl.organization_id = ${orgId}::uuid AND tl.status NOT IN ('pending', 'duplicate')`)
  const esperado = new Map<string, { cats: Set<string>; txs: Set<string> }>()
  for (const l of linhas) {
    const k = normalizarDescricao(l.d) ?? ' '
    const g = esperado.get(k) ?? { cats: new Set(), txs: new Set() }
    if (l.cat) g.cats.add(l.cat)
    g.txs.add(l.tx)
    esperado.set(k, g)
  }

  const r = await runQuery(scope, {
    medidas: ['naturezas_distintas', 'contagem'],
    agruparPor: ['descricao_normalizada'],
    periodo: { tipo: 'intervalo', de: '2000-01-01', ate: '2100-12-31' },
    filtros: { excluirBalanco: false },
    ordenarPor: [{ por: 'naturezas_distintas', direcao: 'desc' }],
    limite: 500,
  })
  const erradas = r.linhas.filter(l => {
    const e = esperado.get(l.chaves[0].id ?? ' ')
    return !e || e.cats.size !== l.medidas.naturezas_distintas || e.txs.size !== l.medidas.contagem
  })
  t(r.linhas.length > 0 && erradas.length === 0,
    `cada grupo bate com o cálculo independente (${r.linhas.length} grupos, ${erradas.length} errados)`)
  const maisDeUma = r.linhas.filter(l => l.medidas.naturezas_distintas > 1)
  t(maisDeUma.length > 0, `a medida varia: ${maisDeUma.length} descrições em 2+ naturezas`)
  t(r.linhas.some(l => l.medidas.naturezas_distintas <= 1), 'e há descrições numa natureza só')
  const ordenado = r.linhas.every((l, i) => i === 0 || r.linhas[i - 1].medidas.naturezas_distintas >= l.medidas.naturezas_distintas)
  t(ordenado, 'ordenar por naturezas_distintas desc põe as inconsistentes primeiro')
  console.log('  exemplos:', maisDeUma.slice(0, 3).map(l => `"${l.chaves[0].rotulo}" (${l.medidas.naturezas_distintas} naturezas, ${l.medidas.contagem} lanç.)`).join(' · '))

  // A exata fragmenta mais que a normalizada — é a razão de existirem as duas.
  const exata = await runQuery(scope, {
    medidas: ['contagem'], agruparPor: ['descricao'],
    periodo: { tipo: 'intervalo', de: '2000-01-01', ate: '2100-12-31' },
    filtros: { excluirBalanco: false }, limite: 500,
  })
  t(exata.truncado || exata.linhas.length >= r.linhas.length,
    `"descricao" exata tem pelo menos tantos grupos quanto a normalizada`)

  // ── 3. Filtros novos do motor ─────────────────────────────────────────────
  const alvo = maisDeUma[0]
  const filtrado = await runQuery(scope, {
    medidas: ['contagem'], periodo: { tipo: 'intervalo', de: '2000-01-01', ate: '2100-12-31' },
    filtros: { excluirBalanco: false, descricaoNormalizada: alvo.chaves[0].rotulo.toUpperCase() },
  })
  t(filtrado.linhas[0]?.medidas.contagem === alvo.medidas.contagem,
    'filtros.descricaoNormalizada devolve o grupo inteiro (mesmo passando em maiúsculas)')

  const [pix] = await db.execute<{ n: string }>(sql`
    SELECT COUNT(DISTINCT transaction_id)::text AS n FROM transaction_lines
     WHERE organization_id = ${orgId}::uuid AND status NOT IN ('pending','duplicate') AND description ILIKE '%pix%'`)
  const pixMotor = await runQuery(scope, {
    medidas: ['contagem'], periodo: { tipo: 'intervalo', de: '2000-01-01', ate: '2100-12-31' },
    filtros: { excluirBalanco: false, descricaoContem: 'pix' },
  })
  t(Number(pix.n) > 0 && pixMotor.linhas[0]?.medidas.contagem === Number(pix.n),
    `filtros.descricaoContem "pix" = ${pix.n} lançamentos, igual ao ILIKE direto`)
  const curinga = await runQuery(scope, {
    medidas: ['contagem'], periodo: { tipo: 'intervalo', de: '2000-01-01', ate: '2100-12-31' },
    filtros: { excluirBalanco: false, descricaoContem: '%_' },
  })
  t((curinga.linhas[0]?.medidas.contagem ?? 0) === 0, '"%" e "_" do usuário são literais, não curinga')

  let recusou = false
  try {
    await runQuery(scope, {
      fonte: 'orcado', medidas: ['valor_liquido'], periodo: { tipo: 'intervalo', de: '2026-01-01', ate: '2026-12-31' },
      filtros: { descricaoContem: 'pix' },
    })
  } catch { recusou = true }
  t(recusou, 'a fonte "orcado" recusa filtro de descrição em vez de ignorá-lo')

  // ── 4. detalhar_lancamentos: a leitura linha a linha bate com o motor ──────
  const pag1 = await detalharLancamentos(orgId, {
    filtros: { descricaoNormalizada: alvo.chaves[0].rotulo }, limite: 2, ordenarPor: 'data', direcao: 'asc',
  })
  t(pag1.total === alvo.medidas.contagem, `total do detalhe = contagem do motor para o grupo (${pag1.total})`)
  const ids = new Set<string>()
  for (let off = 0; off < pag1.total; off += 2) {
    const p = await detalharLancamentos(orgId, {
      filtros: { descricaoNormalizada: alvo.chaves[0].rotulo }, limite: 2, offset: off, ordenarPor: 'data', direcao: 'asc',
    })
    p.lancamentos.forEach(l => ids.add(l.id))
  }
  t(ids.size === pag1.total, `paginar de 2 em 2 cobre o grupo sem repetir nem pular (${ids.size})`)
  t(pag1.temMais === pag1.total > 2, 'temMais diz a verdade')
  const natsVistas = new Set<string>()
  const todos = await detalharLancamentos(orgId, { filtros: { descricaoNormalizada: alvo.chaves[0].rotulo }, limite: 200 })
  for (const l of todos.lancamentos) {
    if (l.natureza) natsVistas.add(l.natureza.id)
    l.partes?.forEach(p => p.natureza && natsVistas.add(p.natureza.id))
  }
  t(natsVistas.size === alvo.medidas.naturezas_distintas,
    `as naturezas que o detalhe mostra são as que o motor contou (${natsVistas.size})`)

  const [contTotal] = await db.execute<{ n: string; e: string; s: string }>(sql`
    SELECT COUNT(*)::text n,
           COALESCE(SUM(CASE WHEN direction='inflow' THEN amount END),0)::text e,
           COALESCE(SUM(CASE WHEN direction='outflow' THEN amount END),0)::text s
      FROM transactions WHERE organization_id = ${orgId}::uuid AND status NOT IN ('pending','duplicate')`)
  const tudo = await detalharLancamentos(orgId, { limite: 1 })
  t(tudo.total === Number(contTotal.n), `sem filtro, total = todos os lançamentos (${tudo.total})`)
  t(Math.abs(tudo.totais.entradas - Number(contTotal.e)) < 0.01 && Math.abs(tudo.totais.saidas - Number(contTotal.s)) < 0.01,
    'totais de entradas e saídas batem com a soma direta')

  const rateados = await detalharLancamentos(orgId, { filtros: { rateado: true }, limite: 200 })
  const somaFecha = rateados.lancamentos.every(l =>
    Math.round((l.partes ?? []).reduce((a, p) => a + p.valor, 0) * 100) === Math.round(l.valor * 100))
  t(rateados.lancamentos.every(l => l.rateado && (l.partes?.length ?? 0) >= 2 && l.natureza === null),
    `rateado vem uma vez, sem natureza no pai, com as partes dentro (${rateados.total})`)
  t(somaFecha, 'as partes somam o valor do lançamento ao centavo')
  const naoRateados = await detalharLancamentos(orgId, { filtros: { rateado: false }, limite: 1 })
  t(naoRateados.total + rateados.total === tudo.total, 'rateado true + false = todos')

  const semNat = await detalharLancamentos(orgId, { filtros: { semNatureza: true }, limite: 200 })
  t(semNat.lancamentos.every(l => l.natureza === null), `semNatureza só traz sem natureza (${semNat.total})`)

  const caixa = await detalharLancamentos(orgId, { filtros: { de: '2026-09-01', ate: '2026-09-30', regime: 'caixa' }, limite: 200 })
  t(caixa.lancamentos.every(l => l.dataCaixa >= '2026-09-01' && l.dataCaixa <= '2026-09-30'), 'regime caixa limita pela data de caixa')

  const valor = await detalharLancamentos(orgId, { ordenarPor: 'valor', direcao: 'desc', limite: 5 })
  t(valor.lancamentos.every((l, i) => i === 0 || valor.lancamentos[i - 1].valor >= l.valor), 'ordenar por valor desc')

  let errou = ''
  try { await detalharLancamentos(orgId, { filtros: { categorias: ['00000000-0000-0000-0000-000000000000'] } }) }
  catch (e) { errou = String((e as Error).message) }
  t(errou.includes('listar_categorias'), 'id de natureza inexistente é ERRO que aponta listar_categorias, não lista vazia')

  // ── 5. O que o modelo LÊ: o schema publicado ──────────────────────────────
  const ferr = acharFerramenta('detalhar_lancamentos', ['leitura'])
  t(!!ferr, 'detalhar_lancamentos está no catálogo de leitura')
  const pub = JSON.stringify(ferr ? schemaDeEntrada(ferr) : {})
  t(pub.includes('descricaoNormalizada') && pub.includes('rótulo que'), 'o schema publicado explica descricaoNormalizada')
  t(pub.includes('"offset"') && pub.includes('200'), 'e a paginação')
  const pubConsulta = JSON.stringify(z.toJSONSchema(querySpecSchema, { io: 'input' }))
  t(pubConsulta.includes('descricao_normalizada') && pubConsulta.includes('naturezas_distintas'),
    'consultar publica o agrupamento e a medida novos')
  t(pubConsulta.includes('mesma descrição classificada'), 'e explica para que serve naturezas_distintas')

  console.log(`\n${ok} ok, ${falhas} falha(s)`)
  process.exit(falhas ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
