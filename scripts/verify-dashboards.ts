/**
 * Exercita o miolo dos painéis (Fase 5.B) contra o banco de verdade.
 *
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-dashboards.ts
 *
 * Cria as próprias organizações e as apaga no fim — o CASCADE leva painéis,
 * blocos, compartilhamentos, categorias e lançamentos. Usuários são UUIDs
 * sintéticos (`memberships.user_id` não tem FK para `auth.users`).
 *
 * O que NÃO passa por aqui, e fica declarado: o renderizador (5.C) e as
 * ferramentas MCP (5.D) — nenhum dos dois existe ainda.
 */
import { db } from '@/db'
import {
  organizations, memberships, dashboards, dashboardBlocks, dashboardShares,
  categories, transactions, dataSources,
} from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import {
  listarPaineis, lerPainel, criarPainel, atualizarPainel, apagarPainel,
  materializarPainelPadrao, adicionarBloco, editarBloco, removerBloco,
  reordenarBlocos, compartilharPainel, removerCompartilhamento,
} from '@/lib/dashboard/store'
import { blocosDoPainelPadraoValidados, PAINEL_PADRAO_SLUG } from '@/lib/dashboard/default-panel'
import { executarBloco, resolverPeriodos } from '@/lib/dashboard/run-block'
import { blockSpecSchema, lerBlockSpec } from '@/lib/dashboard/block-spec'
import { calcularKpisDoMes, TIPOS_DESPESA } from '@/lib/dashboard/kpis'
import { calcularIndicadores } from '@/lib/dashboard/indicators'
import { gerarAlertas } from '@/lib/dashboard/alerts'
import { scopeFromSession } from '@/lib/query/scope'
import { runQuery } from '@/lib/query/engine'

const NOME_ORG = 'ZZ Teste paineis'
const NOME_ORG_B = 'ZZ Teste paineis B'

const DONO     = '66666666-0000-4000-8000-000000000001'  // owner
const ADMIN    = '66666666-0000-4000-8000-000000000002'  // admin
const OPERADOR = '66666666-0000-4000-8000-000000000003'  // member
const LEITOR   = '66666666-0000-4000-8000-000000000004'  // viewer
const ESTRANHO = '66666666-0000-4000-8000-000000000009'  // sem vínculo

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }
const erroDe = (r: unknown): string | null =>
  r && typeof r === 'object' && 'erro' in r ? String((r as { erro: unknown }).erro) : null

async function limpar() {
  await db.delete(organizations).where(eq(organizations.name, NOME_ORG))
  await db.delete(organizations).where(eq(organizations.name, NOME_ORG_B))
}

/** Um mês fixo, para os números não mudarem com o calendário. */
const MES = '2026-03'
const DIA = (d: number) => `2026-03-${String(d).padStart(2, '0')}`

async function main() {
  await limpar()

  const [org] = await db.insert(organizations).values({
    name: NOME_ORG, slug: `zz-teste-paineis-${Date.now()}`,
  }).returning({ id: organizations.id })
  const [orgB] = await db.insert(organizations).values({
    name: NOME_ORG_B, slug: `zz-teste-paineis-b-${Date.now()}`,
  }).returning({ id: organizations.id })
  const ORG = org.id, ORG_B = orgB.id

  const agora = new Date()
  await db.insert(memberships).values([
    { userId: DONO,     organizationId: ORG, role: 'owner',  invitedEmail: 'dono@teste.com',     acceptedAt: agora },
    { userId: ADMIN,    organizationId: ORG, role: 'admin',  invitedEmail: 'admin@teste.com',    acceptedAt: agora },
    { userId: OPERADOR, organizationId: ORG, role: 'member', invitedEmail: 'operador@teste.com', acceptedAt: agora },
    { userId: LEITOR,   organizationId: ORG, role: 'viewer', invitedEmail: 'leitor@teste.com',   acceptedAt: agora },
    { userId: DONO,     organizationId: ORG_B, role: 'owner', invitedEmail: 'dono@teste.com',    acceptedAt: agora },
  ])

  // ═══ 0. Dado real para os blocos consultarem ══════════════════════════════
  //
  // O seed automático de categorias roda no INSERT de organizations, mas ele
  // cria o plano padrão inteiro — pego duas folhas dele e lanço valores
  // conhecidos, para conferir número, não só ausência de erro.
  const [receita] = await db.select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.organizationId, ORG), eq(categories.type, 'receita_operacional'), sql`${categories.parentId} IS NOT NULL`))
    .limit(1)
  const [despesa] = await db.select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.organizationId, ORG), eq(categories.type, 'sga'), sql`${categories.parentId} IS NOT NULL`))
    .limit(1)
  t(!!receita && !!despesa, 'seed de categorias deu folhas de receita e de SG&A')

  const [ds] = await db.insert(dataSources).values({
    organizationId: ORG, type: 'manual', provider: 'manual', name: 'Conta de teste', status: 'active',
  }).returning({ id: dataSources.id })

  const lanc = (dia: number, valor: string, dir: 'inflow' | 'outflow', catId: string) => ({
    organizationId: ORG, dataSourceId: ds.id, categoryId: catId,
    date: DIA(dia), effectiveDate: DIA(dia), description: `Teste ${dia}`,
    amount: valor, direction: dir, status: 'confirmed' as const,
  })
  await db.insert(transactions).values([
    lanc(5,  '10000.00', 'inflow',  receita.id),
    lanc(12, '5000.00',  'inflow',  receita.id),
    lanc(8,  '3000.00',  'outflow', despesa.id),
    lanc(20, '1000.00',  'outflow', despesa.id),
  ])
  // Mês anterior, para o delta do KPI ter contra o que comparar.
  await db.insert(transactions).values([
    { ...lanc(5, '6000.00', 'inflow', receita.id), date: '2026-02-05', effectiveDate: '2026-02-05' },
    { ...lanc(6, '2000.00', 'outflow', despesa.id), date: '2026-02-06', effectiveDate: '2026-02-06' },
  ])

  const scope = await scopeFromSession(DONO, ORG)

  // ═══ 1. O painel padrão é válido e reproduz a tela ════════════════════════
  console.log('\n── 1. painel padrão (virtual) ──')
  {
    const blocos = blocosDoPainelPadraoValidados()
    t(blocos.length === 8, `o padrão tem 8 blocos (${blocos.length})`)
    const tipos = blocos.map(b => b.tipo)
    t(tipos.filter(x => x === 'kpi').length === 4, 'sendo 4 KPIs')
    t(tipos.includes('alertas') && tipos.includes('serie') && tipos.includes('ranking') && tipos.includes('indicador'),
      'mais alertas, série, ranking e indicadores')
    // Não há painel gravado nenhum ainda: a listagem é vazia, e é isso que faz
    // a tela cair no virtual.
    t((await listarPaineis(DONO, ORG)).length === 0, 'nenhum painel gravado — a tela usa o virtual')
  }

  // ═══ 2. Os blocos do padrão executam e batem com o cálculo clássico ═══════
  console.log('\n── 2. execução dos blocos ──')
  {
    const blocos = blocosDoPainelPadraoValidados()
    const ctx = { mes: MES }

    const kpiReceita = await executarBloco(scope, blocos[0], ctx)
    t(kpiReceita.tipo === 'kpi' && kpiReceita.valor === 15000,
      `KPI Receita = 15.000 (${kpiReceita.tipo === 'kpi' ? kpiReceita.valor : '?'})`)
    // 15.000 contra 6.000 do mês anterior = +150%
    t(kpiReceita.tipo === 'kpi' && Math.round(kpiReceita.deltaPct ?? 0) === 150,
      `e o delta contra o mês anterior é +150% (${kpiReceita.tipo === 'kpi' ? Math.round(kpiReceita.deltaPct ?? 0) : '?'}%)`)

    const kpiDespesa = await executarBloco(scope, blocos[1], ctx)
    t(kpiDespesa.tipo === 'kpi' && kpiDespesa.valor === 4000,
      `KPI Despesas = 4.000 POSITIVO (inverterSinal) (${kpiDespesa.tipo === 'kpi' ? kpiDespesa.valor : '?'})`)
    t(kpiDespesa.tipo === 'kpi' && kpiDespesa.menorEhMelhor === true,
      'e declara que subir é ruim')

    const kpiLucro = await executarBloco(scope, blocos[2], ctx)
    t(kpiLucro.tipo === 'kpi' && kpiLucro.valor === 11000,
      `KPI Lucro = 15.000 − 4.000 = 11.000 (${kpiLucro.tipo === 'kpi' ? kpiLucro.valor : '?'})`)

    const kpiSaldo = await executarBloco(scope, blocos[3], ctx)
    // Acumulado até o fim de março: 6.000 − 2.000 (fev) + 15.000 − 4.000 (mar)
    t(kpiSaldo.tipo === 'kpi' && kpiSaldo.valor === 15000,
      `KPI Saldo acumulado = 15.000 (${kpiSaldo.tipo === 'kpi' ? kpiSaldo.valor : '?'})`)
    t(kpiSaldo.tipo === 'kpi' && kpiSaldo.deltaPct === null,
      'e saldo acumulado NÃO tem período anterior — delta nulo, não zero')

    // O clássico, para conciliar: os mesmos 4 números pela função de sempre.
    const classico = await calcularKpisDoMes(ORG, MES)
    t(classico.receita.current === 15000 && classico.despesas.current === 4000
      && classico.lucroLiquido.current === 11000 && classico.saldoCaixa === 15000,
      'e o cálculo clássico devolve os MESMOS 4 números')

    const serie = await executarBloco(scope, blocos[5], ctx)
    t(serie.tipo === 'serie' && serie.resultado.linhas.length > 0,
      `bloco série (90 dias por semana) devolve ${serie.tipo === 'serie' ? serie.resultado.linhas.length : 0} semanas`)
    if (serie.tipo === 'serie') {
      const somaEntradas = serie.resultado.linhas.reduce((s, l) => s + l.medidas.entradas, 0)
      t(somaEntradas === 21000, `e a soma das entradas das semanas = 21.000 (${somaEntradas})`)
      const chaves = serie.resultado.linhas.map(l => l.chaves[0].id).filter(Boolean) as string[]
      t(chaves.every(c => new Date(`${c}T00:00:00Z`).getUTCDay() === 1),
        'toda chave de semana é uma SEGUNDA-FEIRA (DATE_TRUNC ISO)')
    }

    const ranking = await executarBloco(scope, blocos[6], ctx)
    t(ranking.tipo === 'ranking' && ranking.resultado.linhas.length === 1
      && ranking.resultado.linhas[0].medidas.saidas === 4000,
      'bloco ranking traz a única categoria de despesa, com 4.000')

    const indic = await executarBloco(scope, blocos[7], ctx)
    const indClassico = await calcularIndicadores(ORG, MES)
    t(indic.tipo === 'indicador' && indic.indicadores.margemEbitda === indClassico.margemEbitda,
      'bloco indicador bate com calcularIndicadores')

    const alertas = await executarBloco(scope, blocos[4], ctx)
    t(alertas.tipo === 'alertas', 'bloco alertas executa')
    if (alertas.tipo === 'alertas') {
      // As despesas DOBRARAM (2.000 em fev → 4.000 em mar), e a regra dispara
      // acima de 30%. Asseverar "zero alertas" aqui esconderia a regra: o que
      // prova que ela funciona é ela disparar sobre dado real do banco.
      const ids = alertas.alertas.map(a => a.id)
      t(ids.length === 1 && ids[0] === 'despesas-alta',
        `dispara exatamente o alerta de despesas (${ids.join(', ') || 'nenhum'})`)
      t(alertas.alertas[0]?.severity === 'critical',
        'como CRÍTICO, porque dobrar passa dos 50%')
    }
  }

  // ═══ 3. Alertas: as regras nos DOIS sentidos ══════════════════════════════
  console.log('\n── 3. as 8 regras de alerta ──')
  {
    const bons = await calcularKpisDoMes(ORG, MES)
    const ind = await calcularIndicadores(ORG, MES)
    t(gerarAlertas(bons, ind).map(a => a.id).join() === 'despesas-alta',
      'sobre os dados reais, só o alerta de despesas dispara')

    // Despesas estáveis: aí sim, silêncio — o outro sentido da mesma regra.
    const estaveis = { ...bons, despesas: { current: 4000, previous: 3900, delta: 2.5 } }
    t(gerarAlertas(estaveis, ind).length === 0, 'com despesas estáveis, zero alertas')

    const ruins = { ...bons, saldoCaixa: -500, lucroLiquido: { current: -100, previous: 10, delta: -1100 } }
    const disparados = gerarAlertas(ruins, ind).map(a => a.id)
    t(disparados.includes('saldo-negativo'), 'saldo negativo dispara')
    t(disparados.includes('lucro-negativo'), 'lucro negativo dispara')

    const semDados = { ...ruins, hasData: false }
    t(gerarAlertas(semDados, ind).length === 0, 'sem dados NÃO dispara nada (o guarda de sempre)')

    const soUm = gerarAlertas(ruins, ind, { regras: ['saldo-negativo'] })
    t(soUm.length === 1 && soUm[0].id === 'saldo-negativo', 'o filtro de regras do bloco restringe')
    t(gerarAlertas(ruins, ind).length > 1, 'e sem filtro vem mais de um')
    t(gerarAlertas(ruins, ind, { maximo: 1 }).length === 1, 'e o máximo corta')
    t(gerarAlertas(ruins, ind)[0].severity === 'critical', 'crítico vem primeiro')
  }

  // ═══ 4. Janelas de período ════════════════════════════════════════════════
  console.log('\n── 4. janelas herdadas do painel ──')
  {
    const q = { tipo: 'intervalo', de: '1900-01-01', ate: '1900-01-01', regime: 'competencia' } as const

    const mes = resolverPeriodos({ modo: 'herda_do_painel', janela: 'mes' }, q, MES)
    t(mes.atual.tipo === 'intervalo' && mes.atual.de === '2026-03-01' && mes.atual.ate === '2026-03-31',
      'janela mes = 01/03 a 31/03')
    t(mes.anterior?.tipo === 'intervalo' && mes.anterior.de === '2026-02-01' && mes.anterior.ate === '2026-02-28',
      'e a anterior é fevereiro INTEIRO (28 dias, não 31)')

    const dias = resolverPeriodos({ modo: 'herda_do_painel', janela: 'ultimos_dias', tamanho: 90 }, q, MES)
    t(dias.atual.tipo === 'intervalo' && dias.atual.ate === '2026-03-31' && dias.atual.de === '2026-01-01',
      'janela 90 dias termina em 31/03 e começa em 01/01')

    const meses = resolverPeriodos({ modo: 'herda_do_painel', janela: 'ultimos_meses', tamanho: 12 }, q, MES)
    t(meses.atual.tipo === 'intervalo' && meses.atual.de === '2025-04-01' && meses.atual.ate === '2026-03-31',
      'janela 12 meses = 01/04/2025 a 31/03/2026')

    const acum = resolverPeriodos({ modo: 'herda_do_painel', janela: 'acumulado' }, q, MES)
    t(acum.atual.tipo === 'intervalo' && acum.atual.ate === '2026-03-31' && acum.anterior === null,
      'acumulado termina no mês e não tem anterior')

    // O regime vem da query, não da janela.
    const caixa = resolverPeriodos({ modo: 'herda_do_painel', janela: 'mes' },
      { tipo: 'intervalo', de: '1900-01-01', ate: '1900-01-01', regime: 'caixa' }, MES)
    t(caixa.atual.tipo === 'intervalo' && caixa.atual.regime === 'caixa',
      'o regime competência/caixa continua vindo da query')

    // Modo próprio: as datas da query mandam.
    const proprio = resolverPeriodos({ modo: 'proprio' },
      { tipo: 'intervalo', de: '2025-01-01', ate: '2025-01-31', regime: 'competencia' }, MES)
    t(proprio.atual.tipo === 'intervalo' && proprio.atual.de === '2025-01-01',
      'modo proprio ignora o mês do painel')
  }

  // ═══ 5. Validação de spec: recusa na ESCRITA ══════════════════════════════
  console.log('\n── 5. validação de spec ──')
  {
    const kpiAgrupado = {
      versao: 1, tipo: 'kpi',
      query: { fonte: 'realizado', medidas: ['valor_liquido'], agruparPor: ['categoria'], periodo: { tipo: 'relativo', meses: 1 } },
    }
    t(!blockSpecSchema.safeParse(kpiAgrupado).success, 'kpi com agruparPor é RECUSADO')

    const kpiDuasMedidas = {
      versao: 1, tipo: 'kpi',
      query: { fonte: 'realizado', medidas: ['valor_liquido', 'contagem'], periodo: { tipo: 'relativo', meses: 1 } },
    }
    t(!blockSpecSchema.safeParse(kpiDuasMedidas).success, 'kpi com duas medidas é RECUSADO')

    const semTamanho = {
      versao: 1, tipo: 'serie',
      query: { fonte: 'realizado', medidas: ['entradas'], periodo: { tipo: 'relativo', meses: 1 } },
      periodo: { modo: 'herda_do_painel', janela: 'ultimos_dias' },
    }
    t(!blockSpecSchema.safeParse(semTamanho).success, 'janela ultimos_dias sem tamanho é RECUSADA')

    const tamanhoAtoa = {
      versao: 1, tipo: 'serie',
      query: { fonte: 'realizado', medidas: ['entradas'], periodo: { tipo: 'relativo', meses: 1 } },
      periodo: { modo: 'herda_do_painel', janela: 'mes', tamanho: 5 },
    }
    t(!blockSpecSchema.safeParse(tamanhoAtoa).success, 'janela mes COM tamanho é recusada (o campo mentiria)')

    const bom = {
      versao: 1, tipo: 'serie',
      query: { fonte: 'realizado', medidas: ['entradas'], agruparPor: ['mes'], periodo: { tipo: 'relativo', meses: 12 } },
    }
    t(blockSpecSchema.safeParse(bom).success, 'e a spec correta passa')

    // Leitura: spec de versão futura falha ALTO, com motivo.
    const lida = lerBlockSpec({ versao: 99, tipo: 'texto', markdown: 'oi' })
    t(!lida.ok && lida.erro.length > 0, `spec de versão futura falha na LEITURA com motivo ("${!lida.ok ? lida.erro : ''}")`)
  }

  // ═══ 6. CRUD de painel, com papéis ════════════════════════════════════════
  console.log('\n── 6. CRUD e papéis ──')
  let painelId = ''
  {
    t(erroDe(await criarPainel({ userId: LEITOR, organizationId: ORG, papel: 'viewer', nome: 'Do leitor' })) !== null,
      'viewer NÃO cria painel')
    t(erroDe(await criarPainel({ userId: OPERADOR, organizationId: ORG, papel: 'member', nome: 'Do operador' })) !== null,
      'member NÃO cria painel')

    const criado = await criarPainel({ userId: ADMIN, organizationId: ORG, papel: 'admin', nome: 'Painel do Conselho', padrao: true })
    t(!('erro' in criado), 'admin cria painel')
    if ('erro' in criado) throw new Error(criado.erro)
    painelId = criado.id
    t(criado.slug === 'painel-do-conselho', `e o slug sai de acento e maiúscula ("${criado.slug}")`)

    const homonimo = await criarPainel({ userId: ADMIN, organizationId: ORG, papel: 'admin', nome: 'Painel do Conselho' })
    t(!('erro' in homonimo) && homonimo.slug === 'painel-do-conselho-2',
      `homônimo do MESMO dono ganha sufixo ("${'erro' in homonimo ? '?' : homonimo.slug}")`)

    // Slug é único por (org, dono): outro dono pode repetir.
    const doDono = await criarPainel({ userId: DONO, organizationId: ORG, papel: 'owner', nome: 'Painel do Conselho' })
    t(!('erro' in doDono) && doDono.slug === 'painel-do-conselho',
      'e outro DONO usa o mesmo slug sem conflito')

    t(erroDe(await criarPainel({ userId: ADMIN, organizationId: ORG, papel: 'admin', nome: '   ' })) !== null,
      'nome em branco é recusado')

    // Um padrão por usuário: criar outro como padrão desmarca o anterior.
    const outro = await criarPainel({ userId: ADMIN, organizationId: ORG, papel: 'admin', nome: 'Operacao', padrao: true })
    if ('erro' in outro) throw new Error(outro.erro)
    const doAdmin = (await listarPaineis(ADMIN, ORG)).filter(p => p.donoUserId === ADMIN)
    t(doAdmin.filter(p => p.padrao).length === 1, 'só UM painel padrão por usuário')
    t(doAdmin.find(p => p.padrao)?.id === outro.id, 'e é o último marcado')
  }

  // ═══ 7. Blocos ════════════════════════════════════════════════════════════
  console.log('\n── 7. blocos ──')
  let blocoA = '', blocoB = ''
  {
    const specA = {
      versao: 1, tipo: 'ranking', titulo: 'Top 5 UENs',
      query: {
        fonte: 'realizado', medidas: ['saidas'], agruparPor: ['unidade_de_negocio'],
        periodo: { tipo: 'relativo', meses: 1 }, ordenarPor: [{ por: 'saidas', direcao: 'desc' }], limite: 5,
      },
    }
    const a = await adicionarBloco({ userId: ADMIN, organizationId: ORG, papel: 'admin', painelId, spec: specA })
    t(!('erro' in a), 'admin adiciona bloco (o "top 5 UENs" que motivou o motor)')
    if ('erro' in a) throw new Error(a.erro)
    blocoA = a.id

    const b = await adicionarBloco({
      userId: ADMIN, organizationId: ORG, papel: 'admin', painelId,
      spec: { versao: 1, tipo: 'texto', markdown: 'Anotação do conselho' },
    })
    if ('erro' in b) throw new Error(b.erro)
    blocoB = b.id

    const lido = await lerPainel(ADMIN, ORG, painelId)
    t(!('erro' in lido) && lido.painel.blocos.length === 2, 'o painel lê os 2 blocos')
    if (!('erro' in lido)) {
      t(lido.painel.blocos[0].id === blocoA && lido.painel.blocos[0].posicao === 0, 'na ordem de inserção')
      t(lido.painel.blocos[0].titulo === 'Top 5 UENs', 'com o título vindo da spec')
    }

    t(erroDe(await adicionarBloco({
      userId: ADMIN, organizationId: ORG, papel: 'admin', painelId,
      spec: { versao: 1, tipo: 'kpi', query: { fonte: 'realizado', medidas: ['valor_liquido'], agruparPor: ['mes'], periodo: { tipo: 'relativo', meses: 1 } } },
    })) !== null, 'spec inválida é recusada e NADA é gravado')
    const depois = await lerPainel(ADMIN, ORG, painelId)
    t(!('erro' in depois) && depois.painel.blocos.length === 2, 'confirmado: continua com 2 blocos')

    t(erroDe(await adicionarBloco({
      userId: OPERADOR, organizationId: ORG, papel: 'member', painelId,
      spec: { versao: 1, tipo: 'texto', markdown: 'nao' },
    })) !== null, 'member NÃO adiciona bloco')

    // Reordenar: a lista tem de bater com o conjunto atual.
    t(erroDe(await reordenarBlocos({ userId: ADMIN, organizationId: ORG, papel: 'admin', painelId, ordem: [blocoB] })) !== null,
      'reordenar com lista incompleta é RECUSADO (alguém mexeu no intervalo)')
    t(erroDe(await reordenarBlocos({ userId: ADMIN, organizationId: ORG, papel: 'admin', painelId, ordem: [blocoB, blocoB] })) !== null,
      'e com id repetido também')
    const r = await reordenarBlocos({ userId: ADMIN, organizationId: ORG, papel: 'admin', painelId, ordem: [blocoB, blocoA] })
    t(!('erro' in r), 'reordenar com a lista completa funciona')
    const reordenado = await lerPainel(ADMIN, ORG, painelId)
    t(!('erro' in reordenado) && reordenado.painel.blocos[0].id === blocoB, 'e a ordem inverteu de verdade')

    const ed = await editarBloco({
      userId: ADMIN, organizationId: ORG, papel: 'admin', painelId, blocoId: blocoB,
      spec: { versao: 1, tipo: 'texto', markdown: 'Anotação revisada' },
    })
    t(!('erro' in ed), 'editar bloco funciona')
    t(erroDe(await editarBloco({
      userId: ADMIN, organizationId: ORG, papel: 'admin', painelId, blocoId: blocoA,
      spec: { versao: 1, tipo: 'texto' },
    })) !== null, 'editar com spec inválida é recusado')

    // Bloco de outro painel não é alcançável por este.
    const outroPainel = await criarPainel({ userId: ADMIN, organizationId: ORG, papel: 'admin', nome: 'Outro' })
    if ('erro' in outroPainel) throw new Error(outroPainel.erro)
    t(erroDe(await removerBloco({
      userId: ADMIN, organizationId: ORG, papel: 'admin', painelId: outroPainel.id, blocoId: blocoA,
    })) !== null, 'bloco de um painel não é removível por outro painel')
  }

  // ═══ 8. Compartilhamento ══════════════════════════════════════════════════
  console.log('\n── 8. compartilhamento ──')
  {
    // Antes: o leitor não vê o painel do admin.
    t((await listarPaineis(LEITOR, ORG)).length === 0, 'leitor não vê painel de ninguém, por padrão')
    t(erroDe(await lerPainel(LEITOR, ORG, painelId)) !== null, 'e lerPainel recusa com motivo')

    t(erroDe(await compartilharPainel({
      userId: LEITOR, organizationId: ORG, papel: 'viewer', painelId,
      alvo: { escopo: 'organizacao' }, permissao: 'ler',
    })) !== null, 'viewer não compartilha')

    t(erroDe(await compartilharPainel({
      userId: DONO, organizationId: ORG, papel: 'owner', painelId,
      alvo: { escopo: 'organizacao' }, permissao: 'ler',
    })) !== null, 'nem o OWNER da organização compartilha painel alheio — só o dono do painel')

    const sh = await compartilharPainel({
      userId: ADMIN, organizationId: ORG, papel: 'admin', painelId,
      alvo: { escopo: 'organizacao' }, permissao: 'ler',
    })
    t(!('erro' in sh), 'o dono do painel compartilha com a organização')

    const doLeitor = await listarPaineis(LEITOR, ORG)
    t(doLeitor.length === 1 && doLeitor[0].id === painelId, 'agora o leitor VÊ o painel')
    t(doLeitor[0].permissao === 'ler', 'com permissão de leitura')
    const leituraDoLeitor = await lerPainel(LEITOR, ORG, painelId)
    t(!('erro' in leituraDoLeitor) && leituraDoLeitor.painel.blocos.length === 2, 'e lê os blocos')

    // Compartilhado com 'ler' não deixa editar — nem quem é admin.
    t(erroDe(await adicionarBloco({
      userId: DONO, organizationId: ORG, papel: 'owner', painelId,
      spec: { versao: 1, tipo: 'texto', markdown: 'nao' },
    })) !== null, 'compartilhado com "ler" NÃO deixa editar, nem o owner')

    // Upsert: repetir o alvo altera a permissão em vez de duplicar.
    const sh2 = await compartilharPainel({
      userId: ADMIN, organizationId: ORG, papel: 'admin', painelId,
      alvo: { escopo: 'organizacao' }, permissao: 'editar',
    })
    t(!('erro' in sh2) && !('erro' in sh) && sh2.id === sh.id, 'recompartilhar o mesmo alvo ATUALIZA (não duplica)')

    const comEdicao = await lerPainel(DONO, ORG, painelId)
    t(!('erro' in comEdicao) && comEdicao.painel.permissao === 'editar', 'a permissão virou edição')
    const add = await adicionarBloco({
      userId: DONO, organizationId: ORG, papel: 'owner', painelId,
      spec: { versao: 1, tipo: 'texto', markdown: 'Agora posso' },
    })
    t(!('erro' in add), 'e agora o owner edita o painel do admin')
    // Mas ainda não é dele: apagar e compartilhar seguem sendo do dono.
    t(erroDe(await apagarPainel({ userId: DONO, organizationId: ORG, papel: 'owner', painelId })) !== null,
      'permissão de edição NÃO dá direito de apagar')
    t(erroDe(await atualizarPainel({ userId: DONO, organizationId: ORG, papel: 'owner', painelId, padrao: true })) !== null,
      'nem de marcar como padrão (o padrão é de cada usuário)')
    // E o member continua fora, mesmo com o painel compartilhado para editar.
    t(erroDe(await adicionarBloco({
      userId: OPERADOR, organizationId: ORG, papel: 'member', painelId,
      spec: { versao: 1, tipo: 'texto', markdown: 'nao' },
    })) !== null, 'member segue recusado mesmo com share "editar" (o papel vem primeiro)')

    // Compartilhar com pessoa exige vínculo aceito.
    t(erroDe(await compartilharPainel({
      userId: ADMIN, organizationId: ORG, papel: 'admin', painelId,
      alvo: { escopo: 'usuarios', userId: ESTRANHO }, permissao: 'ler',
    })) !== null, 'compartilhar com quem não é membro é recusado')

    const shUser = await compartilharPainel({
      userId: ADMIN, organizationId: ORG, papel: 'admin', painelId,
      alvo: { escopo: 'usuarios', userId: OPERADOR }, permissao: 'ler',
    })
    t(!('erro' in shUser), 'compartilhar com um membro específico funciona')

    if (!('erro' in shUser)) {
      t(erroDe(await removerCompartilhamento({
        userId: DONO, organizationId: ORG, papel: 'owner', painelId, shareId: shUser.id,
      })) !== null, 'quem não é dono não remove compartilhamento')
      const rm = await removerCompartilhamento({
        userId: ADMIN, organizationId: ORG, papel: 'admin', painelId, shareId: shUser.id,
      })
      t(!('erro' in rm), 'o dono remove')
    }
  }

  // ═══ 9. Isolamento entre organizações ═════════════════════════════════════
  console.log('\n── 9. isolamento ──')
  {
    // O painel existe, o usuário é OWNER da outra org — e mesmo assim é
    // inexistente ali: a query filtra organization_id.
    t(erroDe(await lerPainel(DONO, ORG_B, painelId)) !== null, 'painel de outra organização não é encontrado')
    t((await listarPaineis(DONO, ORG_B)).length === 0, 'e não aparece na listagem dela')
    t(erroDe(await adicionarBloco({
      userId: DONO, organizationId: ORG_B, papel: 'owner', painelId,
      spec: { versao: 1, tipo: 'texto', markdown: 'nao' },
    })) !== null, 'nem aceita bloco pela organização errada')

    // O bloco carrega a organização desnormalizada — e ela tem de ser a certa.
    const blocosDaOrg = await db.select({ id: dashboardBlocks.id })
      .from(dashboardBlocks)
      .where(eq(dashboardBlocks.organizationId, ORG))
    const todosOsBlocos = await db.select({ id: dashboardBlocks.id })
      .from(dashboardBlocks)
      .innerJoin(dashboards, eq(dashboards.id, dashboardBlocks.dashboardId))
      .where(eq(dashboards.organizationId, ORG))
    t(blocosDaOrg.length === todosOsBlocos.length && blocosDaOrg.length > 0,
      `a organização desnormalizada do bloco bate com a do painel (${blocosDaOrg.length})`)
  }

  // ═══ 10. Materializar o padrão ════════════════════════════════════════════
  console.log('\n── 10. materializar o painel padrão ──')
  {
    t(erroDe(await materializarPainelPadrao({ userId: LEITOR, organizationId: ORG, papel: 'viewer' })) !== null,
      'viewer não materializa (é o motivo do padrão ser virtual)')

    const m = await materializarPainelPadrao({ userId: DONO, organizationId: ORG, papel: 'owner' })
    t(!('erro' in m), 'owner materializa')
    if ('erro' in m) throw new Error(m.erro)

    const lido = await lerPainel(DONO, ORG, m.id)
    t(!('erro' in lido) && lido.painel.blocos.length === 8, 'com os 8 blocos gravados')
    t(!('erro' in lido) && lido.painel.slug === PAINEL_PADRAO_SLUG && lido.painel.padrao, 'como painel padrão')
    t(!('erro' in lido) && lido.painel.blocos.every(b => b.spec !== null && b.erroDeSpec === null),
      'e TODAS as 8 specs voltam válidas da leitura')

    t(erroDe(await materializarPainelPadrao({ userId: DONO, organizationId: ORG, papel: 'owner' })) !== null,
      'materializar duas vezes é recusado')

    // Executar um bloco lido DO BANCO (round-trip por jsonb) tem de dar o mesmo
    // número que executar a spec em memória.
    if (!('erro' in lido)) {
      const kpiDoBanco = lido.painel.blocos.find(b => b.spec?.tipo === 'kpi')
      t(!!kpiDoBanco?.spec, 'achei um KPI gravado')
      if (kpiDoBanco?.spec) {
        const r = await executarBloco(scope, kpiDoBanco.spec, { mes: MES })
        t(r.tipo === 'kpi' && r.valor === 15000, `e executado do BANCO devolve 15.000 (${r.tipo === 'kpi' ? r.valor : '?'})`)
      }
    }
  }

  // ═══ 11. Bloco quebrado não derruba o painel ══════════════════════════════
  console.log('\n── 11. spec corrompida na leitura ──')
  {
    const p = await criarPainel({ userId: ADMIN, organizationId: ORG, papel: 'admin', nome: 'Com bloco quebrado' })
    if ('erro' in p) throw new Error(p.erro)
    await adicionarBloco({
      userId: ADMIN, organizationId: ORG, papel: 'admin', painelId: p.id,
      spec: { versao: 1, tipo: 'texto', markdown: 'bloco bom' },
    })
    // Gravação por fora do store, simulando spec de uma versão futura do app.
    await db.insert(dashboardBlocks).values({
      dashboardId: p.id, organizationId: ORG, position: 1,
      spec: { versao: 1, tipo: 'grafico_que_nao_existe', foo: 1 },
    })

    const lido = await lerPainel(ADMIN, ORG, p.id)
    t(!('erro' in lido) && lido.painel.blocos.length === 2, 'o painel ainda lê os 2 blocos')
    if (!('erro' in lido)) {
      t(lido.painel.blocos[0].spec !== null, 'o bloco bom continua válido')
      t(lido.painel.blocos[1].spec === null && !!lido.painel.blocos[1].erroDeSpec,
        `e o quebrado vem com o motivo ("${lido.painel.blocos[1].erroDeSpec}")`)
    }
  }

  // ═══ 12. Apagar leva blocos e shares (CASCADE) ════════════════════════════
  console.log('\n── 12. apagar painel ──')
  {
    const antes = await db.select({ id: dashboardBlocks.id })
      .from(dashboardBlocks).where(eq(dashboardBlocks.dashboardId, painelId))
    const sharesAntes = await db.select({ id: dashboardShares.id })
      .from(dashboardShares).where(eq(dashboardShares.dashboardId, painelId))
    t(antes.length > 0 && sharesAntes.length > 0, `o painel tem ${antes.length} blocos e ${sharesAntes.length} share(s)`)

    t(erroDe(await apagarPainel({ userId: OPERADOR, organizationId: ORG, papel: 'member', painelId })) !== null,
      'member não apaga')
    const del = await apagarPainel({ userId: ADMIN, organizationId: ORG, papel: 'admin', painelId })
    t(!('erro' in del), 'o dono apaga')

    const depois = await db.select({ id: dashboardBlocks.id })
      .from(dashboardBlocks).where(eq(dashboardBlocks.dashboardId, painelId))
    const sharesDepois = await db.select({ id: dashboardShares.id })
      .from(dashboardShares).where(eq(dashboardShares.dashboardId, painelId))
    t(depois.length === 0 && sharesDepois.length === 0, 'e o CASCADE levou blocos e compartilhamentos')
    t(erroDe(await lerPainel(ADMIN, ORG, painelId)) !== null, 'o painel some da leitura')
  }

  // ═══ 13. O motor continua respondendo direto (regressão do agrupamento) ═══
  console.log('\n── 13. agrupamento semana no motor ──')
  {
    const r = await runQuery(scope, {
      fonte: 'realizado', medidas: ['entradas', 'saidas'], agruparPor: ['semana'],
      periodo: { tipo: 'intervalo', de: '2026-03-01', ate: '2026-03-31', regime: 'caixa' },
      filtros: { excluirBalanco: false, visibilidade: 'todas' },
      ordenarPor: [{ por: 'semana', direcao: 'asc' }],
      limite: 100,
    })
    // Os 4 lançamentos (5, 8, 12 e 20 de março) caem em TRÊS semanas: 8/mar é
    // domingo, e na convenção ISO ele fecha a semana que começou em 2/mar. Se
    // a semana começasse no domingo, seriam 4 — é o que esta contagem prova.
    t(r.linhas.length === 3, `os 4 lançamentos caem em 3 semanas ISO (${r.linhas.length})`)
    const chaves = r.linhas.map(l => l.chaves[0].id as string)
    t(chaves[0] === '2026-03-02', `a primeira semana é a de 02/03 (${chaves[0]})`)
    t(r.linhas[0].medidas.entradas === 10000 && r.linhas[0].medidas.saidas === 3000,
      'e ela soma o lançamento de quinta (dia 5) com o de domingo (dia 8) — a prova de que a semana começa na SEGUNDA')
    const soma = r.linhas.reduce((s, l) => s + l.medidas.entradas - l.medidas.saidas, 0)
    t(soma === 11000, `e a soma das 3 bate com o mês: 11.000 (${soma})`)
    t(chaves.join() === [...chaves].sort().join(), 'em ordem cronológica')
  }

  // ═══ Fim ═════════════════════════════════════════════════════════════════
  await limpar()
  const restou = await db.select({ id: dashboards.id })
    .from(dashboards)
    .where(sql`${dashboards.organizationId} IN (${ORG}::uuid, ${ORG_B}::uuid)`)
  t(restou.length === 0, 'limpeza: nenhum painel de teste sobrou')

  console.log(`\n${ok + falhas} verificações — ${ok} OK, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('\nERRO:', e)
  await limpar().catch(() => {})
  process.exit(1)
})
