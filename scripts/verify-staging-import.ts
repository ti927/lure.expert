/**
 * Exercita a importação pela TELA contra o banco de verdade.
 *
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-staging-import.ts
 *
 * O critério da sessão 4.5.B é o DoD literal da Sessão 2.8 do
 * `GUIA_OPERACIONAL.md`, escrito e nunca construído: **"reuploadar mesmo
 * arquivo, ver 0 inserções"**. É o caso 4.
 *
 * Escreve, então cria a própria organização e a apaga no fim — o CASCADE leva
 * lançamentos, documentos, fontes e categorias. Escrever no dado de um cliente
 * para testar seria mexer na contabilidade dele. Se o script morrer no meio, a
 * organização sobra com o nome `ZZ Teste importacao` e a execução seguinte a
 * remove.
 */
import { db } from '@/db'
import {
  organizations, memberships, transactions, documents,
  transactionsStaging, dataSources, categories,
} from '@/db/schema'
import { and, eq, sql, inArray } from 'drizzle-orm'
import { planejarStaging, cabecalhoDoDocumento, lerContaDoDocumento } from '@/lib/staging-import'
import { garantirContaManual, listarContasManuais, apagarContaManual } from '@/lib/accounts'
import { contaCanonica } from '@/lib/import-contract'
import { findCategoryByText, loadOrgContext } from '@/lib/categorizer'
import { BP_TYPES } from '@/lib/bp-types'
import { buildImportTemplateCsv } from '@/lib/csv-templates'
import { parseExcelOrCsv } from '@/lib/parsers/excel-csv'

const NOME_ORG = 'ZZ Teste importacao'
const USUARIO = '44444444-4444-4444-4444-444444444444'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

type LinhaCrua = {
  rowIndex: number
  date?: string | null
  effectiveDate?: string | null
  amount?: string | null
  direction?: string | null
  description?: string | null
  rawData?: Record<string, unknown>
}

async function main() {
  await db.delete(organizations).where(eq(organizations.name, NOME_ORG))

  const [org] = await db.insert(organizations).values({
    name: NOME_ORG, slug: `zz-teste-importacao-${Date.now()}`,
  }).returning({ id: organizations.id })
  const ORG = org.id
  await db.insert(memberships).values({
    userId: USUARIO, organizationId: ORG, role: 'owner', acceptedAt: new Date(),
  })

  // Cria um documento e as linhas de staging dele, como o parser faria.
  async function documentoCom(
    linhas: LinhaCrua[],
    opts: { reportType?: string; referenceDate?: string | null; conta?: unknown; sourceType?: string } = {},
  ) {
    const [doc] = await db.insert(documents).values({
      organizationId: ORG,
      type: 'statement',
      filename: `teste-${Date.now()}-${Math.round(linhas.length)}.csv`,
      storagePath: `teste://${ORG}/${linhas.length}`,
      mimeType: 'text/csv',
      sizeBytes: 1,
      extractionStatus: 'completed',
      reportType: opts.reportType ?? 'other',
      referenceDate: opts.referenceDate ?? null,
      metadata: { source_type: opts.sourceType ?? 'bank', ...(opts.conta ? { account: opts.conta } : {}) },
    }).returning()

    if (linhas.length > 0) {
      await db.insert(transactionsStaging).values(linhas.map(l => ({
        organizationId: ORG,
        documentId: doc.id,
        rowIndex: l.rowIndex,
        rawData: l.rawData ?? {},
        date: l.date ?? null,
        effectiveDate: l.effectiveDate ?? null,
        amount: l.amount ?? null,
        direction: l.direction ?? null,
        description: l.description ?? null,
        status: 'approved' as const,
      })))
    }
    return doc
  }

  const lerLinhas = (documentId: string) => db
    .select().from(transactionsStaging)
    .where(eq(transactionsStaging.documentId, documentId))
    .orderBy(transactionsStaging.rowIndex)

  // Replica o insert de `approveAndInsert` — a parte que a server action faz
  // além do plano. Devolve quantas linhas ENTRARAM, não quantas foram tentadas.
  async function gravar(plano: Awaited<ReturnType<typeof planejarStaging>>, documentId: string, fonteId: string) {
    if ('error' in plano) throw new Error(plano.error)
    if (plano.aInserir.length === 0) return 0
    const values = plano.aInserir.map(({ staging, valor, chave }) => ({
      organizationId: ORG,
      dataSourceId: fonteId,
      externalId: chave,
      date: valor.date,
      effectiveDate: valor.effectiveDate,
      amount: valor.amount,
      currency: valor.currency,
      direction: valor.direction,
      description: valor.description,
      accountId: valor.accountId,
      accountName: valor.accountName,
      accountType: valor.accountType,
      accountNumber: valor.accountNumber,
      documentId,
      rawData: staging.rawData ?? {},
      metadata: { stagingId: staging.id },
      status: 'confirmed' as const,
    }))
    const q = db.insert(transactions).values(values)
    const rows = await (plano.deduplicando ? q.onConflictDoNothing() : q).returning({ id: transactions.id })
    return rows.length
  }

  const [fonte] = await db.insert(dataSources).values({
    organizationId: ORG, type: 'bank', provider: 'upload', name: 'Upload — teste',
  }).returning({ id: dataSources.id })

  // ═══ 1. Cabeçalho do arquivo ══════════════════════════════════════════════
  console.log('\n── 1. o nível de ARQUIVO ──')
  {
    const doc = await documentoCom([], {})
    const cab = cabecalhoDoDocumento(doc)
    t(!('error' in cab) && cab.tipoDeRelatorio === 'movimentos', 'documento comum → tipoDeRelatorio "movimentos"')

    const bpSemData = await documentoCom([], { reportType: 'balance_sheet' })
    const cabBp = cabecalhoDoDocumento(bpSemData)
    t('error' in cabBp, `balanço SEM data de referência é recusado — ${'error' in cabBp ? cabBp.error.slice(0, 60) : 'passou!'}`)

    const bpOk = await documentoCom([], { reportType: 'balance_sheet', referenceDate: '2026-01-31' })
    const cabBpOk = cabecalhoDoDocumento(bpOk)
    t(!('error' in cabBpOk) && cabBpOk.tipoDeRelatorio === 'balanco' && cabBpOk.dataDeReferencia === '2026-01-31',
      'balanço COM data de referência resolve')

    const comConta = await documentoCom([], { conta: { nome: 'Itaú PJ', tipo: 'CHECKING_ACCOUNT', numero: '12345-6' } })
    const lida = lerContaDoDocumento(comConta)
    t(lida?.nome === 'Itaú PJ' && lida?.numero === '12345-6', 'a conta do arquivo é lida de documents.metadata')
  }

  // ═══ 2. A data de caixa — o defeito que originou a sessão ═════════════════
  console.log('\n── 2. data de caixa ──')
  {
    const doc = await documentoCom([
      { rowIndex: 0, date: '2026-01-10', effectiveDate: '2026-02-05', amount: '100.00', direction: 'outflow', description: 'Compra no cartao' },
      { rowIndex: 1, date: '2026-01-11', effectiveDate: null,         amount: '200.00', direction: 'inflow',  description: 'Recebimento' },
    ])
    const plano = await planejarStaging(ORG, doc, await lerLinhas(doc.id))
    if ('error' in plano) { t(false, plano.error); return }

    const [a, b] = plano.normalizadas
    t(a.valor.date === '2026-01-10' && a.valor.effectiveDate === '2026-02-05',
      'data de caixa preenchida CHEGA diferente da competência (era o bug: 0 em 10.365 na base)')
    t(b.valor.date === '2026-01-11' && b.valor.effectiveDate === '2026-01-11',
      'data de caixa em branco = igual à competência')
  }

  // ═══ 3. Recusa por LINHA, não por lote ════════════════════════════════════
  console.log('\n── 3. recusa por linha ──')
  {
    const doc = await documentoCom([
      { rowIndex: 0, date: '2026-01-10', amount: '100.00', direction: 'outflow', description: 'Boa' },
      { rowIndex: 1, date: null,         amount: '100.00', direction: 'outflow', description: 'Sem data' },
      { rowIndex: 2, date: '2026-01-12', amount: null,     direction: 'outflow', description: 'Sem valor' },
      { rowIndex: 3, date: '2026-01-13', amount: '50.00',  direction: null,      description: 'Sem sentido' },
      { rowIndex: 4, date: '2026-01-14', amount: '0.00',   direction: 'inflow',  description: 'Valor zero' },
      { rowIndex: 5, date: '2026-01-15', amount: '70.00',  direction: 'inflow',  description: '' },
      { rowIndex: 6, date: '2026-01-16', amount: '80.00',  direction: 'inflow',  description: 'Outra boa' },
    ])
    const plano = await planejarStaging(ORG, doc, await lerLinhas(doc.id))
    if ('error' in plano) { t(false, plano.error); return }

    t(plano.normalizadas.length === 2, `2 linhas boas sobrevivem entre 5 ruins (foram ${plano.normalizadas.length})`)
    t(plano.recusadas.length === 5, `5 recusadas (foram ${plano.recusadas.length})`)
    const motivos = plano.recusadas.map(r => r.motivo)
    t(motivos.some(m => m.includes('competência')), 'recusa de data diz qual campo faltou')
    t(motivos.some(m => m.includes('Sentido')), 'recusa de sentido diz qual campo faltou')
    t(motivos.some(m => m.includes('zero')), 'valor zero é recusado com motivo próprio')
    t(plano.recusadas.every(r => typeof r.rowIndex === 'number'), 'cada recusa carrega o número da linha')
  }

  // ═══ 4. O DoD: mesmo arquivo duas vezes ═══════════════════════════════════
  console.log('\n── 4. o DoD da Sessão 2.8: reuploadar dá 0 inserções ──')
  {
    const linhas: LinhaCrua[] = [
      { rowIndex: 0, date: '2026-03-01', amount: '150.00', direction: 'outflow', description: 'MERCADO SAO JOAO' },
      { rowIndex: 1, date: '2026-03-02', amount: '89.90',  direction: 'outflow', description: 'NETFLIX' },
      { rowIndex: 2, date: '2026-03-03', amount: '5000.00', direction: 'inflow', description: 'CLIENTE ACME' },
    ]
    const doc1 = await documentoCom(linhas)
    const plano1 = await planejarStaging(ORG, doc1, await lerLinhas(doc1.id))
    if ('error' in plano1) { t(false, plano1.error); return }
    t(plano1.aInserir.length === 3 && plano1.duplicadas === 0, 'primeira importação: 3 novas, 0 duplicadas')
    const entrou1 = await gravar(plano1, doc1.id, fonte.id)
    t(entrou1 === 3, `primeira importação gravou 3 (gravou ${entrou1})`)

    // O MESMO arquivo, subido de novo — documento novo, linhas idênticas.
    const doc2 = await documentoCom(linhas)
    const plano2 = await planejarStaging(ORG, doc2, await lerLinhas(doc2.id))
    if ('error' in plano2) { t(false, plano2.error); return }
    t(plano2.aInserir.length === 0 && plano2.duplicadas === 3,
      `SEGUNDA importação do mesmo arquivo: 0 novas, 3 duplicadas (foram ${plano2.aInserir.length}/${plano2.duplicadas})`)
    const entrou2 = await gravar(plano2, doc2.id, fonte.id)
    t(entrou2 === 0, `SEGUNDA importação gravou 0 — o DoD literal (gravou ${entrou2})`)

    // Arquivo com sobreposição: 2 já conhecidas + 1 nova.
    const doc3 = await documentoCom([
      { rowIndex: 0, date: '2026-03-02', amount: '89.90', direction: 'outflow', description: 'NETFLIX' },
      { rowIndex: 1, date: '2026-03-03', amount: '5000.00', direction: 'inflow', description: 'CLIENTE ACME' },
      { rowIndex: 2, date: '2026-03-04', amount: '42.00', direction: 'outflow', description: 'PADARIA' },
    ])
    const plano3 = await planejarStaging(ORG, doc3, await lerLinhas(doc3.id))
    if ('error' in plano3) { t(false, plano3.error); return }
    t(plano3.aInserir.length === 1 && plano3.duplicadas === 2, 'lote sobreposto: só a linha nova entra')
    const entrou3 = await gravar(plano3, doc3.id, fonte.id)
    t(entrou3 === 1, `lote sobreposto gravou 1 (gravou ${entrou3})`)

    const [{ n }] = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM transactions WHERE organization_id = ${ORG}::uuid`)
    t(Number(n) === 4, `total na base: 4 lançamentos após 3 importações de 3 linhas (são ${n})`)
  }

  // ═══ 5. Ocorrência e ordem ════════════════════════════════════════════════
  console.log('\n── 5. linhas idênticas e a ordem do arquivo ──')
  {
    // Três cafés de R$ 15 no mesmo dia são TRÊS lançamentos legítimos.
    const doc = await documentoCom([
      { rowIndex: 0, date: '2026-04-01', amount: '15.00', direction: 'outflow', description: 'CAFE' },
      { rowIndex: 1, date: '2026-04-01', amount: '15.00', direction: 'outflow', description: 'CAFE' },
      { rowIndex: 2, date: '2026-04-01', amount: '15.00', direction: 'outflow', description: 'CAFE' },
    ])
    const plano = await planejarStaging(ORG, doc, await lerLinhas(doc.id))
    if ('error' in plano) { t(false, plano.error); return }
    const chaves = plano.normalizadas.map(n => n.chave)
    t(new Set(chaves).size === 3, `3 linhas idênticas → 3 chaves distintas (foram ${new Set(chaves).size})`)
    const entrou = await gravar(plano, doc.id, fonte.id)
    t(entrou === 3, `as 3 entram (entraram ${entrou})`)

    const doc2 = await documentoCom([
      { rowIndex: 0, date: '2026-04-01', amount: '15.00', direction: 'outflow', description: 'CAFE' },
      { rowIndex: 1, date: '2026-04-01', amount: '15.00', direction: 'outflow', description: 'CAFE' },
      { rowIndex: 2, date: '2026-04-01', amount: '15.00', direction: 'outflow', description: 'CAFE' },
    ])
    const plano2 = await planejarStaging(ORG, doc2, await lerLinhas(doc2.id))
    if ('error' in plano2) { t(false, plano2.error); return }
    t(plano2.duplicadas === 3, `reimportar os 3 cafés → 3 duplicadas, nenhuma nova (foram ${plano2.duplicadas})`)

    // Descrição com caixa e espaçamento diferentes é a MESMA linha: `norm` é
    // aplicado ao montar a assinatura.
    const doc3 = await documentoCom([
      { rowIndex: 0, date: '2026-04-01', amount: '15.00', direction: 'outflow', description: '  cafe  ' },
    ])
    const plano3 = await planejarStaging(ORG, doc3, await lerLinhas(doc3.id))
    if ('error' in plano3) { t(false, plano3.error); return }
    t(plano3.duplicadas === 1, 'descrição com caixa/espaço diferentes casa como duplicada')
  }

  // ═══ 6. Balanço ═══════════════════════════════════════════════════════════
  console.log('\n── 6. balanço: a porta que nunca funcionou ──')
  {
    // ACHADO DA SESSÃO, medido no banco: `seed_categories_for_org` **não cria
    // nenhuma natureza de BP** — a função não menciona um único tipo de balanço,
    // e das 6 organizações só "Empresa Testes 1" tem naturezas de BP, criadas à
    // mão. Ou seja, além dos dois defeitos de código, uma organização nova não
    // teria contra o que classificar um balanço. Está fora do escopo desta
    // sessão (é decisão de produto — qual plano de contas patrimonial padrão),
    // mas o teste precisa criar as suas para exercitar o caminho.
    const ctxAntes = await loadOrgContext(ORG)
    const bpSet = new Set<string>(BP_TYPES)
    t(ctxAntes.categories.filter(c => bpSet.has(c.type)).length === 0,
      'o seed NÃO cria naturezas de BP — organização nova não tem contra o que classificar um balanço')

    // Códigos com PONTO de propósito: é o formato real de plano de contas, e é
    // o que exercita a distinção entre `norm` (preserva pontuação) e
    // `normalizeForMatch` (colapsa) no casamento por código. Com códigos sem
    // ponto o teste passaria e o prefixo continuaria quebrado.
    // O prefixo `11.` evita colidir com os códigos do seed de DRE.
    const [pai] = await db.insert(categories).values({
      organizationId: ORG, code: '11.1', name: 'Ativo Circulante', type: 'ativo_circulante',
    }).returning({ id: categories.id })
    await db.insert(categories).values([
      { organizationId: ORG, code: '11.1.01', name: 'Caixa e Equivalentes', type: 'ativo_circulante', parentId: pai.id },
      { organizationId: ORG, code: '11.1.02', name: 'Contas a Receber',     type: 'ativo_circulante', parentId: pai.id },
    ])

    const ctx = await loadOrgContext(ORG)
    const folhasBp = ctx.categories.filter(c => bpSet.has(c.type))
    t(folhasBp.length === 2, `2 naturezas de BP criadas para o teste (são ${folhasBp.length})`)
    const exemplo = folhasBp.find(c => c.name === 'Caixa e Equivalentes')!

    // Uma linha de balanço NÃO tem data nem sentido — os dois vêm do arquivo.
    const doc = await documentoCom([
      { rowIndex: 0, date: null, amount: '45200.00', direction: null, description: exemplo.name },
      { rowIndex: 1, date: null, amount: '310000.00', direction: null, description: 'Conta que nao existe no plano' },
    ], { reportType: 'balance_sheet', referenceDate: '2026-01-31', sourceType: 'balance_sheet' })

    const plano = await planejarStaging(ORG, doc, await lerLinhas(doc.id))
    if ('error' in plano) { t(false, plano.error); return }

    t(plano.normalizadas.length === 2,
      `as 2 linhas de balanço passam SEM data e SEM sentido próprios (passaram ${plano.normalizadas.length}) ` +
      '— antes o filtro `date && amount && direction` engolia o balanço inteiro')
    t(plano.normalizadas.every(n => n.valor.date === '2026-01-31' && n.valor.effectiveDate === '2026-01-31'),
      'a data de cada linha HERDA a data de referência do arquivo')
    t(plano.normalizadas.every(n => n.valor.direction === 'inflow'), 'toda linha de balanço entra como inflow — quem dá o lado é a natureza')
    t(plano.normalizadas[0].valor.description === exemplo.name, 'a descrição da linha de balanço é a conta patrimonial')
    t(plano.deduplicando === false, 'balanço NÃO deduplica — snapshot se substitui, não se acumula')
    t(plano.normalizadas.every(n => n.chave === null), 'linha de balanço não recebe chave de dedup')

    // A camada 0 pelo texto: sem ela o BP entra sem natureza e `getBpData`,
    // que soma por tipo de categoria, ignoraria a linha — o BP seria inútil.
    const casada = findCategoryByText(exemplo.name, folhasBp)
    t(casada === exemplo.id, `a conta do balanço casa com a natureza do plano pelo nome ("${exemplo.name}")`)
    if (exemplo.code) {
      t(findCategoryByText(exemplo.code, folhasBp) === exemplo.id, `casa também pelo código ("${exemplo.code}")`)
      t(findCategoryByText(`${exemplo.code} ${exemplo.name}`, folhasBp) === exemplo.id, 'casa por "código + nome" na mesma célula')
    }
    t(findCategoryByText('Conta que nao existe no plano', folhasBp) === null, 'conta desconhecida não casa — vai para a fila em vez de casar errado')

    // Reenviar o balanço corrigido precisa entrar de novo, senão o documento
    // novo ficaria vazio e `/balanco` passaria a mostrar o vazio.
    const entrou = await gravar(plano, doc.id, fonte.id)
    t(entrou === 2, `balanço grava 2 (gravou ${entrou})`)
    const doc2 = await documentoCom([
      { rowIndex: 0, date: null, amount: '45200.00', direction: null, description: exemplo.name },
    ], { reportType: 'balance_sheet', referenceDate: '2026-01-31', sourceType: 'balance_sheet' })
    const plano2 = await planejarStaging(ORG, doc2, await lerLinhas(doc2.id))
    if ('error' in plano2) { t(false, plano2.error); return }
    const entrou2 = await gravar(plano2, doc2.id, fonte.id)
    t(entrou2 === 1, `reenviar o balanço corrigido ENTRA de novo (entrou ${entrou2}) — se deduplicasse, o documento novo ficaria vazio`)
  }

  // ═══ 7. Conta manual ══════════════════════════════════════════════════════
  console.log('\n── 7. conta manual: o cadastro que não existia ──')
  {
    const criada = await garantirContaManual(ORG, 'Caixa', 'Outra', null)
    t(!('error' in criada) && criada.accountId === 'arq:caixa', `conta "Caixa" nasce com accountId determinístico`)

    const denovo = await garantirContaManual(ORG, '  caixa ', 'Outra', null)
    t(!('error' in denovo) && !('error' in criada) && denovo.dataSourceId === criada.dataSourceId,
      '"  caixa " e "Caixa" são a MESMA conta — o slug derruba caixa e espaço')
    t(!('error' in denovo) && denovo.nome === 'Caixa',
      'a grafia EXISTENTE vence — importar um arquivo não renomeia a conta que a pessoa criou')

    const outra = await garantirContaManual(ORG, 'Itaú PJ', 'C. Corrente', '12345-6')
    const outraGrafia = await garantirContaManual(ORG, 'itau pj', 'C. Corrente', '12345-6')
    t(!('error' in outra) && !('error' in outraGrafia) && outra.dataSourceId === outraGrafia.dataSourceId,
      '"Itaú PJ" e "itau pj" colapsam — acento e caixa não criam conta nova')
    t(contaCanonica('Itaú Pessoa Jurídica').accountId !== contaCanonica('Itaú PJ').accountId,
      'grafias REALMENTE diferentes viram contas diferentes — é o risco que a tela mitiga oferecendo as existentes')

    const listadas = await listarContasManuais(ORG)
    t(listadas.length === 2, `2 contas manuais listadas (foram ${listadas.length})`)
    t(listadas.every(c => c.lancamentos === 0), 'contagem de uso começa em zero')

    // O que faz o rótulo do filtro de /transacoes sair certo.
    const [ds] = await db.select({ metadata: dataSources.metadata })
      .from(dataSources).where(eq(dataSources.id, (criada as { dataSourceId: string }).dataSourceId))
    const meta = (ds.metadata ?? {}) as Record<string, unknown>
    t(meta.institutionName === 'Caixa',
      'a fonte manual carrega institutionName — é o que impede o filtro de /transacoes de exibir a palavra "Banco"')
    t(Array.isArray(meta.accounts) && (meta.accounts as unknown[]).length === 1,
      'a fonte manual carrega metadata.accounts no mesmo formato do Pluggy — é o que /contas sabe desenhar')

    // Importar declarando a conta grava as quatro colunas.
    const doc = await documentoCom([
      { rowIndex: 0, date: '2026-05-01', amount: '99.00', direction: 'outflow', description: 'SAQUE' },
    ], { conta: { nome: 'Caixa', tipo: 'OTHER', numero: null } })
    const plano = await planejarStaging(ORG, doc, await lerLinhas(doc.id))
    if ('error' in plano) { t(false, plano.error); return }
    const v = plano.normalizadas[0].valor
    t(v.accountId === 'arq:caixa' && v.accountName === 'Caixa' && v.accountType === 'OTHER',
      'a conta do arquivo chega nas quatro colunas do lançamento (eram 0 de 7.762 na base)')

    await gravar(plano, doc.id, (criada as { dataSourceId: string }).dataSourceId)
    const comUso = await listarContasManuais(ORG)
    const caixa = comUso.find(c => c.nome === 'Caixa')!
    t(caixa.lancamentos === 1, `a contagem de uso sobe (é ${caixa.lancamentos})`)

    const recusa = await apagarContaManual(ORG, caixa.dataSourceId)
    t('error' in recusa && recusa.error.includes('1 lançamento'),
      'apagar conta COM lançamento é recusado, com o número na mensagem')

    const itau = comUso.find(c => c.nome === 'Itaú PJ')!
    const apagou = await apagarContaManual(ORG, itau.dataSourceId)
    t('ok' in apagou, 'apagar conta SEM lançamento funciona')
    t((await listarContasManuais(ORG)).length === 1, 'sobrou 1 conta manual')

    // O rótulo, como o filtro de /transacoes o monta.
    const rotulos = await db.execute<{ institution_name: string | null; account_name: string | null }>(sql`
      SELECT coalesce(ds.metadata->>'customLabel', ds.metadata->>'institutionName') AS institution_name,
             t.account_name
        FROM transactions t JOIN data_sources ds ON t.data_source_id = ds.id
       WHERE t.organization_id = ${ORG}::uuid AND t.account_id IS NOT NULL
       GROUP BY 1, 2`)
    t(rotulos.length === 1 && rotulos[0].institution_name === 'Caixa',
      'o filtro de /transacoes acha a instituição pela fonte — sem a fonte própria sairia "Banco" literal')
  }

  // ═══ 8. O caminho rápido do parser (4.5.C) ════════════════════════════════
  console.log('\n── 8. a planilha modelo é lida pelo proprio parser, sem IA ──')
  {
    const ctxParse = { organizationId: ORG, documentId: null }

    // O laço que importa: o arquivo que `/upload` OFERECE tem de ser legível
    // pelo parser sem adivinhação. Se o modelo fosse redigitado em vez de
    // gerado das colunas, isto quebraria — e só quando alguém o usasse.
    const modelo = Buffer.from(buildImportTemplateCsv('movimentos'), 'utf8')
    const p = await parseExcelOrCsv(modelo, ctxParse, 'text/csv')
    t(p.canonico === true, 'a planilha modelo de lançamentos casa com o formato canônico')
    t(p.rows.length === 3, `as 3 linhas de exemplo do modelo são lidas (foram ${p.rows.length})`)
    t(p.rows.every(r => r.date !== null && r.amount !== null && r.direction !== null && r.description !== null),
      'toda linha do modelo sai com competência, valor, sentido e descrição')

    // A prova de que o caminho rápido faz trabalho REAL: a heurística legada
    // procura 'data caixa' por `includes`, e o rótulo canônico é "Data de
    // caixa" — com o "de" no meio, ela não acha. Só o casamento exato acha.
    const comCaixa = p.rows.find(r => r.effectiveDate && r.effectiveDate !== r.date)
    t(!!comCaixa, 'o exemplo de cartão sai com data de caixa DIFERENTE da competência')

    const contrato = (p.rows[0].rawData as Record<string, unknown>).__contrato as Record<string, string> | undefined
    t(!!contrato && !!contrato.conta, 'as colunas sem campo próprio na staging (conta, natureza…) viajam em __contrato')

    // Mesmo cabeçalho, uma coluna obrigatória renomeada → cai no caminho de
    // hoje. É a promessa da Fase 2 continuando de pé: qualquer formato entra.
    const quebrado = Buffer.from(
      buildImportTemplateCsv('movimentos').replace('Sentido', 'Tipo de movimento'),
      'utf8',
    )
    const q = await parseExcelOrCsv(quebrado, ctxParse, 'text/csv')
    t(q.canonico === false, 'cabeçalho sem uma coluna obrigatória NÃO é canônico — cai no caminho de sempre')
    t(q.rows.length === 3, 'e mesmo assim as linhas são lidas: o formato é atalho, nunca requisito')
    t(q.rows.every(r => r.effectiveDate === null),
      'a heurística legada perde "Data de caixa" (procura por `includes` e o "de" atrapalha) — ' +
      'é o trabalho real que o caminho rápido faz')

    // Coluna extra não pode desqualificar: export de ERP sempre traz colunas a mais.
    const comExtra = Buffer.from(
      buildImportTemplateCsv('movimentos').replace('Observação', 'Observação;Centro de resultado'),
      'utf8',
    )
    const e = await parseExcelOrCsv(comExtra, ctxParse, 'text/csv')
    t(e.canonico === true, 'coluna extra desconhecida NÃO desqualifica o caminho rápido')

    // Balanço: conta + saldo, sem data e sem sentido por linha.
    const modeloBp = Buffer.from(buildImportTemplateCsv('balanco'), 'utf8')
    const b = await parseExcelOrCsv(modeloBp, ctxParse, 'text/csv', 'balanco')
    t(b.canonico === true, 'a planilha modelo de balanço casa com o formato canônico')
    t(b.rows.length > 0 && b.rows.every(r => r.amount !== null && r.description !== null),
      `as ${b.rows.length} linhas de balanço saem com saldo e conta`)
    t(b.rows.every(r => r.date === null),
      'linha de balanço sai SEM data — ela vem do arquivo, e exigi-la aqui devolveria zero linha')

    // Laço fechado: modelo → staging → plano → gravação.
    const doc = await documentoCom(p.rows.map(r => ({
      rowIndex: r.rowIndex,
      date: r.date, effectiveDate: r.effectiveDate,
      amount: r.amount === null ? null : String(r.amount),
      direction: r.direction, description: r.description,
      rawData: r.rawData,
    })))
    const plano = await planejarStaging(ORG, doc, await lerLinhas(doc.id))
    if ('error' in plano) { t(false, plano.error); return }
    t(plano.aInserir.length === 3, `o modelo atravessa até o plano de gravação (${plano.aInserir.length} de 3)`)
    const comConta = plano.aInserir.filter(n => n.valor.accountId !== null)
    t(comConta.length === 3, `a conta declarada NA LINHA do modelo chega ao lançamento (${comConta.length} de 3)`)
    // O modelo tem 3 exemplos: aluguel (caixa em branco = competência), cartão
    // (compra em março, fatura em abril) e recebimento (D+2). Logo, 2 divergem.
    const caixaDiferente = plano.aInserir.filter(n => n.valor.effectiveDate !== n.valor.date)
    t(caixaDiferente.length === 2, `2 linhas com caixa ≠ competência atravessam tudo (são ${caixaDiferente.length})`)
    const caixaIgual = plano.aInserir.filter(n => n.valor.effectiveDate === n.valor.date)
    t(caixaIgual.length === 1, 'e a linha com caixa em branco vira caixa = competência, não nula')
  }

  // ═══ 9. Nada foi tocado fora da organização de teste ══════════════════════
  console.log('\n── 9. isolamento ──')
  {
    const [{ n }] = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM transactions
       WHERE external_id LIKE 'arq:%' AND organization_id <> ${ORG}::uuid`)
    t(Number(n) === 0, `nenhuma chave "arq:" escrita fora da organização de teste (são ${n})`)
  }

  await db.delete(organizations).where(eq(organizations.id, ORG))
  const [{ n: sobrou }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM organizations WHERE name = ${NOME_ORG}`)
  t(Number(sobrou) === 0, 'organização de teste removida — o CASCADE levou lançamentos, documentos e fontes')

  console.log(`\n${ok} ok · ${falhas} falhas`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(async e => {
  console.error(e)
  await db.delete(organizations).where(eq(organizations.name, NOME_ORG)).catch(() => {})
  process.exit(1)
})
