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
import { loadOrgContext, categorizeTransaction } from '@/lib/categorizer'
import { somarMatchCount } from '@/lib/rules-write'

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
  t(catalogoE.length === catalogoL.length + 12,
    `com escrita, o catálogo ganha os SEIS pares prever_/aplicar_ (${catalogoE.length} ferramentas)`)

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

  // `atribuivel` é o campo que diz ao modelo o que pode receber lançamento. Ele
  // vivia TRUE para tudo — o `${categories.id}` sem qualificação era capturado
  // pelo alias do EXISTS. Ver a nota em `lib/sql-dimensions.ts`.
  const todas = await chamar(comEscrita, 'listar_categorias', { organizationId: ORG })
  const cadastro = (todas.dados as { naturezas: { id: string; atribuivel: boolean }[] })?.naturezas ?? []
  t(cadastro.find(n => n.id === paiComFilho.id)?.atribuivel === false,
    'listar_categorias marca natureza PAI como atribuivel: false')
  t(cadastro.find(n => n.id === folha.id)?.atribuivel === true,
    'e a natureza FOLHA como atribuivel: true')
  t(cadastro.some(n => !n.atribuivel) && cadastro.some(n => n.atribuivel),
    `o plano tem os dois casos (${cadastro.filter(n => n.atribuivel).length} de ${cadastro.length} atribuíveis)`)

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

  // ═══ Regras de categorização ══════════════════════════════════════════════
  console.log('\n── regras ──')

  const lista = await chamar(comEscrita, 'listar_regras', { organizationId: ORG })
  const regrasExistentes = (lista.dados as { regras: { descricao: string; categoria: string | null }[] })?.regras ?? []
  t(regrasExistentes.length >= 3,
    `listar_regras devolve as ${regrasExistentes.length} regras que a classificação em lote criou`)
  t(regrasExistentes.every(r => r.categoria !== null),
    'e traz o alvo resolvido em NOME, não em id — um uuid não diz nada a quem lê')

  const curta = await chamar(comEscrita, 'prever_regras', {
    organizationId: ORG, regras: [{ descricao: 'AB', categoryId: folha.id }],
  })
  t(curta.isError,
    'descrição de 2 letras é recusada — o casamento é por trecho, e "AB" pegaria a base inteira')

  // As três recusas por linha, num lote só: elas SAEM, as boas ficam.
  const misto = await chamar(comEscrita, 'prever_regras', {
    organizationId: ORG,
    regras: [
      { descricao: 'MERCADO LIVRE', categoryId: folha.id },
      { descricao: 'AMERICANAS', categoryId: paiComFilho.id },
      { descricao: 'mercado livre' },
      { descricao: 'MERCADO LIVRE', categoryId: folha.id },
      { descricao: 'SHOPEE', costCenterId: '00000000-0000-0000-0000-000000000000' },
    ],
  })
  const m = misto.dados as {
    previaId: string
    resumo: { quantidade: number; criar: number }
    recusadas: { indice: number; motivo: string }[]
  }
  t(m.resumo.quantidade === 1 && m.recusadas.length === 4,
    `linha inválida não derruba o lote: 1 válida, ${m.recusadas.length} recusadas com motivo`)
  t(m.recusadas.some(r => r.indice === 1 && r.motivo.includes('subcategorias')),
    'natureza PAI recusada — pendurar lançamento no pai duplicaria o valor na cascata da DRE')
  t(m.recusadas.some(r => r.indice === 2 && r.motivo.includes('alvo')),
    'regra sem nenhum alvo recusada')
  t(m.recusadas.some(r => r.indice === 3 && r.motivo.includes('posição 0')),
    'duplicata dentro do lote recusada, apontando a posição da primeira')
  t(m.recusadas.some(r => r.indice === 4 && r.motivo.includes('Centro de custo')),
    'dimensão de outra empresa recusada')

  // ── O alcance: o número que revela regra larga demais ────────────────────
  const alcance = await chamar(comEscrita, 'prever_regras', {
    organizationId: ORG,
    regras: [
      { descricao: 'UBER', categoryId: folha.id },
      { descricao: 'UBER *TRIP 001', categoryId: folha.id },
    ],
  })
  const al = alcance.dados as {
    previaId: string
    resumo: { criar: number; atualizar: number; linhas: {
      descricao: string; acao: string; alvosAtuais: string | null
      lancamentosQueCasam: number; semNatureza: number
    }[] }
    avisoSobrescrita?: string
    avisoAbrangencia?: string[]
  }
  const larga = al.resumo.linhas.find(l => l.descricao === 'UBER')!
  const exata = al.resumo.linhas.find(l => l.descricao === 'UBER *TRIP 001')!
  t(larga.lancamentosQueCasam === 5,
    `"UBER" alcança os 5 lançamentos com esse trecho, não só um (${larga.lancamentosQueCasam})`)
  t(exata.lancamentosQueCasam === 1,
    'e "UBER *TRIP 001" alcança 1 — é assim que a prévia mostra a diferença entre as duas')
  t(larga.semNatureza === 2,
    `dos 5, ${larga.semNatureza} ainda estão sem natureza — os que a próxima passada pegaria`)
  t(larga.acao === 'criar' && exata.acao === 'atualizar',
    'a que já existe é ATUALIZAR, não criar — a identidade é o par (descrição, conta)')
  t(exata.alvosAtuais !== null && al.avisoSobrescrita !== undefined,
    `e a prévia diz para onde a existente aponta hoje ("${exata.alvosAtuais}") antes de sobrescrever`)
  t(al.resumo.criar === 1 && al.resumo.atualizar === 1, 'resumo: 1 a criar, 1 a atualizar')

  // ── O dente da assinatura ────────────────────────────────────────────────
  // Contagem igual, efeito diferente: alguém criou "UBER" no intervalo, e o que
  // seria uma regra nova virou sobrescrita de algo que o humano nunca viu.
  await db.insert(categorizationRules).values({
    organizationId: ORG, name: 'Intruso', conditions: { description: 'UBER' },
    targetCategoryId: folha.id, autoGenerated: false, priority: 0,
  })

  const assinaturaVelha = await chamar(comEscrita, 'aplicar_regras', {
    organizationId: ORG, previaId: al.previaId, confirmacao: 'aplicar',
  })
  t(assinaturaVelha.isError && assinaturaVelha.texto.includes('plano mudou'),
    'a regra passou a existir entre prever e aplicar: RECUSA, mesmo com a contagem igual')

  await db.delete(categorizationRules).where(and(
    eq(categorizationRules.organizationId, ORG), eq(categorizationRules.name, 'Intruso'),
  ))

  // ── O caminho feliz ──────────────────────────────────────────────────────
  const [antesRegras] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM categorization_rules WHERE organization_id = ${ORG}::uuid`)

  const previaR = await chamar(comEscrita, 'prever_regras', {
    organizationId: ORG,
    regras: [
      { descricao: 'MERCADO LIVRE', categoryId: folha.id, costCenterId: cc.id },
      { descricao: 'UBER *TRIP 001', categoryId: folha.id },
    ],
  })
  const prR = previaR.dados as { previaId: string; resumo: { criar: number; atualizar: number } }

  const semPalavraR = await chamar(comEscrita, 'aplicar_regras', {
    organizationId: ORG, previaId: prR.previaId, confirmacao: 'ok',
  })
  t(semPalavraR.isError, 'aplicar_regras sem a palavra literal: recusa')

  const aplicR = await chamar(comEscrita, 'aplicar_regras', {
    organizationId: ORG, previaId: prR.previaId, confirmacao: 'aplicar',
  })
  const rr = aplicR.dados as { criadas: number; atualizadas: number; observacao: string }
  t(!aplicR.isError && rr.criadas === 1 && rr.atualizadas === 1,
    `aplicou: ${rr.criadas} criada, ${rr.atualizadas} atualizada`)
  t(rr.observacao.includes('não'),
    'e o resultado avisa que o passado NÃO foi reclassificado — regra vale daqui pra frente')

  const [depoisRegras] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM categorization_rules WHERE organization_id = ${ORG}::uuid`)
  t(Number(depoisRegras.n) === Number(antesRegras.n) + 1,
    `o banco confirma: ${antesRegras.n} → ${depoisRegras.n} regras (a atualizada não virou uma segunda)`)

  const [gravada] = await db.execute<{ cc: string | null; cat: string | null }>(sql`
    SELECT target_cost_center_id::text AS cc, target_category_id::text AS cat
      FROM categorization_rules
     WHERE organization_id = ${ORG}::uuid
       AND conditions->>'description' = 'MERCADO LIVRE'`)
  t(gravada?.cc === cc.id && gravada?.cat === folha.id,
    'e a regra nova aponta para a natureza E o centro de custo pedidos')

  const [semReclassificar] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM transactions
     WHERE organization_id = ${ORG}::uuid AND category_id IS NULL`)
  t(Number(semReclassificar.n) === 2,
    'e os 2 lançamentos sem natureza continuam sem — criar regra não mexe no passado')

  const reuso = await chamar(comEscrita, 'aplicar_regras', {
    organizationId: ORG, previaId: prR.previaId, confirmacao: 'aplicar',
  })
  t(reuso.isError && reuso.texto.includes('já foi aplicada'),
    'e a mesma prévia de REGRAS não aplica duas vezes')

  // ── Total real, paginação e o contador ──────────────────────────────────
  // `total` devolvia `regras.length` — o tamanho da página. Pior que não ter
  // total: quem lê conclui que viu tudo, e o número parece confirmar. Uma
  // organização real daqui tem 510 regras e o teto de 500 cortava 10 em silêncio.
  const pagina1 = await chamar(comEscrita, 'listar_regras', { organizationId: ORG, limite: 1 })
  const g1 = pagina1.dados as {
    regras: { id: string }[]; total: number; exibidas: number; temMais: boolean
    avisoPaginacao?: string
  }
  const [totalReal] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM categorization_rules
     WHERE organization_id = ${ORG}::uuid AND conditions ? 'description'`)
  t(g1.total === Number(totalReal.n) && g1.exibidas === 1,
    `com limite 1: exibidas=1 mas total=${g1.total}, o número REAL do banco`)
  t(g1.temMais === true && typeof g1.avisoPaginacao === 'string',
    'e diz que há mais, com o offset a usar na próxima chamada')

  const pagina2 = await chamar(comEscrita, 'listar_regras', { organizationId: ORG, limite: 1, offset: 1 })
  const g2 = pagina2.dados as { regras: { id: string }[] }
  t(g2.regras[0]?.id !== undefined && g2.regras[0].id !== g1.regras[0].id,
    'offset avança de verdade — a segunda página traz outra regra')

  const inteira = await chamar(comEscrita, 'listar_regras', { organizationId: ORG })
  const gi = inteira.dados as { regras: { id: string }[]; temMais: boolean }
  t(new Set(gi.regras.map(r => r.id)).size === Number(totalReal.n) && gi.temMais === false,
    `sem paginar, traz as ${totalReal.n} sem repetir e temMais fica falso`)

  // ── O contador que nunca teve escritor ──────────────────────────────────
  // 518 regras no banco, 518 com match_count = 0. "Zero" nunca significou "não
  // pegou nada" — era o valor de todas elas. Uma regra ANTIGA declara isso.
  await db.insert(categorizationRules).values({
    organizationId: ORG, name: 'Antiga', conditions: { description: 'REGRA ANTIGA' },
    targetCategoryId: folha.id, autoGenerated: false, priority: 0,
    createdAt: new Date('2026-05-01T00:00:00Z'),
  })
  const comAntiga = await chamar(comEscrita, 'listar_regras', { organizationId: ORG })
  const ga = comAntiga.dados as {
    regras: { descricao: string; contadorConfiavel: boolean }[]
    contadorNaoConfiavel: number
    avisoContador?: string
  }
  const antiga = ga.regras.find(r => r.descricao === 'REGRA ANTIGA')!
  const nova = ga.regras.find(r => r.descricao === 'MERCADO LIVRE')!
  t(antiga.contadorConfiavel === false && nova.contadorConfiavel === true,
    'regra anterior ao escritor do contador vem com contadorConfiavel: false; a nova, true')
  t(ga.contadorNaoConfiavel === 1 && ga.avisoContador?.includes('não use esse zero') === true,
    'e a resposta avisa para NÃO concluir que a regra é inútil a partir do zero dela')

  // ── A cadeia inteira: a regra que o MCP gravou é a que o categorizador usa ─
  const [alvoDoContador] = await db.select({
    id: categorizationRules.id, matchCount: categorizationRules.matchCount,
  }).from(categorizationRules).where(and(
    eq(categorizationRules.organizationId, ORG),
    sql`conditions->>'description' = 'UBER *TRIP 001'`,
  ))

  const ctx = await loadOrgContext(ORG)
  const [paraCategorizar] = await db.select({
    id: transactions.id, description: transactions.description, amount: transactions.amount,
    direction: transactions.direction, date: transactions.date, accountId: transactions.accountId,
    metadata: transactions.metadata, accountName: transactions.accountName,
    accountType: transactions.accountType, accountNumber: transactions.accountNumber,
  }).from(transactions).where(and(
    eq(transactions.organizationId, ORG), eq(transactions.description, 'UBER *TRIP 001'),
  ))

  const decisao = await categorizeTransaction({
    ...paraCategorizar,
    organizationId: ORG,
    metadata: paraCategorizar.metadata as Record<string, unknown> | null,
    connectionLabel: null, connectionBadge: null, nfContext: null,
  }, ctx, 'dre')
  t(decisao.result?.method === 'rule' && decisao.result?.ruleId === alvoDoContador.id,
    'o categorizador decide pela regra E diz QUAL — o elo que faltava para o contador')
  t(decisao.llmCost == null, 'e resolve na camada 1, sem chamar a IA')

  await somarMatchCount(ORG, new Map([[alvoDoContador.id, 3]]))
  const [contado] = await db.execute<{ n: number }>(sql`
    SELECT match_count::int AS n FROM categorization_rules WHERE id = ${alvoDoContador.id}::uuid`)
  t(Number(contado.n) === alvoDoContador.matchCount + 3,
    `match_count sobe de ${alvoDoContador.matchCount} para ${contado.n} — a coluna ganhou um escritor`)

  // Somar para uma regra de OUTRA organização não pode encostar nela.
  await somarMatchCount('00000000-0000-0000-0000-000000000000', new Map([[alvoDoContador.id, 99]]))
  const [intocada] = await db.execute<{ n: number }>(sql`
    SELECT match_count::int AS n FROM categorization_rules WHERE id = ${alvoDoContador.id}::uuid`)
  t(Number(intocada.n) === Number(contado.n),
    'e a soma é presa à organização: id certo, organização errada, nada acontece')

  // ═══ Importação ═══════════════════════════════════════════════════════════
  console.log('\n── importação ──')

  const [naturezaComCodigo] = await db.select({ id: categories.id, codigo: categories.code, nome: categories.name })
    .from(categories)
    .where(and(
      eq(categories.organizationId, ORG),
      isNotNull(categories.code),
      sql`NOT EXISTS (SELECT 1 FROM categories f WHERE f.parent_id = ${categories.id})`,
    ))
    .limit(1)

  // Duas linhas IDÊNTICAS de propósito: dois cafés de R$ 15 no mesmo dia são
  // dois lançamentos legítimos, e a dedup não pode matar o segundo.
  const arquivo = [
    { data: '2026-04-02', descricao: 'ALUGUEL ABRIL', valor: 3500, sentido: 'outflow',
      categoria: naturezaComCodigo.codigo },
    { data: '2026-04-05', descricao: 'CAFE', valor: 15, sentido: 'outflow' },
    { data: '2026-04-05', descricao: 'CAFE', valor: 15, sentido: 'outflow' },
    { data: '2026-04-10', descricao: 'RECEBIMENTO CLIENTE X', valor: 9000, sentido: 'inflow' },
    { data: '2026-04-12', descricao: 'CONTA DE LUZ', valor: 340.55, sentido: 'outflow',
      categoria: 'NATUREZA QUE NAO EXISTE' },
  ]

  const pi = await chamar(comEscrita, 'prever_importacao', {
    organizationId: ORG, origem: 'Extrato de teste — abril/2026', linhas: arquivo,
  })
  const i1 = pi.dados as {
    previaId: string
    resumo: { quantidade: number; entradas: number; saidas: number; comNatureza: number
              duplicadasIgnoradas: number; periodo: { de: string; ate: string } }
    avisos?: string[]
  }
  t(i1.resumo.quantidade === 5 && i1.resumo.duplicadasIgnoradas === 0,
    `5 linhas novas, nenhuma duplicada (as duas "CAFE" idênticas contam como 2)`)
  // 3500 + 15 + 15 + 340,55 — os dois cafés contam os dois.
  t(Math.abs(i1.resumo.entradas - 9000) < 0.01 && Math.abs(i1.resumo.saidas - 3870.55) < 0.01,
    `entradas R$ ${i1.resumo.entradas.toFixed(2)} e saídas R$ ${i1.resumo.saidas.toFixed(2)}, separadas`)
  t(i1.resumo.periodo.de === '2026-04-02' && i1.resumo.periodo.ate === '2026-04-12',
    'e o período que o arquivo cobre')
  t(i1.resumo.comNatureza === 1,
    'a natureza casada pelo CÓDIGO do plano de contas entra já classificada')
  t(i1.avisos?.some(a => a.includes('NATUREZA QUE NAO EXISTE')) === true,
    'e a que não casou é nomeada no aviso, em vez de sumir em silêncio')

  const semPalavraI = await chamar(comEscrita, 'aplicar_importacao', {
    organizationId: ORG, previaId: i1.previaId, confirmacao: 'ok',
  })
  t(semPalavraI.isError, 'aplicar_importacao sem a palavra literal: recusa')

  const ap = await chamar(comEscrita, 'aplicar_importacao', {
    organizationId: ORG, previaId: i1.previaId, confirmacao: 'aplicar',
  })
  const r1 = ap.dados as {
    lancamentosInseridos: number; jaClassificados: number; documentId: string
    emClassificacao?: number
  }
  t(!ap.isError && r1.lancamentosInseridos === 5, `gravou ${r1.lancamentosInseridos} lançamentos`)
  t(r1.jaClassificados === 1 && r1.emClassificacao === 4,
    '1 já com natureza do arquivo, 4 na fila de classificação')

  const [conferido] = await db.execute<{ n: number; soma: string; comDoc: number; comChave: number }>(sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::text AS soma,
           COUNT(*) FILTER (WHERE document_id = ${r1.documentId}::uuid)::int AS "comDoc",
           -- 'arq:' e nao 'mcp:': a chave passou a ser a MESMA nas duas portas
           -- de arquivo, senao a dedup ficaria cega justamente entre elas.
           COUNT(*) FILTER (WHERE external_id LIKE 'arq:%')::int AS "comChave"
      FROM transactions
     WHERE organization_id = ${ORG}::uuid AND date >= '2026-04-01'`)
  t(Number(conferido.n) === 5 && Math.abs(Number(conferido.soma) - 12870.55) < 0.01,
    `banco: 5 lançamentos somando R$ ${Number(conferido.soma).toFixed(2)}`)
  t(Number(conferido.comDoc) === 5 && Number(conferido.comChave) === 5,
    'todos carregam o documento de origem e a chave de deduplicação')

  // ── O que o app NUNCA teve: reimportar não duplica ──────────────────────
  const repetido = await chamar(comEscrita, 'prever_importacao', {
    organizationId: ORG, origem: 'Extrato de teste — abril/2026 (de novo)', linhas: arquivo,
  })
  const i2 = repetido.dados as {
    previaId: string | null; resumo: { quantidade: number; duplicadasIgnoradas: number }; aviso?: string
  }
  t(i2.resumo.quantidade === 0 && i2.resumo.duplicadasIgnoradas === 5,
    'o MESMO arquivo de novo: 0 novas, 5 já existentes — o caminho da tela dobraria tudo')
  t(i2.previaId === null && i2.aviso?.includes('já tinha sido importado') === true,
    'e nem gera prévia — não há o que aplicar')

  // ── Lote com sobreposição: o caso real de arquivo grande em pedaços ─────
  const segundoLote = [
    ...arquivo.slice(3),                                              // repetidas
    { data: '2026-04-20', descricao: 'NOVA LINHA', valor: 77, sentido: 'outflow' },
  ]
  const pi3 = await chamar(comEscrita, 'prever_importacao', {
    organizationId: ORG, origem: 'Extrato de teste — abril/2026', linhas: segundoLote,
  })
  const i3 = pi3.dados as { previaId: string; resumo: { quantidade: number; duplicadasIgnoradas: number } }
  t(i3.resumo.quantidade === 1 && i3.resumo.duplicadasIgnoradas === 2,
    'lote que se sobrepõe ao anterior: só a linha nova entra — é o que permite arquivo em pedaços')

  await chamar(comEscrita, 'aplicar_importacao', {
    organizationId: ORG, previaId: i3.previaId, confirmacao: 'aplicar',
  })
  const [aposSobreposicao] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM transactions
     WHERE organization_id = ${ORG}::uuid AND date >= '2026-04-01'`)
  t(Number(aposSobreposicao.n) === 6, `${aposSobreposicao.n} no total, não 11 — a sobreposição não dobrou`)

  // ── Balanço pelo MCP: impossível até a 4.5.C ────────────────────────────
  // `aplicarImportacao` cravava `reportType: 'other'`. Consequência dupla e
  // silenciosa: `getBpData` filtra `report_type='balance_sheet'` e nunca veria o
  // documento; e `domainFromReportType('other')` devolve `'dre'`, então uma
  // linha patrimonial só via naturezas de DRE para casar.
  const [{ n: folhasBpAntes }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM categories
     WHERE organization_id = ${ORG}::uuid
       AND type IN ('ativo_circulante','ativo_nao_circulante','passivo_circulante',
                    'passivo_nao_circulante','patrimonio_liquido')`)
  t(Number(folhasBpAntes) === 0,
    'o seed do plano de contas NÃO cria naturezas de BP — organização nova não teria contra o que casar')

  const [paiBp] = await db.insert(categories).values({
    organizationId: ORG, code: '11.1', name: 'Ativo Circulante', type: 'ativo_circulante',
  }).returning({ id: categories.id })
  await db.insert(categories).values([
    { organizationId: ORG, code: '11.1.01', name: 'Caixa e Equivalentes', type: 'ativo_circulante', parentId: paiBp.id },
    { organizationId: ORG, code: '11.1.02', name: 'Contas a Receber',     type: 'ativo_circulante', parentId: paiBp.id },
  ])

  const linhasBp = [
    { categoria: '11.1.01', descricao: 'Caixa e Equivalentes', valor: 45200 },
    { categoria: 'Contas a Receber', descricao: 'Contas a Receber', valor: 310000 },
    // Natureza de DRE num balanço: NÃO pode casar. O filtro de domínio é o que
    // impede uma linha patrimonial de virar despesa.
    { categoria: naturezaComCodigo.codigo, descricao: 'Linha com natureza de DRE', valor: 100 },
  ]

  const bpSemData = await chamar(comEscrita, 'prever_importacao', {
    organizationId: ORG, origem: 'Balanço 01/2026', tipoDeRelatorio: 'balanco', linhas: linhasBp,
  })
  t(bpSemData.isError && bpSemData.texto.includes('data de referência'),
    `balanço sem dataDeReferencia é recusado, dizendo que é ela que vira a coluna e a data da linha` +
    (bpSemData.texto.includes('data de referência') ? '' : ` [texto: ${bpSemData.texto.slice(0, 200)}]`))

  const bp = await chamar(comEscrita, 'prever_importacao', {
    organizationId: ORG, origem: 'Balanço 01/2026',
    tipoDeRelatorio: 'balanco', dataDeReferencia: '2026-01-31', linhas: linhasBp,
  })
  const b1 = bp.dados as {
    previaId: string
    resumo: { quantidade: number; comNatureza: number }
    avisos?: string[]
  }
  // Sem early-return: `main` termina em `process.exit`, e sair antes dele deixa a
  // conexão do postgres segurando o event loop — o script "trava" sem erro.
  if (bp.isError || !b1) throw new Error(`balanço com data falhou: ${bp.texto.slice(0, 300)}`)
  t(!bp.isError && b1.resumo.quantidade === 3, `balanço: 3 linhas a inserir (foram ${b1.resumo.quantidade})`)
  t(b1.resumo.comNatureza === 2,
    'casam as 2 patrimoniais (uma por código, outra por nome) e NÃO a natureza de DRE — o filtro de domínio')
  t(b1.avisos?.some(a => a.includes('não deduplica')) === true,
    'e o aviso diz que balanço não deduplica: snapshot se substitui')

  const apBp = await chamar(comEscrita, 'aplicar_importacao', {
    organizationId: ORG, previaId: b1.previaId, confirmacao: 'aplicar',
  })
  const rBp = apBp.dados as { lancamentosInseridos: number; documentId: string }
  t(!apBp.isError && rBp.lancamentosInseridos === 3, `balanço gravou ${rBp.lancamentosInseridos} linhas`)

  const [docBp] = await db.execute<{ report_type: string; reference_date: string | null }>(sql`
    SELECT report_type, reference_date::text FROM documents WHERE id = ${rBp.documentId}::uuid`)
  t(docBp.report_type === 'balance_sheet',
    'o documento entra como balance_sheet — sem isso `getBpData` jamais o enxergaria')
  t(docBp.reference_date === '2026-01-31',
    'e com a data de referência, que é a coluna de /balanco e a data de cada linha')

  const [linhasGravadas] = await db.execute<{ n: number; naData: number; entradas: number; comCat: number; comChave: number }>(sql`
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE date = '2026-01-31')::int          AS "naData",
           COUNT(*) FILTER (WHERE direction = 'inflow')::int         AS entradas,
           COUNT(*) FILTER (WHERE category_id IS NOT NULL)::int      AS "comCat",
           COUNT(*) FILTER (WHERE external_id IS NOT NULL)::int      AS "comChave"
      FROM transactions WHERE document_id = ${rBp.documentId}::uuid`)
  t(Number(linhasGravadas.naData) === 3, 'toda linha herda a data do arquivo — um balanço não tem data por linha')
  t(Number(linhasGravadas.entradas) === 3, 'toda linha entra como inflow — quem dá o lado é a natureza')
  t(Number(linhasGravadas.comCat) === 2, '2 já classificadas em naturezas patrimoniais')
  t(Number(linhasGravadas.comChave) === 0,
    'e NENHUMA recebe chave de dedup — se recebesse, reenviar o balanço corrigido deixaria o documento novo vazio')

  // Reenviar o balanço corrigido PRECISA entrar: `getBpAllDates` escolhe o
  // documento mais recente da data, e se a segunda importação deduplicasse
  // inteira, a tela passaria a mostrar o vazio.
  const bp2 = await chamar(comEscrita, 'prever_importacao', {
    organizationId: ORG, origem: 'Balanço 01/2026 (corrigido)',
    tipoDeRelatorio: 'balanco', dataDeReferencia: '2026-01-31',
    linhas: [{ categoria: '11.1.01', descricao: 'Caixa e Equivalentes', valor: 47000 }],
  })
  const b2 = bp2.dados as { previaId: string; resumo: { quantidade: number; duplicadasIgnoradas: number } }
  t(b2.resumo.quantidade === 1 && b2.resumo.duplicadasIgnoradas === 0,
    'o balanço corrigido entra de novo, sem ser tratado como duplicata')

  // ── Recusas ─────────────────────────────────────────────────────────────
  // A `origem` aqui é VÁLIDA de propósito. Com `origem: 'x'` (abaixo do mínimo)
  // a primeira queixa do Zod seria sobre ela, e estes dois testes passariam sem
  // nunca ter exercitado a regra da linha.
  const ORIGEM_OK = 'Recusas — teste'

  const negativo = await chamar(comEscrita, 'prever_importacao', {
    organizationId: ORG, origem: ORIGEM_OK,
    linhas: [{ data: '2026-04-01', descricao: 'X', valor: -50, sentido: 'outflow' }],
  })
  t(negativo.isError && negativo.texto.includes('valor'),
    'valor negativo é recusado — o sinal vem do sentido, e -50 numa saída seria entrada disfarçada')

  const dataRuim = await chamar(comEscrita, 'prever_importacao', {
    organizationId: ORG, origem: ORIGEM_OK,
    linhas: [{ data: '01/04/2026', descricao: 'X', valor: 50, sentido: 'outflow' }],
  })
  t(dataRuim.isError && dataRuim.texto.includes('AAAA-MM-DD'),
    'data em formato brasileiro é recusada dizendo qual é o formato')

  const sentidoRuim = await chamar(comEscrita, 'prever_importacao', {
    organizationId: ORG, origem: ORIGEM_OK,
    linhas: [{ data: '2026-04-01', descricao: 'X', valor: 50, sentido: 'saida' }],
  })
  t(sentidoRuim.isError && sentidoRuim.texto.includes('sentido'),
    'sentido fora de inflow/outflow é recusado apontando o campo')

  // `data`, `descricao` e `sentido` viraram OPCIONAIS no schema publicado, porque
  // uma linha de balanço não tem nenhuma das três. Quem exige cada uma passou a
  // ser o tipo de relatório — e precisa exigir de verdade, senão a mudança que
  // liberou o balanço teria afrouxado os movimentos em silêncio.
  const semData = await chamar(comEscrita, 'prever_importacao', {
    organizationId: ORG, origem: ORIGEM_OK,
    linhas: [{ descricao: 'SEM DATA', valor: 50, sentido: 'outflow' }],
  })
  const rSemData = semData.dados as { previaId: string | null; recusadas?: number; motivos?: string[] } | null
  t(rSemData?.previaId === null && rSemData?.recusadas === 1
    && rSemData?.motivos?.some(m => m.includes('competência')) === true,
    'movimento SEM data é recusado E o motivo aparece — o opcional é do balanço, não daqui')

  const semSentido = await chamar(comEscrita, 'prever_importacao', {
    organizationId: ORG, origem: ORIGEM_OK,
    linhas: [{ data: '2026-04-01', descricao: 'SEM SENTIDO', valor: 50 }],
  })
  const rSemSentido = semSentido.dados as { previaId: string | null; motivos?: string[] } | null
  t(rSemSentido?.previaId === null && rSemSentido?.motivos?.some(m => m.includes('Sentido')) === true,
    'movimento SEM sentido é recusado E o motivo aparece')

  // A recusa é por LINHA: uma ruim não pode custar as boas.
  const loteMisto = await chamar(comEscrita, 'prever_importacao', {
    organizationId: ORG, origem: ORIGEM_OK,
    linhas: [
      { data: '2026-05-01', descricao: 'BOA', valor: 10, sentido: 'outflow' },
      { descricao: 'RUIM, SEM DATA', valor: 20, sentido: 'outflow' },
      { data: '2026-05-03', descricao: 'OUTRA BOA', valor: 30, sentido: 'inflow' },
    ],
  })
  const rLoteMisto = loteMisto.dados as { resumo: { quantidade: number }; avisos?: string[] }
  t(rLoteMisto?.resumo?.quantidade === 2 && rLoteMisto.avisos?.some(a => a.includes('recusada')) === true,
    'lote misto: as 2 boas seguem e a ruim é nomeada — recusa é por linha, não por lote')

  const alheia = await chamar(soLeitura, 'prever_importacao', {
    organizationId: ORG, origem: 'x', linhas: arquivo,
  })
  t(alheia.erroProtocolo?.code === -32601,
    'e um consentimento só de leitura não enxerga a importação')

  // ═══ Auditoria ════════════════════════════════════════════════════════════
  console.log('\n── auditoria ──')

  const [aud] = await db.execute<{ previas: number; aplicadas: number }>(sql`
    SELECT COUNT(*) FILTER (WHERE type = 'mcp_preview')::int AS previas,
           COUNT(*) FILTER (WHERE type = 'mcp_applied')::int AS aplicadas
    FROM agent_events WHERE organization_id = ${ORG}::uuid`)
  t(Number(aud.previas) > 0 && Number(aud.aplicadas) === 9,
    `${aud.previas} prévias e ${aud.aplicadas} aplicações registradas — classificação, dois rateios, ` +
    'um lançamento orçado, uma cópia do realizado, um lote de regras, duas importações de movimentos ' +
    'e uma de balanço')

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
