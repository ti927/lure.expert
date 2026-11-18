/**
 * A escrita da folha no orçamento (Task 4) contra o banco LOCAL.
 *
 *   DATABASE_URL=postgresql://postgres:local@localhost:55432/postgres \
 *     npx tsx --env-file=.env.local scripts/verify-payroll-write.ts
 *
 * Cria duas organizações descartáveis (a de teste e uma "vizinha", para provar
 * que nenhuma função confia só no id), com UJs, versões e categorias próprias,
 * e as apaga no fim — também em falha, no `finally`. Se o script morrer no
 * meio, a execução seguinte remove o que sobrou pelo nome.
 *
 * O exemplo conferível é o da spec 5.6: CLT R$ 5.000 no Lucro Presumido =
 * 90.533,33 no ano; mais um PJ de R$ 12.000 em jan e fev = 24.000,00.
 */
import { db } from '@/db'
import {
  organizations, memberships, categories, legalEntities, budgetVersions, budgetSeries,
  budgetEntries, costCenters, budgetPeople, budgetPeopleAllocations, budgetPeopleBenefits,
  payrollCategoryMap, agentEvents, budgetPayrollSettings,
} from '@/db/schema'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import {
  lerQuadro, salvarPessoa, apagarPessoa, salvarParametrosVersao, lerMapa, salvarMapa,
  preverFolha, gerarFolha, copiarQuadro, quadroDesatualizado, recusaSeFolha, RECUSA_FOLHA,
  recusaApagarUnidadeJuridica, recusaApagarNaturezaDaFolha,
} from '@/lib/payroll-write'
import { applySeriesUpdate, applySeriesDelete, planSeriesUpdate, seriesToInput } from '@/lib/budget-scope'
import { applyDraftsToBudget, applyDuplicateVersion } from '@/lib/budget-copy'
import type { PessoaInput } from '@/lib/payroll-types'

const url = process.env.DATABASE_URL ?? ''
if (!/localhost:55432/.test(url)) {
  console.error(`ABORTADO: DATABASE_URL não aponta para o banco local (localhost:55432): ${url.replace(/:[^:@]*@/, ':***@')}`)
  process.exit(2)
}

const NOME_ORG = 'ZZ Teste folha escrita'
const NOME_VIZINHA = 'ZZ Teste folha vizinha'
const USUARIO = randomUUID()

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { if (bom) ok++; else falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }
const temErro = (r: unknown): r is { error: string } => typeof r === 'object' && r !== null && 'error' in r
const tx = <T>(f: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => db.transaction(f)

async function limpar(orgIds: string[]) {
  if (orgIds.length === 0) return
  // Ordem explícita: várias FKs são RESTRICT (categoria, entidade jurídica).
  await db.delete(budgetSeries).where(inArray(budgetSeries.organizationId, orgIds))
  await db.delete(payrollCategoryMap).where(inArray(payrollCategoryMap.organizationId, orgIds))
  await db.delete(budgetPeople).where(inArray(budgetPeople.organizationId, orgIds))
  await db.delete(organizations).where(inArray(organizations.id, orgIds))
}

async function main() {
  const antigas = await db.select({ id: organizations.id }).from(organizations)
    .where(inArray(organizations.name, [NOME_ORG, NOME_VIZINHA]))
  await limpar(antigas.map(o => o.id))

  const criadas: string[] = []
  try {
    const [org] = await db.insert(organizations).values({ name: NOME_ORG, slug: `zz-folha-${Date.now()}` })
      .returning({ id: organizations.id })
    const ORG = org.id
    criadas.push(ORG)
    const [viz] = await db.insert(organizations).values({ name: NOME_VIZINHA, slug: `zz-folha-viz-${Date.now()}` })
      .returning({ id: organizations.id })
    const VIZ = viz.id
    criadas.push(VIZ)
    await db.insert(memberships).values({ userId: USUARIO, organizationId: ORG, role: 'owner', acceptedAt: new Date() })

    // ── Fixture ──────────────────────────────────────────────────────────────
    const cats = await db.select({ id: categories.id, code: categories.code, parentId: categories.parentId, type: categories.type })
      .from(categories).where(eq(categories.organizationId, ORG))
    const porCodigo = new Map(cats.map(c => [c.code, c]))
    const salarios = porCodigo.get('5.1.1')
    t(!!salarios?.parentId, 'o plano padrão semeado tem 5.1.1 como Natureza Filho')
    if (!salarios) throw new Error('sem 5.1.1')
    const [honorarios] = await db.insert(categories).values({
      organizationId: ORG, code: '5.1.99', name: 'Honorários PJ (teste)', type: salarios.type, parentId: salarios.parentId,
    }).returning({ id: categories.id })

    const [ujLP] = await db.insert(legalEntities).values({ organizationId: ORG, name: 'UJ LP', regimeTributario: 'lucro_presumido' })
      .returning({ id: legalEntities.id })
    const [ujSimples] = await db.insert(legalEntities).values({ organizationId: ORG, name: 'UJ Simples', regimeTributario: 'simples' })
      .returning({ id: legalEntities.id })
    const [cc] = await db.insert(costCenters).values({ organizationId: ORG, name: 'CC teste' }).returning({ id: costCenters.id })
    const [v27] = await db.insert(budgetVersions).values({ organizationId: ORG, name: 'Folha 2027', fiscalYear: 2027 })
      .returning({ id: budgetVersions.id })
    const [v28] = await db.insert(budgetVersions).values({ organizationId: ORG, name: 'Folha 2028', fiscalYear: 2028 })
      .returning({ id: budgetVersions.id })
    const [vViz] = await db.insert(budgetVersions).values({ organizationId: VIZ, name: 'Vizinha 2027', fiscalYear: 2027 })
      .returning({ id: budgetVersions.id })

    const clt: PessoaInput = {
      nome: 'Maria CLT', vinculo: 'clt', legalEntityId: ujLP.id, valorBase: 5000,
      alocacoes: [{ costCenterId: cc.id, percentual: 100 }],
    }
    const pj: PessoaInput = { nome: 'João PJ', vinculo: 'pj', valorBase: 12000, mesesPj: [1, 2] }

    // ── (a) alocação que não fecha 100 ───────────────────────────────────────
    const a = await tx(x => salvarPessoa(x, ORG, USUARIO, v27.id, {
      ...clt, alocacoes: [{ costCenterId: cc.id, percentual: 60 }, { costCenterId: null, percentual: 39.99 }],
    }))
    t(temErro(a) && a.error.includes('99,99%'), `(a) alocação 60 + 39,99 recusada citando 99,99% — ${JSON.stringify(a)}`)

    // PJ sem mês a lançar
    const semMes = await tx(x => salvarPessoa(x, ORG, USUARIO, v27.id, { ...pj, mesEntrada: 3 }))
    t(temErro(semMes) && /nenhum mês a lançar/.test(semMes.error), `PJ com meses [1,2] entrando em março recusado — ${JSON.stringify(semMes)}`)

    // Coerência: versão de outra organização
    const fora = await tx(x => salvarPessoa(x, ORG, USUARIO, vViz.id, clt))
    t(temErro(fora), `salvarPessoa numa versão de outra organização recusado — ${JSON.stringify(fora)}`)
    const ujFora = await tx(x => salvarPessoa(x, VIZ, USUARIO, vViz.id, clt))
    t(temErro(ujFora), `salvarPessoa com UJ/CC de outra organização recusado — ${JSON.stringify(ujFora)}`)

    // ── Quadro ───────────────────────────────────────────────────────────────
    const sClt = await tx(x => salvarPessoa(x, ORG, USUARIO, v27.id, clt))
    const sPj = await tx(x => salvarPessoa(x, ORG, USUARIO, v27.id, pj))
    t(!temErro(sClt) && !temErro(sPj), `CLT e PJ gravados — ${JSON.stringify([sClt, sPj])}`)
    if (temErro(sClt) || temErro(sPj)) throw new Error('quadro não gravado')

    const outraVersao = await tx(x => salvarPessoa(x, ORG, USUARIO, v28.id, clt, sClt.id))
    t(temErro(outraVersao), `editar pessoa passando outra versão recusado — ${JSON.stringify(outraVersao)}`)

    const q = await lerQuadro(db, ORG, v27.id)
    t(!temErro(q) && q.pessoas.length === 2, 'lerQuadro devolve as duas pessoas')
    if (!temErro(q)) {
      const maria = q.pessoas.find(p => p.id === sClt.id)
      t(maria?.custoAnualCentavos === 9053333, `custo anual da CLT = 90.533,33 (${maria?.custoAnualCentavos})`)
      t(maria?.alocacoes.length === 1 && maria.alocacoes[0].costCenterId === cc.id, 'alocação lida de volta')
      t(q.desatualizado === true && q.geradoEm === null, 'nunca gerada com pessoas → desatualizado')
    }

    // ── (b) prévia sem mapa gravado ──────────────────────────────────────────
    const mapa0 = await lerMapa(db, ORG)
    const sugSal = mapa0.find(m => m.componente === 'salario')
    t(sugSal?.sugerida === true && sugSal.categoryId === salarios.id, 'lerMapa sugere 5.1.1 para salário (sugerida)')
    const sugPj = mapa0.find(m => m.componente === 'honorario_pj')
    t(sugPj?.categoryId === null && sugPj.sugerida === false, 'honorário PJ sem sugestão')

    const b = await preverFolha(db, ORG, v27.id)
    const motivosB = temErro(b) ? [] : b.recusas.map(r => r.motivo)
    t(motivosB.some(m => m.includes('Salário') && m.includes('não gravado')),
      `(b) prévia sem mapa recusa citando "Salário" e "não gravado" — ${JSON.stringify(motivosB.slice(0, 3))}`)

    const gerSemMapa = await tx(x => gerarFolha(x, ORG, USUARIO, v27.id))
    t(temErro(gerSemMapa), 'gerar sem mapa gravado é recusado')

    // ── (c) com o mapa salvo ─────────────────────────────────────────────────
    const sugeridas = Object.fromEntries(mapa0.filter(m => m.categoryId).map(m => [m.componente, m.categoryId]))
    const mapaFora = await tx(x => salvarMapa(x, VIZ, { salario: salarios.id }))
    t(temErro(mapaFora), 'salvarMapa com natureza de outra organização recusado')
    const sm = await tx(x => salvarMapa(x, ORG, { ...sugeridas, honorario_pj: honorarios.id }))
    t(!temErro(sm), `mapa salvo — ${JSON.stringify(sm)}`)
    const mapa1 = await lerMapa(db, ORG)
    t(mapa1.every(m => !m.sugerida && m.categoryId), 'depois de salvo, nada é sugerido')

    const c = await preverFolha(db, ORG, v27.id)
    t(!temErro(c) && c.recusas.length === 0, `(c) prévia sem recusas — ${temErro(c) ? c.error : JSON.stringify(c.recusas)}`)
    if (!temErro(c)) {
      t(c.totalCentavos === 9053333 + 2400000, `(c) total = 90.533,33 + 24.000,00 (${c.totalCentavos})`)
      t(c.porPessoa.find(p => p.personId === sPj.id)?.centavos === 2400000, 'por pessoa: PJ = 24.000,00')
      t(c.porComponenteMes.reduce((s, x) => s + x.centavos, 0) === c.totalCentavos, 'componente × mês fecha com o total')
      t(c.seriesExistentes === 0, 'nenhuma série de folha ainda')
    }

    // ── (e) série manual antes de gerar ──────────────────────────────────────
    const [manual] = await db.insert(budgetSeries).values({
      organizationId: ORG, versionId: v27.id, description: 'Aluguel manual', direction: 'outflow',
      categoryId: salarios.id, startMonth: '2027-01-01', occurrences: 1, amountMode: 'fixo', baseAmount: '100.00', source: 'manual',
    }).returning({ id: budgetSeries.id })
    await db.insert(budgetEntries).values({
      organizationId: ORG, versionId: v27.id, seriesId: manual.id, sequence: 1, description: 'Aluguel manual',
      direction: 'outflow', categoryId: salarios.id, competenceDate: '2027-01-01', cashDate: '2027-01-01', amount: '100.00',
    })

    // ── (d) gerar ────────────────────────────────────────────────────────────
    const d = await tx(x => gerarFolha(x, ORG, USUARIO, v27.id))
    // CLT: salário, INSS, FGTS, terço, os 4 encargos s/ 13º e férias, e o 13º
    // e o FGTS s/ 13º partidos em 1ª/2ª parcela (duas datas de caixa por mês
    // não cabem no teto de 12 ocorrências) = 11. PJ: honorário = 1.
    t(!temErro(d) && d.series === 12 && d.substituidas === 0, `(d) gerar: 12 séries, 0 substituídas — ${JSON.stringify(d)}`)

    const estado = async () => {
      const [r] = await db.execute<{ series: number; entries: number; soma: string; inflows: number }>(sql`
        SELECT (SELECT COUNT(*)::int FROM budget_series s WHERE s.version_id = ${v27.id}::uuid AND s.source = 'folha') AS series,
               COUNT(e.id)::int AS entries,
               COALESCE(SUM(e.amount), 0)::text AS soma,
               COUNT(*) FILTER (WHERE e.direction <> 'outflow')::int AS inflows
          FROM budget_entries e JOIN budget_series s ON s.id = e.series_id
         WHERE e.version_id = ${v27.id}::uuid AND s.source = 'folha'`)
      return r
    }
    const e1 = await estado()
    t(Number(e1.soma) === 114533.33, `(d) Σ budget_entries folha = 114.533,33 (${e1.soma})`)
    t(e1.inflows === 0, '(d) todas as ocorrências são saída')
    t(!temErro(d) && d.entries === e1.entries && d.series === e1.series, '(d) contagens do retorno batem com o banco')

    const naturezaErrada = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM budget_series s
        JOIN payroll_category_map m ON m.organization_id = s.organization_id AND m.componente = s.metadata->'folha'->>'componente'
       WHERE s.version_id = ${v27.id}::uuid AND s.source = 'folha' AND s.category_id <> m.category_id`)
    t(Number(naturezaErrada[0].n) === 0, '(d) natureza de cada série = a do mapa do componente')
    const entradaDivergente = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM budget_entries e JOIN budget_series s ON s.id = e.series_id
       WHERE s.version_id = ${v27.id}::uuid AND s.source = 'folha'
         AND (e.category_id <> s.category_id OR e.cost_center_id IS DISTINCT FROM s.cost_center_id)`)
    t(Number(entradaDivergente[0].n) === 0, '(d) ocorrência herda natureza e centro de custo da série')
    const ccMaria = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM budget_series s
       WHERE s.version_id = ${v27.id}::uuid AND s.source = 'folha'
         AND s.metadata->'folha'->>'personId' = ${sClt.id} AND s.cost_center_id = ${cc.id}::uuid`)
    t(Number(ccMaria[0].n) === 11, `(d) as 11 séries da CLT (4 de encargos s/ 13º e férias separadas) levam o centro de custo (${ccMaria[0].n})`)
    const encargos = await db.execute<{ n: number }>(sql`
      SELECT COUNT(DISTINCT (s.metadata->'folha'->'encargo')::text)::int AS n FROM budget_series s
       WHERE s.version_id = ${v27.id}::uuid AND s.metadata->'folha'->>'componente' = 'encargos_13_ferias'`)
    t(Number(encargos[0].n) === 4, '(d) os encargos s/ 13º e férias são 4 séries distintas')
    const mesRepetido = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM (
        SELECT e.series_id FROM budget_entries e JOIN budget_series s ON s.id = e.series_id
         WHERE s.version_id = ${v27.id}::uuid AND s.source = 'folha'
         GROUP BY e.series_id HAVING COUNT(*) <> COUNT(DISTINCT e.competence_date)) x`)
    t(Number(mesRepetido[0].n) === 0, '(d) cada série tem uma ocorrência por competência')
    const ocorrDivergente = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM budget_series s
       WHERE s.version_id = ${v27.id}::uuid AND s.source = 'folha'
         AND s.occurrences <> (SELECT COUNT(*) FROM budget_entries e2 WHERE e2.series_id = s.id)`)
    t(Number(ocorrDivergente[0].n) === 0, '(d) occurrences da série = nº de ocorrências gravadas')

    const ev = await db.select({ n: sql<number>`count(*)::int` }).from(agentEvents)
      .where(and(eq(agentEvents.organizationId, ORG), eq(agentEvents.type, 'folha.gerada'), eq(agentEvents.entityId, v27.id)))
    t(ev[0].n === 1, '(d) geração registrada em agent_events')

    // ── (e) a manual sobreviveu ──────────────────────────────────────────────
    const aindaManual = await db.select({ id: budgetSeries.id }).from(budgetSeries).where(eq(budgetSeries.id, manual.id))
    t(aindaManual.length === 1, '(e) série manual continua lá depois de gerar')

    // ── (f) gerar de novo ────────────────────────────────────────────────────
    const f = await tx(x => gerarFolha(x, ORG, USUARIO, v27.id))
    const e2 = await estado()
    t(!temErro(f) && f.substituidas === 12 && f.series === 12, `(f) gerar de novo substitui as 12 — ${JSON.stringify(f)}`)
    t(e2.entries === e1.entries && e2.soma === e1.soma && e2.series === e1.series, '(f) mesma contagem e mesma soma — não dobrou')
    const prevF = await preverFolha(db, ORG, v27.id)
    t(!temErro(prevF) && prevF.seriesExistentes === 12, 'prévia conta as séries existentes')

    // ── (g) desatualização ───────────────────────────────────────────────────
    t(await quadroDesatualizado(db, ORG, v27.id) === false, '(g) recém-gerado → não desatualizado')
    await tx(x => salvarPessoa(x, ORG, USUARIO, v27.id, clt, sClt.id))
    t(await quadroDesatualizado(db, ORG, v27.id) === true, '(g) depois de salvarPessoa → desatualizado')
    await tx(x => gerarFolha(x, ORG, USUARIO, v27.id))
    t(await quadroDesatualizado(db, ORG, v27.id) === false, '(g) gerado de novo → em dia')
    await db.update(legalEntities).set({ aliquotaFgts: '0.0850' }).where(eq(legalEntities.id, ujLP.id))
    t(await quadroDesatualizado(db, ORG, v27.id) === true, '(g) depois de mudar a alíquota da UJ → desatualizado')
    await tx(x => gerarFolha(x, ORG, USUARIO, v27.id))
    const sp = await tx(x => salvarParametrosVersao(x, ORG, v27.id, { modoProvisao: 'pagamento' }))
    t(!temErro(sp) && await quadroDesatualizado(db, ORG, v27.id) === true, '(g) depois de mudar o modo da versão → desatualizado')
    await tx(x => gerarFolha(x, ORG, USUARIO, v27.id))
    await tx(x => salvarMapa(x, ORG, { pro_labore: salarios.id }))
    t(await quadroDesatualizado(db, ORG, v27.id) === true, '(g) depois de mexer no mapa → desatualizado')

    // apagar pessoa
    const [tmp] = await db.insert(budgetPeople).values({ organizationId: ORG, versionId: v28.id, nome: 'Temp', vinculo: 'pj', valorBase: '1' })
      .returning({ id: budgetPeople.id })
    const apErrado = await tx(x => apagarPessoa(x, ORG, v27.id, tmp.id))
    t(temErro(apErrado), 'apagarPessoa com a versão errada recusado')
    const apFora = await tx(x => apagarPessoa(x, VIZ, v28.id, tmp.id))
    t(temErro(apFora), 'apagarPessoa com a organização errada recusado')
    const apOk = await tx(x => apagarPessoa(x, ORG, v28.id, tmp.id))
    t(!temErro(apOk), 'apagarPessoa apaga')

    // ── apagar UJ / natureza que a folha usa ─────────────────────────────────
    const rUj = await recusaApagarUnidadeJuridica(db, ORG, ujLP.id)
    t(!!rUj && /quadro de pessoal de 1 versão/.test(rUj), `apagar UJ com pessoas no quadro → recusa descritiva — ${rUj}`)
    t(await recusaApagarUnidadeJuridica(db, ORG, ujSimples.id) === null, 'apagar UJ sem pessoas → sem recusa')
    t(await recusaApagarUnidadeJuridica(db, VIZ, ujLP.id) === null, 'recusa de UJ não enxerga outra organização')
    const rCat = await recusaApagarNaturezaDaFolha(db, ORG, honorarios.id)
    t(!!rCat && /mapa de naturezas da folha/.test(rCat), `apagar natureza do mapa da folha → recusa descritiva — ${rCat}`)
    const [livre] = await db.insert(categories).values({
      organizationId: ORG, code: '5.1.98', name: 'Sem uso (teste)', type: salarios.type, parentId: salarios.parentId,
    }).returning({ id: categories.id })
    t(await recusaApagarNaturezaDaFolha(db, ORG, livre.id) === null, 'apagar natureza fora da folha → sem recusa')
    t(await recusaApagarNaturezaDaFolha(db, VIZ, honorarios.id) === null, 'recusa de natureza não enxerga outra organização')
    // Sem a recusa, o banco devolveria o 23503 cru: o RESTRICT continua lá.
    const fkCru = await db.delete(legalEntities).where(eq(legalEntities.id, ujLP.id)).then(() => null, (e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code)
    t(fkCru === '23503', `apagar a UJ direto no banco estoura 23503 — a recusa é o que evita isso (${fkCru})`)

    // ── (i) copiar quadro para 2028 ──────────────────────────────────────────
    await db.insert(budgetPeopleBenefits).values({ organizationId: ORG, personId: sClt.id, nome: 'VR', valorMensal: '500' })
    const i = await tx(x => copiarQuadro(x, ORG, USUARIO, v27.id, v28.id))
    t(!temErro(i) && i.pessoas === 2, `(i) copiar quadro: 2 pessoas — ${JSON.stringify(i)}`)
    const q28 = await lerQuadro(db, ORG, v28.id)
    if (!temErro(q28)) {
      t(q28.pessoas.map(p => p.nome).sort().join(',') === 'João PJ,Maria CLT', '(i) mesmas pessoas em 2028')
      t(q28.settings.modoProvisao === 'pagamento', '(i) parâmetros da versão copiados')
      const maria28 = q28.pessoas.find(p => p.nome === 'Maria CLT')
      t(maria28?.beneficios.length === 1 && maria28.alocacoes.length === 1, '(i) benefícios e alocações copiados')
      t(maria28?.id !== sClt.id, '(i) pessoa copiada tem id novo')
    } else t(false, `(i) lerQuadro 2028 — ${q28.error}`)
    const series28 = await db.select({ id: budgetSeries.id }).from(budgetSeries).where(eq(budgetSeries.versionId, v28.id))
    t(series28.length === 0, '(i) nenhuma série criada em 2028')
    const copFora = await tx(x => copiarQuadro(x, ORG, USUARIO, vViz.id, v28.id))
    t(temErro(copFora), 'copiar de versão de outra organização recusado')
    const copiaDeNovo = await tx(x => copiarQuadro(x, ORG, USUARIO, v27.id, v28.id))
    const pessoas28 = await db.select({ id: budgetPeople.id }).from(budgetPeople).where(eq(budgetPeople.versionId, v28.id))
    t(!temErro(copiaDeNovo) && pessoas28.length === 2, 'copiar de novo SUBSTITUI (continua com 2)')

    // Alocação partida e benefício viram séries próprias (2028).
    const ana = await tx(x => salvarPessoa(x, ORG, USUARIO, v28.id, {
      nome: 'Ana PJ', vinculo: 'pj', valorBase: 10000, mesesPj: [3],
      alocacoes: [{ costCenterId: cc.id, percentual: 60 }, { costCenterId: null, percentual: 40 }],
    }))
    const g28 = await tx(x => gerarFolha(x, ORG, USUARIO, v28.id))
    t(!temErro(ana) && !temErro(g28), `2028 gerado com a Ana — ${JSON.stringify(g28)}`)
    if (!temErro(ana)) {
      const partes = await db.execute<{ cc: string | null; valor: string }>(sql`
        SELECT s.cost_center_id::text AS cc, SUM(e.amount)::text AS valor
          FROM budget_series s JOIN budget_entries e ON e.series_id = s.id
         WHERE s.version_id = ${v28.id}::uuid AND s.metadata->'folha'->>'personId' = ${ana.id}
         GROUP BY s.id, s.cost_center_id ORDER BY 2 DESC`)
      t(partes.length === 2 && Number(partes[0].valor) === 6000 && partes[0].cc === cc.id && Number(partes[1].valor) === 4000 && partes[1].cc === null,
        `alocação 60/40 → duas séries, 6.000 no CC e 4.000 sem CC — ${JSON.stringify(partes)}`)
    }
    const vr = await db.execute<{ n: number; total: string }>(sql`
      SELECT COUNT(DISTINCT s.id)::int AS n, COALESCE(SUM(e.amount), 0)::text AS total
        FROM budget_series s JOIN budget_entries e ON e.series_id = s.id
       WHERE s.version_id = ${v28.id}::uuid AND s.metadata->'folha'->>'beneficio' = 'VR'`)
    t(Number(vr[0].n) === 1 && Number(vr[0].total) === 6000, `benefício VR = uma série de 12 × 500 — ${JSON.stringify(vr[0])}`)

    // ── protecoes: o orçamento existente não mexe na folha ───────────────────
    // Gera de novo: o benefício VR entrou direto no banco e o mapa mudou em (g).
    const gp = await tx(x => gerarFolha(x, ORG, USUARIO, v27.id))
    t(!temErro(gp) && await quadroDesatualizado(db, ORG, v27.id) === false, `protecoes: 2027 gerado de novo e em dia — ${JSON.stringify(gp)}`)
    const folhaDe = async (versionId: string) => {
      const [r] = await db.execute<{ n: number; soma: string; entries: number }>(sql`
        SELECT COUNT(DISTINCT s.id)::int AS n, COALESCE(SUM(e.amount), 0)::text AS soma, COUNT(e.id)::int AS entries
          FROM budget_series s LEFT JOIN budget_entries e ON e.series_id = s.id
         WHERE s.version_id = ${versionId}::uuid AND s.source = 'folha'`)
      return r
    }
    const antes = await folhaDe(v27.id)

    const carregar = async (id: string) => {
      const [s] = await db.select().from(budgetSeries).where(eq(budgetSeries.id, id))
      const es = await db.select().from(budgetEntries).where(eq(budgetEntries.seriesId, id)).orderBy(budgetEntries.sequence)
      return { s, es }
    }
    const [umaFolha] = await db.select({ id: budgetSeries.id }).from(budgetSeries)
      .where(and(eq(budgetSeries.versionId, v27.id), eq(budgetSeries.source, 'folha'))).limit(1)
    const fl = await carregar(umaFolha.id)
    const inputFolha = { ...seriesToInput(fl.s), versionId: v27.id, description: 'mexido à mão' }

    t(await recusaSeFolha(db, ORG, fl.s.id) === RECUSA_FOLHA, 'protecoes: recusaSeFolha numa série folha → RECUSA_FOLHA')
    t(await recusaSeFolha(db, ORG, manual.id) === null, 'protecoes: recusaSeFolha numa série manual → null')
    t(await recusaSeFolha(db, VIZ, fl.s.id) === null, 'protecoes: recusaSeFolha não enxerga série de outra organização')

    const upd = await tx(x => applySeriesUpdate(x, {
      organizationId: ORG, series: fl.s, entries: fl.es, input: inputFolha,
      plan: planSeriesUpdate(fl.s, fl.es, inputFolha, { scope: 'todas' }),
    }))
    t(temErro(upd) && upd.error === RECUSA_FOLHA, `protecoes: applySeriesUpdate numa série folha recusado — ${JSON.stringify(upd)}`)
    const del = await tx(x => applySeriesDelete(x, { series: fl.s, entries: fl.es, scope: 'todas' }))
    t(temErro(del) && del.error === RECUSA_FOLHA, `protecoes: applySeriesDelete numa série folha recusado — ${JSON.stringify(del)}`)
    const delEsta = await tx(x => applySeriesDelete(x, { series: fl.s, entries: fl.es, scope: 'esta', fromSequence: fl.es[0].sequence }))
    t(temErro(delEsta) && delEsta.error === RECUSA_FOLHA, 'protecoes: excluir uma ocorrência da série folha recusado')
    const depois = await carregar(fl.s.id)
    const depoisFolha = await folhaDe(v27.id)
    t(depois.s?.description === fl.s.description && depois.es.length === fl.es.length && depoisFolha.soma === antes.soma,
      'protecoes: a série folha ficou como estava')

    // Série manual: os mesmos caminhos funcionam.
    const mn = await carregar(manual.id)
    const inputManual = { ...seriesToInput(mn.s), versionId: v27.id, description: 'Aluguel manual (editado)' }
    const updM = await tx(x => applySeriesUpdate(x, {
      organizationId: ORG, series: mn.s, entries: mn.es, input: inputManual,
      plan: planSeriesUpdate(mn.s, mn.es, inputManual, { scope: 'todas' }),
    }))
    const mn2 = await carregar(manual.id)
    t(!temErro(updM) && mn2.s.description === 'Aluguel manual (editado)', `protecoes: applySeriesUpdate numa série manual funciona — ${JSON.stringify(updM)}`)

    // Caminho em lote com substituição (planilha): só apaga a própria origem.
    await db.insert(budgetSeries).values({
      organizationId: ORG, versionId: v27.id, description: 'Da planilha', direction: 'outflow',
      categoryId: honorarios.id, startMonth: '2027-01-01', occurrences: 1, amountMode: 'fixo', baseAmount: '10.00', source: 'csv',
    })
    const lote = await tx(x => applyDraftsToBudget(x, {
      organizationId: ORG, versionId: v27.id, userId: USUARIO, drafts: [], source: 'csv', notes: 'teste', replaceExisting: true,
    }))
    const posLote = await folhaDe(v27.id)
    t(lote.replaced === 1 && posLote.n === antes.n && posLote.soma === antes.soma,
      `protecoes: importar planilha com substituição apaga só as séries 'csv' — ${JSON.stringify({ lote, posLote })}`)

    // ── duplicar no mesmo exercício ──────────────────────────────────────────
    const pessoas27 = await db.select({ id: budgetPeople.id }).from(budgetPeople).where(eq(budgetPeople.versionId, v27.id))
    const dup = await tx(x => applyDuplicateVersion(x, {
      organizationId: ORG, sourceId: v27.id, name: 'Folha 2027 revisão', fiscalYear: 2027,
      description: null, isActive: false, userId: USUARIO, delta: 0,
    }))
    const dupFolha = await folhaDe(dup.versionId)
    t(dupFolha.n === antes.n && dupFolha.soma === antes.soma, `protecoes: a cópia tem as séries 'folha' com a mesma soma — ${JSON.stringify(dupFolha)}`)
    const viraramDup = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM budget_series s
       WHERE s.version_id = ${dup.versionId}::uuid AND s.metadata ? 'folha' AND s.source <> 'folha'`)
    t(Number(viraramDup[0].n) === 0, "protecoes: nenhuma série da folha virou 'duplicacao'")
    const manualDup = await db.select({ source: budgetSeries.source }).from(budgetSeries)
      .where(and(eq(budgetSeries.versionId, dup.versionId), eq(budgetSeries.description, 'Aluguel manual (editado)')))
    t(manualDup.length === 1 && manualDup[0].source === 'duplicacao', "protecoes: a série manual copiada continua 'duplicacao'")
    const qDup = await lerQuadro(db, ORG, dup.versionId)
    t(!temErro(qDup) && qDup.pessoas.length === pessoas27.length && pessoas27.length > 0,
      `protecoes: o quadro foi copiado (${temErro(qDup) ? qDup.error : qDup.pessoas.length} pessoas)`)
    t(await quadroDesatualizado(db, ORG, dup.versionId) === false, 'protecoes: a cópia no mesmo exercício não nasce desatualizada')
    const gDup = await tx(x => gerarFolha(x, ORG, USUARIO, dup.versionId))
    const dupFolha2 = await folhaDe(dup.versionId)
    t(!temErro(gDup) && gDup.substituidas === antes.n && dupFolha2.soma === antes.soma && dupFolha2.n === antes.n,
      `protecoes: gerar na cópia substitui as copiadas — mesmo total, sem dobrar — ${JSON.stringify({ gDup, dupFolha2 })}`)

    // ── quadro esvaziado depois de gerar: gerar de novo REMOVE a folha ───────
    const pessoasDup = await db.select({ id: budgetPeople.id }).from(budgetPeople).where(eq(budgetPeople.versionId, dup.versionId))
    for (const p of pessoasDup) await tx(x => apagarPessoa(x, ORG, dup.versionId, p.id))
    t(await quadroDesatualizado(db, ORG, dup.versionId) === true, 'vazio: quadro esvaziado depois de gerar → desatualizado')
    const pv = await preverFolha(db, ORG, dup.versionId)
    t(!temErro(pv) && pv.totalCentavos === 0 && pv.recusas.length === 0 && pv.seriesExistentes === antes.n,
      `vazio: prévia com total 0, sem recusas e ${antes.n} séries a remover — ${temErro(pv) ? pv.error : JSON.stringify({ total: pv.totalCentavos, recusas: pv.recusas.length, ex: pv.seriesExistentes })}`)
    const gVazio = await tx(x => gerarFolha(x, ORG, USUARIO, dup.versionId))
    const dupFolha3 = await folhaDe(dup.versionId)
    t(!temErro(gVazio) && gVazio.series === 0 && gVazio.entries === 0 && gVazio.substituidas === antes.n && dupFolha3.n === 0,
      `vazio: gerar com o quadro vazio apaga as ${antes.n} séries da folha e não grava nada — ${JSON.stringify({ gVazio, dupFolha3 })}`)
    t(await quadroDesatualizado(db, ORG, dup.versionId) === false, 'vazio: depois de remover, em dia (gerado_em gravado)')
    const [cfgDup] = await db.select({ g: budgetPayrollSettings.geradoEm }).from(budgetPayrollSettings)
      .where(eq(budgetPayrollSettings.versionId, dup.versionId))
    t(!!cfgDup?.g, 'vazio: gerado_em gravado na remoção')

    // ── duplicar para outro exercício ────────────────────────────────────────
    const dup28 = await tx(x => applyDuplicateVersion(x, {
      organizationId: ORG, sourceId: v27.id, name: 'Folha 2027 para 2028', fiscalYear: 2028,
      description: null, isActive: false, userId: USUARIO, delta: 1,
    }))
    const q28dup = await lerQuadro(db, ORG, dup28.versionId)
    t(!temErro(q28dup) && q28dup.pessoas.length === pessoas27.length, 'protecoes: duplicar para 2028 leva o quadro')
    t(await quadroDesatualizado(db, ORG, dup28.versionId) === true, 'protecoes: duplicar para 2028 → desatualizado')

    // ── versão sem quadro: duplicação como antes ─────────────────────────────
    const [v29] = await db.insert(budgetVersions).values({ organizationId: ORG, name: 'Sem folha 2029', fiscalYear: 2029 })
      .returning({ id: budgetVersions.id })
    await db.insert(budgetSeries).values({
      organizationId: ORG, versionId: v29.id, description: 'Só manual', direction: 'outflow',
      categoryId: honorarios.id, startMonth: '2029-01-01', occurrences: 1, amountMode: 'fixo', baseAmount: '10.00', source: 'manual',
    })
    const dup29 = await tx(x => applyDuplicateVersion(x, {
      organizationId: ORG, sourceId: v29.id, name: 'Sem folha 2029 cópia', fiscalYear: 2029,
      description: null, isActive: false, userId: USUARIO, delta: 0,
    }))
    const cfg29 = await db.select({ id: budgetPayrollSettings.id }).from(budgetPayrollSettings)
      .where(eq(budgetPayrollSettings.versionId, dup29.versionId))
    t(dup29.series === 1 && cfg29.length === 0, 'protecoes: versão sem quadro duplica como antes, sem criar parâmetros da folha')

    // Série manual: excluir funciona.
    const mn3 = await carregar(manual.id)
    const delM = await tx(x => applySeriesDelete(x, { series: mn3.s, entries: mn3.es, scope: 'todas' }))
    const sumiu = await db.select({ id: budgetSeries.id }).from(budgetSeries).where(eq(budgetSeries.id, manual.id))
    t(!temErro(delM) && sumiu.length === 0, `protecoes: applySeriesDelete numa série manual funciona — ${JSON.stringify(delM)}`)

    // ── (h) versão arquivada ─────────────────────────────────────────────────
    await db.update(budgetVersions).set({ status: 'arquivado' }).where(eq(budgetVersions.id, v27.id))
    const h1 = await tx(x => salvarPessoa(x, ORG, USUARIO, v27.id, clt, sClt.id))
    const h2 = await tx(x => gerarFolha(x, ORG, USUARIO, v27.id))
    t(temErro(h1) && /arquivada/.test(h1.error), `(h) salvarPessoa em versão arquivada recusado — ${JSON.stringify(h1)}`)
    t(temErro(h2) && /arquivada/.test(h2.error), `(h) gerarFolha em versão arquivada recusado — ${JSON.stringify(h2)}`)

    // ── (j) natureza do mapa arquivada ───────────────────────────────────────
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, salarios.id))
    const j = await preverFolha(db, ORG, v28.id)
    const motivosJ = temErro(j) ? [j.error] : j.recusas.map(r => r.motivo)
    t(!temErro(j) && j.recusas.length > 0 && motivosJ.some(m => m.includes('Salário')),
      `(j) natureza arquivada → prévia recusa — ${JSON.stringify(motivosJ.slice(0, 2))}`)

    // ── (k) isolamento ───────────────────────────────────────────────────────
    const minhasVersoes = [v27.id, v28.id]
    const pessoasMinhas = await db.select({ id: budgetPeople.id, org: budgetPeople.organizationId }).from(budgetPeople)
      .where(inArray(budgetPeople.versionId, minhasVersoes))
    const idsPessoas = pessoasMinhas.map(p => p.id)
    t(pessoasMinhas.every(p => p.org === ORG), '(k) pessoas das versões de teste são todas da organização de teste')
    const alocFora = await db.select({ id: budgetPeopleAllocations.id }).from(budgetPeopleAllocations)
      .where(and(inArray(budgetPeopleAllocations.personId, idsPessoas), ne(budgetPeopleAllocations.organizationId, ORG)))
    const benFora = await db.select({ id: budgetPeopleBenefits.id }).from(budgetPeopleBenefits)
      .where(and(inArray(budgetPeopleBenefits.personId, idsPessoas), ne(budgetPeopleBenefits.organizationId, ORG)))
    t(alocFora.length === 0 && benFora.length === 0, '(k) alocações e benefícios das pessoas de teste levam a organização de teste')
    const seriesFora = await db.select({ id: budgetSeries.id }).from(budgetSeries)
      .where(and(inArray(budgetSeries.versionId, minhasVersoes), ne(budgetSeries.organizationId, ORG)))
    const entriesFora = await db.select({ id: budgetEntries.id }).from(budgetEntries)
      .where(and(inArray(budgetEntries.versionId, minhasVersoes), ne(budgetEntries.organizationId, ORG)))
    const settingsFora = await db.select({ id: budgetPayrollSettings.id }).from(budgetPayrollSettings)
      .where(and(inArray(budgetPayrollSettings.versionId, minhasVersoes), ne(budgetPayrollSettings.organizationId, ORG)))
    const settingsViz = await db.select({ id: budgetPayrollSettings.id }).from(budgetPayrollSettings)
      .where(eq(budgetPayrollSettings.versionId, vViz.id))
    t(settingsViz.length === 0, '(k) a versão da vizinha não ganhou parâmetros da folha')
    t(seriesFora.length === 0 && entriesFora.length === 0 && settingsFora.length === 0, '(k) séries, ocorrências e parâmetros sem vazamento de organização')
    const vizinhaIntocada = await db.select({ id: budgetPeople.id }).from(budgetPeople).where(eq(budgetPeople.organizationId, VIZ))
    const mapaViz = await db.select({ c: payrollCategoryMap.componente }).from(payrollCategoryMap).where(eq(payrollCategoryMap.organizationId, VIZ))
    t(vizinhaIntocada.length === 0 && mapaViz.length === 0, '(k) a organização vizinha não ganhou pessoa nem mapa')
    const evFora = await db.select({ id: agentEvents.id }).from(agentEvents)
      .where(and(inArray(agentEvents.entityId, minhasVersoes), ne(agentEvents.organizationId, ORG)))
    t(evFora.length === 0, '(k) eventos das versões de teste só na organização de teste')
  } finally {
    await limpar(criadas)
    const sobrou = await db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.name, [NOME_ORG, NOME_VIZINHA]))
    t(sobrou.length === 0, 'organizações de teste removidas')
  }

  console.log(`\n${ok} ok · ${falhas} falhas`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
