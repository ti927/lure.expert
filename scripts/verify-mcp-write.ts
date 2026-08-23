/**
 * Exercita as ferramentas de ESCRITA do MCP contra um `next start` de verdade.
 *
 *   npx next build
 *   DATABASE_URL="<pooler>" npx next start -p 3100 &
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-mcp-write.ts
 *
 * Ao contrário do teste de leitura, este ESCREVE — e escrever no dado de um
 * cliente para testar seria reclassificar a contabilidade dele. Então o teste
 * cria a própria organização, com usuário sintético e lançamentos próprios, e a
 * apaga no fim (o CASCADE leva lançamentos, categorias, regras e eventos).
 *
 * Nada de real é tocado. Se o script morrer no meio, a organização sobra com o
 * nome `ZZ Teste MCP escrita` e a execução seguinte a remove.
 */
import { db } from '@/db'
import {
  oauthClients, organizations, memberships, transactions, categories,
  categorizationRules, costCenters, transactionAllocations, dataSources,
  allocationTemplates, allocationTemplateLines, budgetVersions,
} from '@/db/schema'
import { and, eq, like, sql, isNotNull } from 'drizzle-orm'
import { garantirGrant, emitirTokens } from '@/lib/oauth/store'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const RECURSO = `${BASE}/api/mcp`
const NOME_ORG = 'ZZ Teste MCP escrita'
const USUARIO = '33333333-3333-3333-3333-333333333333'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

let proximoId = 1
async function rpc(token: string, method: string, params?: unknown) {
  const r = await fetch(RECURSO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: proximoId++, method, ...(params ? { params } : {}) }),
  })
  return JSON.parse(await r.text()) as Record<string, unknown>
}

async function chamar(token: string, name: string, args: Record<string, unknown>) {
  const resp = await rpc(token, 'tools/call', { name, arguments: args })
  const result = (resp.result ?? {}) as Record<string, unknown>
  const erroProtocolo = resp.error as { code: number; message: string } | undefined
  const conteudo = (result.content ?? []) as { text: string }[]
  const texto = conteudo.map(c => c.text).join('\n')
  let dados: unknown = result.structuredContent
  if (dados === undefined) { try { dados = JSON.parse(texto) } catch { dados = null } }
  return { dados, isError: result.isError === true, texto, erroProtocolo }
}

async function limpar() {
  await db.delete(oauthClients).where(like(oauthClients.clientName, 'ZZ Teste MCP%'))
  await db.delete(organizations).where(eq(organizations.name, NOME_ORG))
}

async function main() {
  await limpar()

  // ═══ Cenário isolado ══════════════════════════════════════════════════════
  const [org] = await db.insert(organizations).values({
    name: NOME_ORG, slug: `zz-teste-mcp-escrita-${Date.now()}`,
  }).returning({ id: organizations.id })
  const ORG = org.id

  await db.insert(memberships).values({
    userId: USUARIO, organizationId: ORG, role: 'owner', acceptedAt: new Date(),
  })

  // O gatilho de INSERT em `organizations` semeia o plano de contas — é dele que
  // saem as naturezas de verdade que o teste vai usar como destino.
  const [{ n: semeadas }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM categories WHERE organization_id = ${ORG}::uuid`)
  t(Number(semeadas) > 0, `plano de contas semeado pelo gatilho (${semeadas} naturezas)`)

  const [cc] = await db.insert(costCenters).values({
    organizationId: ORG, name: 'Comercial',
  }).returning({ id: costCenters.id })

  // `transactions.data_source_id` é NOT NULL — todo lançamento vem de alguma
  // origem, mesmo os digitados.
  const [fonte] = await db.insert(dataSources).values({
    organizationId: ORG, type: 'manual', provider: 'teste', name: 'Origem de teste',
  }).returning({ id: dataSources.id })

  const lancamentos = [
    { desc: 'UBER *TRIP 001', valor: '250.00' },
    { desc: 'UBER *TRIP 002', valor: '310.00' },
    { desc: 'UBER *TRIP 003', valor: '120.00' },  // abaixo de 200, fica de fora
    { desc: 'POSTO IPIRANGA', valor: '400.00' },  // outra descrição
  ]
  await db.insert(transactions).values(lancamentos.map(l => ({
    organizationId: ORG, dataSourceId: fonte.id, date: '2026-03-10', amount: l.valor,
    direction: 'outflow', description: l.desc, status: 'confirmed',
  })))

  // Um lançamento RATEADO, para provar que ele fica de fora quando a
  // classificação mexe em dimensão. As partes entram na mesma transação porque
  // a soma exata é conferida por gatilho deferido até o commit.
  await db.transaction(async (tx) => {
    const [pai] = await tx.insert(transactions).values({
      organizationId: ORG, dataSourceId: fonte.id, date: '2026-03-11', amount: '100.00',
      direction: 'outflow', description: 'UBER *TRIP RATEADA', status: 'confirmed',
    }).returning({ id: transactions.id })
    await tx.insert(transactionAllocations).values([
      { organizationId: ORG, transactionId: pai.id, sequence: 1, amount: '60.00', costCenterId: cc.id },
      { organizationId: ORG, transactionId: pai.id, sequence: 2, amount: '40.00' },
    ])
  })

  // ═══ Dois consentimentos: um só de leitura, outro com escrita ════════════
  console.log('\n── escopo ──')

  await db.insert(oauthClients).values([
    { clientId: 'zz_cli_leitura', clientName: 'ZZ Teste MCP leitura', redirectUris: [`${BASE}/cb`] },
    { clientId: 'zz_cli_escrita', clientName: 'ZZ Teste MCP escrita', redirectUris: [`${BASE}/cb`] },
  ])
  const grantL = await garantirGrant({ userId: USUARIO, clientId: 'zz_cli_leitura', organizationIds: [ORG], scopes: ['leitura'] })
  const grantE = await garantirGrant({ userId: USUARIO, clientId: 'zz_cli_escrita', organizationIds: [ORG], scopes: ['leitura', 'escrita'] })
  const { accessToken: soLeitura } = await emitirTokens(grantL, RECURSO, ['leitura'])
  const { accessToken: comEscrita } = await emitirTokens(grantE, RECURSO, ['leitura', 'escrita'])

  const catalogoL = ((await rpc(soLeitura, 'tools/list')).result as { tools: { name: string }[] }).tools
  t(!catalogoL.some(f => f.name.startsWith('prever_') || f.name.startsWith('aplicar_')),
    `consentimento de leitura NÃO enxerga as ferramentas de escrita (${catalogoL.length} ferramentas)`)

  const tentativa = await chamar(soLeitura, 'prever_classificacao_em_lote', {
    organizationId: ORG, filtro: { descricaoContem: 'UBER' }, destino: { categoryId: null },
  })
  t(tentativa.erroProtocolo?.code === -32601,
    'e chamá-la mesmo assim dá -32601 — não enxergar é mais forte que recusar')

  const catalogoE = ((await rpc(comEscrita, 'tools/list')).result as { tools: { name: string }[] }).tools
  t(catalogoE.length === catalogoL.length + 8,
    `com escrita, o catálogo ganha os QUATRO pares prever_/aplicar_ (${catalogoE.length} ferramentas)`)

  // ═══ Naturezas ════════════════════════════════════════════════════════════
  console.log('\n── catálogos ──')

  const cats = await chamar(comEscrita, 'listar_categorias', { organizationId: ORG, busca: 'via' })
  const naturezas = (cats.dados as { naturezas: { id: string; nome: string; atribuivel: boolean }[] })?.naturezas ?? []
  t(naturezas.length > 0, `listar_categorias com busca devolve ${naturezas.length} natureza(s)`)

  const [folha] = await db.select({ id: categories.id, nome: categories.name })
    .from(categories)
    .where(and(
      eq(categories.organizationId, ORG),
      isNotNull(categories.parentId),
      sql`NOT EXISTS (SELECT 1 FROM categories f WHERE f.parent_id = ${categories.id})`,
    ))
    .limit(1)
  const [paiComFilho] = await db.select({ id: categories.id })
    .from(categories)
    .where(and(
      eq(categories.organizationId, ORG),
      sql`EXISTS (SELECT 1 FROM categories f WHERE f.parent_id = ${categories.id})`,
    ))
    .limit(1)

  const dims = await chamar(comEscrita, 'listar_dimensoes', { organizationId: ORG, quais: ['centro_de_custo'] })
  t(((dims.dados as { centrosDeCusto: unknown[] })?.centrosDeCusto ?? []).length === 1,
    'listar_dimensoes devolve o centro de custo cadastrado')

  // ═══ Prévia: as recusas ═══════════════════════════════════════════════════
  console.log('\n── prévia: o que ela recusa ──')

  const vazio = await chamar(comEscrita, 'prever_classificacao_em_lote', {
    organizationId: ORG, filtro: {}, destino: { categoryId: folha.id },
  })
  t(vazio.isError && vazio.texto.includes('critério'),
    'filtro VAZIO é recusado — casaria com a base inteira da organização')

  const emPai = await chamar(comEscrita, 'prever_classificacao_em_lote', {
    organizationId: ORG, filtro: { descricaoContem: 'UBER' }, destino: { categoryId: paiComFilho.id },
  })
  t(emPai.isError && emPai.texto.includes('subcategorias'),
    'natureza PAI é recusada — só folha pode receber lançamento')

  const semDestino = await chamar(comEscrita, 'prever_classificacao_em_lote', {
    organizationId: ORG, filtro: { descricaoContem: 'UBER' }, destino: {},
  })
  t(semDestino.isError, 'destino vazio é recusado')

  const semCasar = await chamar(comEscrita, 'prever_classificacao_em_lote', {
    organizationId: ORG, filtro: { descricaoContem: 'NAO_EXISTE_ISSO' }, destino: { categoryId: folha.id },
  })
  t((semCasar.dados as { previaId: string | null })?.previaId === null,
    'filtro que não casa com nada não gera prévia — não há o que aplicar')

  // ═══ Prévia: o resumo ═════════════════════════════════════════════════════
  console.log('\n── prévia: o que ela mostra ──')

  const previa = await chamar(comEscrita, 'prever_classificacao_em_lote', {
    organizationId: ORG,
    filtro: { descricaoContem: 'UBER', valorMinimo: 200 },
    destino: { categoryId: folha.id },
  })
  const p = previa.dados as {
    previaId: string
    resumo: { quantidade: number; valorTotal: number; regrasAfetadas: number; amostra: unknown[] }
  }
  t(p.resumo.quantidade === 2, `atinge 2 lançamentos — o de R$ 120 ficou fora pelo valor (${p.resumo.quantidade})`)
  t(Math.abs(p.resumo.valorTotal - 560) < 0.01, `soma R$ ${p.resumo.valorTotal.toFixed(2)} (250 + 310)`)
  t(p.resumo.regrasAfetadas === 2, 'diz que criará 2 regras — descrições diferentes, regras diferentes')
  t(p.resumo.amostra.length === 2, 'traz amostra para o usuário conferir antes de aceitar')
  t(typeof p.previaId === 'string', 'devolve um previaId')

  // Rateado só é excluído quando a classificação mexe em DIMENSÃO; a natureza
  // de um lançamento rateado continua sendo uma só, e pode ser alterada.
  const comDimensao = await chamar(comEscrita, 'prever_classificacao_em_lote', {
    organizationId: ORG, filtro: { descricaoContem: 'UBER' }, destino: { costCenterId: cc.id },
  })
  const pd = comDimensao.dados as { resumo: { rateadosExcluidos: number; quantidade: number } }
  t(pd.resumo.rateadosExcluidos === 1,
    'ao mexer em dimensão, o lançamento RATEADO fica de fora e a prévia diz isso')
  t(pd.resumo.quantidade === 3,
    'e os 3 não rateados seguem no lote (o gatilho do banco recusaria o rateado)')

  // ═══ Aplicação: os dentes ═════════════════════════════════════════════════
  console.log('\n── aplicação: o que ela recusa ──')

  const semPalavra = await chamar(comEscrita, 'aplicar_classificacao_em_lote', {
    organizationId: ORG, previaId: p.previaId, confirmacao: 'sim',
  })
  t(semPalavra.isError && semPalavra.texto.includes('aplicar'),
    'sem a palavra literal "aplicar", recusa')

  const previaInventada = await chamar(comEscrita, 'aplicar_classificacao_em_lote', {
    organizationId: ORG, previaId: '00000000-0000-0000-0000-000000000000', confirmacao: 'aplicar',
  })
  t(previaInventada.isError && previaInventada.texto.includes('não encontrada'),
    'previaId inventado: recusa')

  // ── O dente principal: o mundo mudou entre prever e aplicar ──────────────
  await db.insert(transactions).values({
    organizationId: ORG, dataSourceId: fonte.id, date: '2026-03-12', amount: '999.00',
    direction: 'outflow', description: 'UBER *TRIP 004', status: 'confirmed',
  })

  const divergente = await chamar(comEscrita, 'aplicar_classificacao_em_lote', {
    organizationId: ORG, previaId: p.previaId, confirmacao: 'aplicar',
  })
  t(divergente.isError && divergente.texto.includes('2') && divergente.texto.includes('3'),
    'entrou um lançamento novo no filtro: RECUSA, dizendo 2 → 3 — nada foi aplicado')

  const [{ n: intactos }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM transactions
    WHERE organization_id = ${ORG}::uuid AND category_id IS NOT NULL`)
  t(Number(intactos) === 0, 'e nenhum lançamento foi tocado pela tentativa recusada')

  // ═══ Aplicação: o caminho feliz ═══════════════════════════════════════════
  console.log('\n── aplicação: o caminho feliz ──')

  const previa2 = await chamar(comEscrita, 'prever_classificacao_em_lote', {
    organizationId: ORG,
    filtro: { descricaoContem: 'UBER', valorMinimo: 200 },
    destino: { categoryId: folha.id },
  })
  const p2 = previa2.dados as { previaId: string; resumo: { quantidade: number } }
  t(p2.resumo.quantidade === 3, 'a prévia nova já conta os 3 — inclusive o que entrou depois')

  const aplicado = await chamar(comEscrita, 'aplicar_classificacao_em_lote', {
    organizationId: ORG, previaId: p2.previaId, confirmacao: 'aplicar',
  })
  const res = aplicado.dados as { aplicado: boolean; lancamentosAtualizados: number; regrasAfetadas: number }
  t(!aplicado.isError && res.lancamentosAtualizados === 3, `aplicou em ${res.lancamentosAtualizados} lançamentos`)
  t(res.regrasAfetadas === 3, `gravou ${res.regrasAfetadas} regras — uma por descrição única`)

  const [{ n: classificados }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM transactions
    WHERE organization_id = ${ORG}::uuid AND category_id = ${folha.id}::uuid`)
  t(Number(classificados) === 3, 'e o banco confirma: 3 lançamentos com a natureza gravada')

  const [{ n: naoTocado }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM transactions
    WHERE organization_id = ${ORG}::uuid AND category_id IS NULL`)
  t(Number(naoTocado) === 3, 'o de R$ 120, o POSTO e o rateado seguem sem natureza — o filtro foi respeitado')

  const regras = await db.select({ id: categorizationRules.id })
    .from(categorizationRules).where(eq(categorizationRules.organizationId, ORG))
  t(regras.length === 3, `${regras.length} regras no banco — importações futuras caem sozinhas`)

  const reaplicar = await chamar(comEscrita, 'aplicar_classificacao_em_lote', {
    organizationId: ORG, previaId: p2.previaId, confirmacao: 'aplicar',
  })
  t(reaplicar.isError && reaplicar.texto.includes('já foi aplicada'),
    'a MESMA prévia não aplica duas vezes — consumo atômico')

  // ═══ Rateio ═══════════════════════════════════════════════════════════════
  console.log('\n── rateio: pesos e centavos ──')

  const [modelo] = await db.insert(allocationTemplates).values({
    organizationId: ORG, name: 'Comercial 60 / resto 40',
  }).returning({ id: allocationTemplates.id })
  await db.insert(allocationTemplateLines).values([
    { organizationId: ORG, templateId: modelo.id, sequence: 1, weight: '3', costCenterId: cc.id },
    { organizationId: ORG, templateId: modelo.id, sequence: 2, weight: '2' },
  ])

  const modelos = await chamar(comEscrita, 'listar_modelos_de_rateio', { organizationId: ORG })
  const listaModelos = (modelos.dados as { modelos: { id: string; partes: { percentual: number }[] }[] })?.modelos ?? []
  t(listaModelos.length === 1 && listaModelos[0].partes.length === 2,
    'listar_modelos_de_rateio devolve o modelo com suas partes')
  t(Math.abs(listaModelos[0].partes[0].percentual - 60) < 0.01,
    `peso 3:2 é exibido como ${listaModelos[0].partes[0].percentual}% — o modelo guarda PROPORÇÃO, não percentual`)

  const ambos = await chamar(comEscrita, 'prever_rateio_em_lote', {
    organizationId: ORG, filtro: { descricaoContem: 'POSTO' },
    modeloId: modelo.id, pesos: [{ peso: 1 }],
  })
  t(ambos.isError && ambos.texto.includes('OU'),
    'modeloId E pesos juntos: recusa — não há como saber qual deve valer')

  const nenhum = await chamar(comEscrita, 'prever_rateio_em_lote', {
    organizationId: ORG, filtro: { descricaoContem: 'POSTO' },
  })
  t(nenhum.isError, 'sem modeloId e sem pesos: recusa')

  // R$ 400 em 60/40 → 240 / 160, exato.
  const rat = await chamar(comEscrita, 'prever_rateio_em_lote', {
    organizationId: ORG, filtro: { descricaoContem: 'POSTO' }, modeloId: modelo.id,
  })
  const pr = rat.dados as {
    previaId: string
    resumo: { quantidade: number; valorTotal: number; proporcao: string; amostra: { partes: number[] }[] }
  }
  t(pr.resumo.quantidade === 1, 'atinge o único POSTO')
  t(JSON.stringify(pr.resumo.amostra[0].partes) === '[240,160]',
    `R$ 400 em 3:2 vira ${JSON.stringify(pr.resumo.amostra[0].partes)} — fecha no centavo`)
  t(pr.resumo.proporcao.includes('60'), `a proporção é declarada legível (${pr.resumo.proporcao})`)

  const aplicRat = await chamar(comEscrita, 'aplicar_rateio_em_lote', {
    organizationId: ORG, previaId: pr.previaId, confirmacao: 'aplicar',
  })
  t(!aplicRat.isError && (aplicRat.dados as { lancamentosRateados: number }).lancamentosRateados === 1,
    'aplica o rateio')

  const [conf] = await db.execute<{ partes: number; soma: string; total: string; dimNoPai: number }>(sql`
    SELECT COUNT(a.id)::int AS partes,
           COALESCE(SUM(a.amount), 0)::text AS soma,
           MAX(t.amount)::text AS total,
           COUNT(*) FILTER (WHERE t.cost_center_id IS NOT NULL)::int AS "dimNoPai"
    FROM transactions t JOIN transaction_allocations a ON a.transaction_id = t.id
    WHERE t.organization_id = ${ORG}::uuid AND t.description = 'POSTO IPIRANGA'`)
  t(Number(conf.partes) === 2 && Number(conf.soma) === Number(conf.total),
    `as 2 partes somam R$ ${conf.soma}, exatamente o valor do lançamento`)
  t(Number(conf.dimNoPai) === 0,
    'e o lançamento pai ficou SEM dimensão — com rateio, a classificação vive nas partes')

  const [antesDoTerco] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(a.id)::int AS n FROM transactions t
    JOIN transaction_allocations a ON a.transaction_id = t.id
    WHERE t.organization_id = ${ORG}::uuid AND t.description = 'UBER *TRIP RATEADA'`)
  console.log(`     (o lançamento RATEADA tem ${antesDoTerco.n} partes no banco agora)`)

  // O maior resto: R$ 100 em três partes iguais não divide redondo.
  const terco = await chamar(comEscrita, 'prever_rateio_em_lote', {
    organizationId: ORG,
    filtro: { descricaoContem: 'RATEADA' },
    pesos: [{ peso: 1 }, { peso: 1 }, { peso: 1 }],
  })
  const pt = terco.dados as { previaId: string; resumo: { jaRateados: number; amostra: { partes: number[] }[] } }
  const partesTerco = pt.resumo.amostra[0].partes
  t(partesTerco.reduce((a, b) => a + b, 0) === 100,
    `R$ 100 em três partes: ${JSON.stringify(partesTerco)} — a sobra do centavo aparece na prévia`)
  t(pt.resumo.jaRateados === 1,
    `e a prévia avisa que o lançamento já era rateado e será SUBSTITUÍDO (jaRateados=${pt.resumo.jaRateados})`)

  const aplicTerco = await chamar(comEscrita, 'aplicar_rateio_em_lote', {
    organizationId: ORG, previaId: pt.previaId, confirmacao: 'aplicar',
  })
  t(!aplicTerco.isError, 'aplica sobre o que já era rateado')

  const [subst] = await db.execute<{ partes: number; soma: string }>(sql`
    SELECT COUNT(a.id)::int AS partes, COALESCE(SUM(a.amount), 0)::text AS soma
    FROM transactions t JOIN transaction_allocations a ON a.transaction_id = t.id
    WHERE t.organization_id = ${ORG}::uuid AND t.description = 'UBER *TRIP RATEADA'`)
  t(Number(subst.partes) === 3 && Number(subst.soma) === 100,
    `o rateio anterior de 2 partes foi substituído por ${subst.partes}, somando R$ ${subst.soma}`)

  const modeloAlheio = await chamar(comEscrita, 'prever_rateio_em_lote', {
    organizationId: ORG, filtro: { descricaoContem: 'POSTO' },
    modeloId: '00000000-0000-0000-0000-000000000000',
  })
  t(modeloAlheio.isError && modeloAlheio.texto.includes('não encontrado'),
    'modelo que não é desta empresa: recusa')

  // ═══ Orçamento ════════════════════════════════════════════════════════════
  console.log('\n── orçamento ──')

  const [versao] = await db.insert(budgetVersions).values({
    organizationId: ORG, name: 'Orçamento 2026', fiscalYear: 2026, status: 'rascunho', isActive: true,
  }).returning({ id: budgetVersions.id })
  const [arquivada] = await db.insert(budgetVersions).values({
    organizationId: ORG, name: 'Orçamento 2025', fiscalYear: 2025, status: 'arquivado',
  }).returning({ id: budgetVersions.id })

  const versoes = await chamar(comEscrita, 'listar_versoes_de_orcamento', { organizationId: ORG })
  t(((versoes.dados as { versoes: unknown[] })?.versoes ?? []).length === 2,
    'listar_versoes_de_orcamento devolve as duas versões')

  const emArquivada = await chamar(comEscrita, 'prever_lancamento_de_orcamento', {
    organizationId: ORG, versionId: arquivada.id, descricao: 'Aluguel',
    categoryId: folha.id, direcao: 'outflow', mesInicial: '2025-01', valorMensal: 1000,
  })
  t(emArquivada.isError && emArquivada.texto.includes('arquivada'),
    'versão arquivada é somente leitura — recusa com o motivo')

  const semValor = await chamar(comEscrita, 'prever_lancamento_de_orcamento', {
    organizationId: ORG, versionId: versao.id, descricao: 'Aluguel',
    categoryId: folha.id, direcao: 'outflow', mesInicial: '2026-01',
  })
  t(semValor.isError && semValor.texto.includes('valorMensal'),
    'sem nenhum campo de valor: recusa dizendo quais existem')

  const doisValores = await chamar(comEscrita, 'prever_lancamento_de_orcamento', {
    organizationId: ORG, versionId: versao.id, descricao: 'Aluguel', categoryId: folha.id,
    direcao: 'outflow', mesInicial: '2026-01', valorMensal: 1000, valorTotal: 12000,
  })
  t(doisValores.isError && doisValores.texto.includes('apenas UM'),
    'dois campos de valor juntos: recusa — o modo seria ambíguo')

  const foraDoExercicio = await chamar(comEscrita, 'prever_lancamento_de_orcamento', {
    organizationId: ORG, versionId: versao.id, descricao: 'Aluguel', categoryId: folha.id,
    direcao: 'outflow', mesInicial: '2027-06', valorMensal: 1000, ocorrencias: 3,
  })
  t(foraDoExercicio.isError,
    'competência fora do exercício da versão: recusa — exercício é ano civil')

  const emPaiOrc = await chamar(comEscrita, 'prever_lancamento_de_orcamento', {
    organizationId: ORG, versionId: versao.id, descricao: 'Aluguel', categoryId: paiComFilho.id,
    direcao: 'outflow', mesInicial: '2026-01', valorMensal: 1000,
  })
  t(emPaiOrc.isError && emPaiOrc.texto.includes('folha'),
    'natureza pai também é recusada no orçamento')

  // Prazo de caixa: a competência é em janeiro, o dinheiro sai 30 dias depois.
  const orc = await chamar(comEscrita, 'prever_lancamento_de_orcamento', {
    organizationId: ORG, versionId: versao.id, descricao: 'Aluguel da sede',
    categoryId: folha.id, direcao: 'outflow', mesInicial: '2026-01',
    valorMensal: 1000, ocorrencias: 12, prazoDeCaixaDias: 30, diaDoMes: 5,
  })
  const po = orc.dados as {
    previaId: string
    resumo: { quantidade: number; valorTotal: number; modo: string; ocorrencias: { competencia: string; caixa: string }[] }
  }
  t(po.resumo.quantidade === 12 && po.resumo.valorTotal === 12000,
    `12 ocorrências somando R$ ${po.resumo.valorTotal}`)
  t(po.resumo.modo === 'fixo', 'modo deduzido de valorMensal: fixo')
  t(po.resumo.ocorrencias[0].competencia === '2026-01-05'
    && po.resumo.ocorrencias[0].caixa === '2026-02-04',
    `duas datas por ocorrência: competência ${po.resumo.ocorrencias[0].competencia}, ` +
    `caixa ${po.resumo.ocorrencias[0].caixa} — 30 dias depois`)

  const aplicOrc = await chamar(comEscrita, 'aplicar_lancamento_de_orcamento', {
    organizationId: ORG, previaId: po.previaId, confirmacao: 'aplicar',
  })
  t(!aplicOrc.isError && (aplicOrc.dados as { ocorrenciasGravadas: number }).ocorrenciasGravadas === 12,
    'grava as 12 ocorrências')

  const [gravado] = await db.execute<{ series: number; entries: number; soma: string }>(sql`
    SELECT (SELECT COUNT(*)::int FROM budget_series  WHERE organization_id = ${ORG}::uuid) AS series,
           (SELECT COUNT(*)::int FROM budget_entries WHERE organization_id = ${ORG}::uuid) AS entries,
           (SELECT COALESCE(SUM(amount),0)::text FROM budget_entries WHERE organization_id = ${ORG}::uuid) AS soma`)
  t(Number(gravado.series) === 1 && Number(gravado.entries) === 12 && Number(gravado.soma) === 12000,
    `banco: 1 série, ${gravado.entries} ocorrências, R$ ${gravado.soma}`)

  // Reajuste: 5% a cada 12 meses não muda nada dentro de um exercício de 12.
  const sazonal = await chamar(comEscrita, 'prever_lancamento_de_orcamento', {
    organizationId: ORG, versionId: versao.id, descricao: 'Comissões',
    categoryId: folha.id, direcao: 'outflow', mesInicial: '2026-01',
    valoresMensais: [100, 200, 300],
  })
  const ps = sazonal.dados as { previaId: string; resumo: { modo: string; quantidade: number; valorTotal: number } }
  t(ps.resumo.modo === 'sazonal' && ps.resumo.quantidade === 3 && ps.resumo.valorTotal === 600,
    'valoresMensais deduz modo sazonal e as ocorrências vêm da lista (3, somando 600)')

  // ── Cópia do realizado ───────────────────────────────────────────────────
  const copia = await chamar(comEscrita, 'prever_copia_do_realizado', {
    organizationId: ORG, versionId: versao.id,
    deMes: '2026-03', ateMes: '2026-03', ajustePct: 10,
  })
  const pc = copia.dados as {
    previaId: string
    resumo: { quantidade: number; valorTotal: number; semCategoria: { count: number } }
    avisos?: string[]
  }
  t(pc.resumo.quantidade > 0, `a cópia gera ${pc.resumo.quantidade} lançamento(s) do realizado de março`)
  t(pc.resumo.semCategoria.count > 0 && (pc.avisos ?? []).some(a => a.includes('sem natureza')),
    `avisa que ${pc.resumo.semCategoria.count} lançamento(s) sem natureza ficaram de fora`)

  // O dente da prévia, no orçamento: classificar um lançamento muda o realizado.
  await db.update(transactions).set({ categoryId: folha.id })
    .where(and(eq(transactions.organizationId, ORG), eq(transactions.description, 'POSTO IPIRANGA')))

  const copiaVelha = await chamar(comEscrita, 'aplicar_copia_do_realizado', {
    organizationId: ORG, previaId: pc.previaId, confirmacao: 'aplicar',
  })
  t(copiaVelha.isError,
    'classificar um lançamento mudou o realizado: a prévia da cópia é RECUSADA')

  const copia2 = await chamar(comEscrita, 'prever_copia_do_realizado', {
    organizationId: ORG, versionId: versao.id,
    deMes: '2026-03', ateMes: '2026-03', ajustePct: 10,
  })
  const pc2 = copia2.dados as { previaId: string; resumo: { quantidade: number; valorTotal: number } }
  const aplicCopia = await chamar(comEscrita, 'aplicar_copia_do_realizado', {
    organizationId: ORG, previaId: pc2.previaId, confirmacao: 'aplicar',
  })
  t(!aplicCopia.isError, `aplica a cópia (${pc2.resumo.quantidade} lançamentos)`)

  const [aposCopia] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM budget_series
    WHERE organization_id = ${ORG}::uuid AND source = 'copia_realizado'`)
  t(Number(aposCopia.n) === pc2.resumo.quantidade,
    `${aposCopia.n} séries nasceram com source='copia_realizado' — separáveis do que foi lançado à mão`)

  // ═══ Auditoria ════════════════════════════════════════════════════════════
  console.log('\n── auditoria ──')

  const [aud] = await db.execute<{ previas: number; aplicadas: number }>(sql`
    SELECT COUNT(*) FILTER (WHERE type = 'mcp_preview')::int AS previas,
           COUNT(*) FILTER (WHERE type = 'mcp_applied')::int AS aplicadas
    FROM agent_events WHERE organization_id = ${ORG}::uuid`)
  t(Number(aud.previas) > 0 && Number(aud.aplicadas) === 5,
    `${aud.previas} prévias e ${aud.aplicadas} aplicações registradas — classificação, dois rateios, ` +
    'um lançamento orçado e uma cópia do realizado')

  const [carimbo] = await db.execute<{ tem: boolean }>(sql`
    SELECT (payload ? 'confirmed_at' AND payload ? 'applied_at') AS tem
    FROM agent_events WHERE organization_id = ${ORG}::uuid AND type = 'mcp_applied' LIMIT 1`)
  t(carimbo?.tem === true, 'a aplicação carrega confirmed_at e applied_at, como o princípio 10 pede')

  await limpar()
  const [{ n: sobrou }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM transactions WHERE organization_id = ${ORG}::uuid`)
  t(Number(sobrou) === 0, 'limpeza: apagar a organização de teste levou tudo junto')

  console.log(`\n${ok} ok, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('ERRO:', e)
  try { await limpar() } catch { /* nada */ }
  process.exit(1)
})
