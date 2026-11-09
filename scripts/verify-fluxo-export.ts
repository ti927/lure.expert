/**
 * Exportação do /fluxo para Excel — `lib/fluxo-export.ts`.
 *
 *   npx tsx --env-file=.env.local scripts/verify-fluxo-export.ts [caminho-para-salvar.xlsx]
 *
 * Só LEITURA: nada é escrito no banco.
 *
 * O que precisa ser provado:
 * 1. As linhas "Entra no fluxo? = Sim", somadas por natureza e mês, são
 *    EXATAMENTE a tabela do /fluxo (a consulta de getFluxoMensalData, replicada
 *    aqui) — em toda organização, em mais de um período, e com filtro de
 *    dimensão.
 * 2. Nenhum lançamento do período some: a planilha tem tantas linhas quanto
 *    `transaction_lines` no período, e as que ficam de fora dizem por quê.
 * 3. Rateio: as partes de um lançamento somam o valor inteiro dele.
 * 4. O arquivo: as duas abas, o cabeçalho, os SOMASES apontando para as
 *    colunas certas e com valor já calculado igual ao da tela.
 * 5. A chave do SOMASES (coluna Natureza) nunca parece número — "4.1" e "4.10"
 *    seriam o mesmo critério para o Excel.
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { BP_TYPES, type DreFilters } from '@/lib/dre-types'
import { dimensionFilters } from '@/lib/sql-dimensions'
import { filtroDeVisibilidade } from '@/lib/category-visibility'
import { lerLinhasParaExportar, montarMatriz, montarPlanilhaDoFluxo } from '@/lib/fluxo-export'

let ok = 0, falhas = 0
const t = (c: boolean, l: string) => { if (c) { ok++; console.log(`  OK    ${l}`) } else { falhas++; console.log(`  FALHA ${l}`) } }
const cent = (v: number) => Math.round(v * 100)

/** A consulta do /fluxo (server/fluxo-mensal.ts), com a organização explícita. */
async function fluxoDaTela(org: string, f: DreFilters) {
  const rows = await db.execute<{ code: string; month: string; net: string }>(sql`
    SELECT c.code, TO_CHAR(DATE_TRUNC('month', COALESCE(t.effective_date, t.date)::date), 'YYYY-MM') AS month,
           COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END), 0) AS net
      FROM transaction_lines t
      JOIN categories c ON t.category_id = c.id
      JOIN categories p ON c.parent_id   = p.id
     WHERE t.organization_id = ${org}::uuid
       AND t.status NOT IN ('pending', 'duplicate')
       AND COALESCE(t.effective_date, t.date)::date >= ${f.from}::date
       AND COALESCE(t.effective_date, t.date)::date <= ${f.to}::date
       AND c.type NOT IN (${sql.raw(BP_TYPES.map(x => `'${x}'`).join(', '))})
       ${filtroDeVisibilidade('c', 'hide_in_cashflow')}
       ${dimensionFilters('t', f)}
     GROUP BY c.code, 2`)
  return new Map(rows.map(r => [`${r.code}|${r.month}`, cent(Number(r.net))]))
}

async function conciliar(org: string, nome: string, f: DreFilters, rotulo: string) {
  const linhas = await lerLinhasParaExportar(org, f)
  const tela = await fluxoDaTela(org, f)

  const exp = new Map<string, number>()
  for (const p of montarMatriz(linhas)) for (const n of p.filhos)
    for (const [m, v] of Object.entries(n.porMes)) exp.set(`${n.codigo}|${m}`, cent(v))

  const chaves = new Set(Array.from(tela.keys()).concat(Array.from(exp.keys())))
  const diverge = Array.from(chaves).filter(k => (tela.get(k) ?? 0) !== (exp.get(k) ?? 0))
  t(diverge.length === 0, `${nome} ${rotulo}: ${tela.size} células natureza×mês idênticas à tela${diverge.length ? ` — divergem: ${diverge.slice(0, 5).join(', ')}` : ''}`)

  const [{ n }] = await db.execute<{ n: string }>(sql`
    SELECT COUNT(*) AS n FROM transaction_lines t
     WHERE t.organization_id = ${org}::uuid
       AND COALESCE(t.effective_date, t.date)::date BETWEEN ${f.from}::date AND ${f.to}::date
       ${dimensionFilters('t', f)}`)
  t(Number(n) === linhas.length, `${nome} ${rotulo}: ${linhas.length} linhas = ${n} linhas de transaction_lines no período`)
  t(linhas.every(l => l.entraNoFluxo === (l.motivo == null)), `${nome} ${rotulo}: toda linha fora do fluxo tem motivo, e só ela`)
  return linhas
}

async function main() {
  const orgs = await db.execute<{ id: string; name: string }>(sql`SELECT id, name FROM organizations ORDER BY name`)
  const quick = orgs.find(o => /quick/i.test(o.name))!

  console.log('\n1–2. Conciliação com a tela, em toda organização')
  const periodos: [string, DreFilters][] = [
    ['dez/25–nov/26', { from: '2025-12-01', to: '2026-11-30' }],
    ['2020–2027',     { from: '2020-01-01', to: '2027-12-31' }],
  ]
  for (const o of orgs) for (const [rot, f] of periodos) await conciliar(o.id, o.name, f, rot)

  console.log('\n1b. Com filtro de dimensão (Quick)')
  const ccs = await db.execute<{ id: string; name: string }>(sql`
    SELECT cc.id, cc.name FROM cost_centers cc
     WHERE cc.organization_id = ${quick.id}::uuid
       AND EXISTS (SELECT 1 FROM transaction_lines t WHERE t.cost_center_id = cc.id) LIMIT 1`)
  if (ccs.length) {
    const lf = await conciliar(quick.id, quick.name, { from: '2020-01-01', to: '2027-12-31', costCenterIds: [ccs[0].id] }, `CC=${ccs[0].name}`)
    t(lf.length > 0 && lf.every(l => l.centroDeCusto === ccs[0].name), 'filtro de CC: toda linha é daquele CC')
    await conciliar(quick.id, quick.name, { from: '2020-01-01', to: '2027-12-31', costCenterIds: ['__null__'] }, 'CC=sem')
  } else console.log('  (Quick sem centro de custo em uso — pulado)')

  const f: DreFilters = { from: '2025-12-01', to: '2026-11-30' }
  const linhas = await lerLinhasParaExportar(quick.id, f)

  console.log('\n3. Rateio')
  const partes = new Map<string, { soma: number; total: number; n: number; declarado: number }>()
  for (const l of linhas) if (l.rateio) {
    const p = partes.get(l.transactionId) ?? { soma: 0, total: l.valorDoLancamento!, n: 0, declarado: Number(l.rateio.split('/')[1]) }
    p.soma += cent(l.valor); p.n++; partes.set(l.transactionId, p)
  }
  const ruins = Array.from(partes.values()).filter(p => p.soma !== cent(p.total) || p.n !== p.declarado)
  t(ruins.length === 0, `${partes.size} lançamentos rateados: partes somam o valor inteiro e a contagem "i/N" fecha`)
  t(linhas.filter(l => !l.rateio).every(l => l.valorDoLancamento == null), 'fora do rateio, "Valor do lançamento" fica vazio')

  console.log('\n5. Chave do SOMASES')
  t(linhas.every(l => l.natureza == null || !Number.isFinite(Number(l.natureza.replace(',', '.')))), 'nenhuma Natureza parece número')
  const motivos = new Map<string, number>()
  linhas.filter(l => l.motivo).forEach(l => motivos.set(l.motivo!, (motivos.get(l.motivo!) ?? 0) + 1))
  console.log(`  fora do fluxo na Quick (${f.from}..${f.to}):`, Object.fromEntries(motivos))

  console.log('\n4. O arquivo')
  const { arquivo, nome } = montarPlanilhaDoFluxo(linhas, f, quick.name)
  if (process.argv[2]) { writeFileSync(process.argv[2], arquivo); console.log(`  salvo em ${process.argv[2]}`) }
  t(nome === 'fluxo-de-caixa_quick-aviacao_2025-12_a_2026-11.xlsx', `nome do arquivo: ${nome}`)
  const wb = XLSX.read(arquivo, { type: 'buffer', cellFormula: true, cellNF: true })
  t(wb.SheetNames.join('|') === 'Fluxo de caixa|Lançamentos', `abas: ${wb.SheetNames.join(', ')}`)

  const wl = wb.Sheets['Lançamentos']
  const dados = XLSX.utils.sheet_to_json<Record<string, unknown>>(wl)
  t(dados.length === linhas.length, `"Lançamentos" tem ${dados.length} linhas`)
  const cab = XLSX.utils.sheet_to_json<string[]>(wl, { header: 1 })[0]
  const col = (titulo: string) => XLSX.utils.encode_col(cab.indexOf(titulo))
  t(wl[`${col('Data de caixa')}2`]?.z === 'dd/mm/yyyy', 'data gravada como data, com formato dd/mm/yyyy')
  t(wl[`${col('Valor no fluxo')}2`]?.t === 'n', 'valor gravado como número')

  const wf = wb.Sheets['Fluxo de caixa']
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(wf, { header: 1, raw: true })
  const formulas = Object.entries(wf).filter(([k, c]) => !k.startsWith('!') && (c as XLSX.CellObject).f?.startsWith('SUMIFS'))
  t(formulas.length > 0, `${formulas.length} células com SOMASES`)
  const [, amostra] = formulas[0] as [string, XLSX.CellObject]
  const esperado = [`'Lançamentos'!$${col('Valor no fluxo')}:$`, `'Lançamentos'!$${col('Natureza')}:$`, `'Lançamentos'!$${col('Mês de caixa')}:$`, `'Lançamentos'!$${col('Entra no fluxo?')}:$`]
  t(esperado.every(e => amostra.f!.includes(e)), `SOMASES aponta para Valor no fluxo, Natureza, Mês de caixa e Entra no fluxo? — ${amostra.f}`)

  // Recalcula cada SOMASES em JS, lendo a aba "Lançamentos" do próprio arquivo.
  const H = 3
  const mesesSerial = (matriz[H] as number[]).slice(1, -1)
  let conferidas = 0, erradas = 0
  for (const [k, c] of formulas as [string, XLSX.CellObject][]) {
    const { r, c: ci } = XLSX.utils.decode_cell(k)
    // Só o recuo sai: nome de natureza pode terminar em espaço ("… - Oficina "),
    // e o SOMASES compara o texto exato.
    const rotulo = String(matriz[r][0]).replace(/^ {4}/, '')
    const mes = mesesSerial[ci - 1]
    const soma = dados.filter(d => d['Natureza'] === rotulo && d['Mês de caixa'] === mes && d['Entra no fluxo?'] === 'Sim')
      .reduce((s, d) => s + cent(Number(d['Valor no fluxo'])), 0)
    conferidas++
    if (soma !== cent(Number(c.v))) erradas++
  }
  t(erradas === 0, `${conferidas} SOMASES recalculados a partir da aba Lançamentos batem com o valor gravado`)

  const tela = await fluxoDaTela(quick.id, f)
  const totalTela = Array.from(tela.values()).reduce((s, v) => s + v, 0)
  const linhaLiq = matriz.findIndex(l => l[0] === 'Total líquido')
  t(cent(Number(matriz[linhaLiq].at(-1))) === totalTela, `Total líquido do período = tela (${(totalTela / 100).toFixed(2)})`)

  console.log(`\n${ok} OK, ${falhas} falha(s)`)
  process.exit(falhas ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
