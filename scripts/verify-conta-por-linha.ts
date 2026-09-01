/**
 * A conta declarada POR LINHA vira vínculo de verdade.
 *
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-conta-por-linha.ts
 *
 * O defeito que isto prende: as quatro colunas `account_*` já saíam certas e
 * diferentes por linha desde a 4.5.B, mas `data_source_id` era **um só para o
 * arquivo inteiro** — e `/contas` conta lançamentos por ele. Quem preenchesse a
 * coluna Conta com duas contas diferentes veria as duas com "0 lançamentos",
 * para sempre. O caso 4 é o defeito literal.
 *
 * Escreve, então cria a própria organização e a apaga no fim — o CASCADE leva
 * lançamentos, documentos, fontes e categorias. Se o script morrer no meio, a
 * organização sobra com o nome `ZZ Teste conta por linha` e a execução seguinte
 * a remove.
 */
import { db } from '@/db'
import {
  organizations, memberships, transactions, documents,
  transactionsStaging, dataSources,
} from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { planejarStaging } from '@/lib/staging-import'
import {
  garantirContaManual, listarContasManuais, apagarContaManual, mapaDeContasManuais,
} from '@/lib/accounts'
import { contaCanonica, cabecalhoDoArquivoSchema } from '@/lib/import-contract'
import { planejarImportacao, aplicarImportacao } from '@/lib/import-write'

const NOME_ORG = 'ZZ Teste conta por linha'
const USUARIO = '44444444-4444-4444-4444-444444444444'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

type LinhaCrua = {
  rowIndex: number
  date: string
  amount: string
  direction: string
  description: string
  rawData?: Record<string, unknown>
}

/** As três linhas do caso do Julio: duas contas cadastradas e uma que não existe. */
const TRES_LINHAS: LinhaCrua[] = [
  { rowIndex: 0, date: '2027-03-05', amount: '8500.00', direction: 'outflow', description: 'ALUGUEL MATRIZ MARCO', rawData: { __contrato: { conta: 'Caixa Espécie' } } },
  { rowIndex: 1, date: '2027-03-12', amount: '320.55', direction: 'outflow', description: 'POSTO IPIRANGA', rawData: { __contrato: { conta: 'Caixa Av D' } } },
  { rowIndex: 2, date: '2027-03-20', amount: '15000.00', direction: 'inflow', description: 'RECEBIMENTO CLIENTE ACME', rawData: { __contrato: { conta: 'Banco Fantasma' } } },
]

async function main() {
  // Corte de tempo da asserção de isolamento: ela prova que ESTA execução não
  // escreveu fora da própria organização, não que o banco inteiro está limpo —
  // a segunda afirmação envelhece mal (ver a mesma nota em verify-staging-import).
  const INICIO = new Date()
  await db.delete(organizations).where(eq(organizations.name, NOME_ORG))

  const [org] = await db.insert(organizations).values({
    name: NOME_ORG, slug: `zz-teste-conta-linha-${Date.now()}`,
  }).returning({ id: organizations.id })
  const ORG = org.id
  await db.insert(memberships).values({
    userId: USUARIO, organizationId: ORG, role: 'owner', acceptedAt: new Date(),
  })

  async function documentoCom(
    linhas: LinhaCrua[],
    opts: { reportType?: string; referenceDate?: string | null; conta?: unknown } = {},
  ) {
    const [doc] = await db.insert(documents).values({
      organizationId: ORG,
      type: 'statement',
      filename: `conta-${Date.now()}-${linhas.length}.csv`,
      storagePath: `teste://${ORG}/${Date.now()}`,
      mimeType: 'text/csv',
      sizeBytes: 1,
      extractionStatus: 'completed',
      reportType: opts.reportType ?? 'other',
      referenceDate: opts.referenceDate ?? null,
      metadata: { source_type: 'bank', ...(opts.conta ? { account: opts.conta } : {}) },
    }).returning()

    if (linhas.length > 0) {
      await db.insert(transactionsStaging).values(linhas.map(l => ({
        organizationId: ORG,
        documentId: doc.id,
        rowIndex: l.rowIndex,
        rawData: l.rawData ?? {},
        date: l.date,
        amount: l.amount,
        direction: l.direction,
        description: l.description,
        status: 'approved' as const,
      })))
    }
    return doc
  }

  const lerLinhas = (documentId: string) => db
    .select().from(transactionsStaging)
    .where(eq(transactionsStaging.documentId, documentId))
    .orderBy(transactionsStaging.rowIndex)

  const planejar = async (doc: Awaited<ReturnType<typeof documentoCom>>) => {
    const p = await planejarStaging(ORG, doc, await lerLinhas(doc.id))
    if ('error' in p) throw new Error(p.error)
    return p
  }

  /**
   * Replica o insert de `approveAndInsert` — inclusive a decisão que esta sessão
   * introduz: a fonte vem da conta DA LINHA, e a reserva só responde por quem
   * não resolveu.
   */
  async function gravar(plano: Awaited<ReturnType<typeof planejar>>, documentId: string, reserva: string) {
    if (plano.aInserir.length === 0) return 0
    const values = plano.aInserir.map(({ staging, valor, chave, conta, contaDeclarada }) => ({
      organizationId: ORG,
      dataSourceId: conta?.dataSourceId ?? reserva,
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
      metadata: {
        stagingId: staging.id,
        ...(!conta && contaDeclarada ? { contaNaoCadastrada: contaDeclarada.nome } : {}),
      },
      status: 'confirmed' as const,
    }))
    const q = db.insert(transactions).values(values)
    const rows = await (plano.deduplicando ? q.onConflictDoNothing() : q).returning({ id: transactions.id })
    return rows.length
  }

  const [fonteGenerica] = await db.insert(dataSources).values({
    organizationId: ORG, type: 'bank', provider: 'upload', name: 'Upload — teste',
  }).returning({ id: dataSources.id })
  const RESERVA = fonteGenerica.id

  // ═══ 1. A resolução por identidade ════════════════════════════════════════
  console.log('\n── 1. mapaDeContasManuais ──')
  {
    const vazio = await mapaDeContasManuais(ORG)
    t(vazio.size === 0, 'organização nova → mapa vazio')

    const avd = await garantirContaManual(ORG, 'Caixa Av. D', 'CHECKING_ACCOUNT', null)
    const esp = await garantirContaManual(ORG, 'Caixa Espécie', 'OTHER', null)
    if ('error' in avd || 'error' in esp) { t(false, 'não criou as contas de teste'); return }

    const mapa = await mapaDeContasManuais(ORG)
    t(mapa.size === 2, `duas contas manuais → duas entradas (são ${mapa.size})`)

    // A colisão que o produto QUER: ponto, acento e caixa não criam conta nova.
    t(contaCanonica('Caixa Av D').accountId === contaCanonica('Caixa Av. D').accountId,
      '"Caixa Av D" e "Caixa Av. D" têm a MESMA identidade — o ponto não separa contas')
    t(mapa.get(contaCanonica('  caixa   av. d  ').accountId!)?.dataSourceId === avd.dataSourceId,
      'grafia com espaços e caixa diferentes resolve para a mesma conta')
    t(mapa.get(contaCanonica('CAIXA ESPECIE').accountId!)?.dataSourceId === esp.dataSourceId,
      'acento também não separa: "CAIXA ESPECIE" resolve para "Caixa Espécie"')
    t(mapa.get(contaCanonica('Caixa Av. E').accountId!) === undefined,
      'nome que não existe devolve undefined — e é isso que vira "sem vínculo"')

    // O nome do CADASTRO vence: resolver não renomeia o que a pessoa cadastrou.
    t(mapa.get(contaCanonica('caixa av d').accountId!)?.nome === 'Caixa Av. D',
      'o nome devolvido é o do cadastro, não a grafia do arquivo')
  }

  // ═══ 2. O plano resolve por linha — nos DOIS sentidos ═════════════════════
  console.log('\n── 2. planejarStaging: casa, e não cria ──')
  const docBase = await documentoCom(TRES_LINHAS)
  {
    const plano = await planejar(docBase)
    t(plano.normalizadas.length === 3, `as 3 linhas normalizam (são ${plano.normalizadas.length})`)

    const [l0, l1, l2] = plano.normalizadas
    t(l0.conta?.nome === 'Caixa Espécie', 'linha 1 → Caixa Espécie (cadastrada)')
    t(l1.conta?.nome === 'Caixa Av. D', 'linha 2 → Caixa Av. D, mesmo escrita "Caixa Av D" no arquivo')
    t(l2.conta === null, 'linha 3 → "Banco Fantasma" NÃO casa, e nada é criado')
    t(l2.contaDeclarada?.nome === 'Banco Fantasma',
      'e o que o arquivo declarou continua legível — é o que a tela mostra em âmbar')

    // As colunas sobrevivem mesmo sem cadastro: a chave de dedup depende delas.
    t(l2.valor.accountId === 'arq:banco-fantasma' && l2.valor.accountName === 'Banco Fantasma',
      'as colunas account_* são gravadas mesmo sem cadastro — "sem conta" é sem VÍNCULO')

    t(plano.contasDoArquivo.length === 3, `resumo com 3 contas citadas (são ${plano.contasDoArquivo.length})`)
    t(plano.contasDoArquivo.filter(c => !c.conta).length === 1, 'exatamente uma citada e não cadastrada')
    t(plano.contasDoArquivo.every(c => c.linhas === 1 && !c.doCabecalho),
      'cada uma com 1 linha, e nenhuma vinda do cabeçalho')
    t(plano.semConta === 0, 'nenhuma linha sem conta nenhuma')

    const cadastro = await listarContasManuais(ORG)
    t(cadastro.length === 2, `PLANEJAR NÃO CRIA CONTA: ainda são 2 (são ${cadastro.length})`)
  }

  // ═══ 3. A precedência: edição > arquivo > cabeçalho ═══════════════════════
  console.log('\n── 3. precedência ──')
  {
    const doc = await documentoCom([
      // declara a sua → vence o cabeçalho
      { ...TRES_LINHAS[0], rowIndex: 0 },
      // sem conta própria → o cabeçalho responde
      { rowIndex: 1, date: '2027-03-12', amount: '10.00', direction: 'outflow', description: 'SEM CONTA PROPRIA' },
      // edição humana → vence o que o arquivo disse
      { rowIndex: 2, date: '2027-03-13', amount: '20.00', direction: 'outflow', description: 'EDITADA', rawData: { __contrato: { conta: 'Caixa Espécie' }, __conta: { nome: 'Caixa Av. D', tipo: 'CHECKING_ACCOUNT', numero: null } } },
      // "sem conta" explícito → vence até o cabeçalho
      { rowIndex: 3, date: '2027-03-14', amount: '30.00', direction: 'outflow', description: 'SEM CONTA EXPLICITA', rawData: { __contrato: { conta: 'Caixa Espécie' }, __conta: { nome: null } } },
    ], { conta: { nome: 'Caixa Av. D', tipo: 'CHECKING_ACCOUNT', numero: null } })

    const p = await planejar(doc)
    const [a, b, c, d] = p.normalizadas
    t(a.conta?.nome === 'Caixa Espécie', 'a coluna da linha vence o cabeçalho')
    t(b.conta?.nome === 'Caixa Av. D', 'linha sem conta própria fica com a do cabeçalho')
    t(c.conta?.nome === 'Caixa Av. D', 'a edição da tela vence o que o arquivo disse')
    t(d.valor.accountId === null && d.conta === null,
      '"sem conta" explícito vence o cabeçalho — sem isso a coluna não conseguiria desfazê-lo')
    t(p.semConta === 1, `uma linha sem conta nenhuma (são ${p.semConta})`)
    const doCabecalho = p.contasDoArquivo.find(x => x.accountId === 'arq:caixa-av-d')
    t(doCabecalho?.doCabecalho === false,
      'conta usada pela linha E pelo cabeçalho não é marcada como "só do cabeçalho"')
  }

  // ═══ 4. A gravação por linha — e o número de `/contas` ════════════════════
  console.log('\n── 4. o defeito literal: /contas contando certo ──')
  {
    const plano = await planejar(docBase)
    const n = await gravar(plano, docBase.id, RESERVA)
    t(n === 3, `as 3 linhas entram (entraram ${n})`)

    const grupos = await db.execute<{ data_source_id: string; n: number }>(sql`
      SELECT data_source_id::text, COUNT(*)::int AS n FROM transactions
       WHERE document_id = ${docBase.id}::uuid GROUP BY data_source_id`)
    t(grupos.length === 3, `três fontes distintas no MESMO arquivo (são ${grupos.length})`)

    const contas = await listarContasManuais(ORG)
    const avd = contas.find(c => c.nome === 'Caixa Av. D')
    const esp = contas.find(c => c.nome === 'Caixa Espécie')
    t(avd?.lancamentos === 1, `"Caixa Av. D" mostra 1 lançamento (mostra ${avd?.lancamentos}) — antes daria 0`)
    t(esp?.lancamentos === 1, `"Caixa Espécie" mostra 1 lançamento (mostra ${esp?.lancamentos}) — antes daria 0`)
    t(contas.length === 2, `GRAVAR NÃO CRIA CONTA: ainda são 2 (são ${contas.length})`)

    const [fantasma] = await db.execute<{ data_source_id: string; account_id: string; nao_cadastrada: string | null }>(sql`
      SELECT data_source_id::text, account_id, metadata->>'contaNaoCadastrada' AS nao_cadastrada
        FROM transactions WHERE document_id = ${docBase.id}::uuid AND description = 'RECEBIMENTO CLIENTE ACME'`)
    t(fantasma.data_source_id === RESERVA, 'a linha sem cadastro cai na fonte de reserva')
    t(fantasma.account_id === 'arq:banco-fantasma', 'e mantém o account_id que o arquivo declarou')
    t(fantasma.nao_cadastrada === 'Banco Fantasma',
      'com o nome registrado no metadata — é o que tornaria um backfill possível sem reprocessar')

    const r = await apagarContaManual(ORG, avd!.dataSourceId)
    t('error' in r && r.error.includes('1 lançamento'),
      'apagar "Caixa Av. D" é recusado por ter lançamento — o vínculo é real, não cosmético')
  }

  // ═══ 5. A dedup não pode depender do cadastro ═════════════════════════════
  console.log('\n── 5. dedup ──')
  {
    const igual = await documentoCom(TRES_LINHAS)
    const p1 = await planejar(igual)
    t(p1.duplicadas === 3 && p1.aInserir.length === 0,
      `o mesmo arquivo de novo: 0 a inserir, 3 duplicadas (foram ${p1.duplicadas})`)

    const trocada = await documentoCom([
      { ...TRES_LINHAS[0], rawData: { __contrato: { conta: 'Caixa Espécie' }, __conta: { nome: 'Caixa Av. D', tipo: 'CHECKING_ACCOUNT', numero: null } } },
      TRES_LINHAS[1], TRES_LINHAS[2],
    ])
    const p2 = await planejar(trocada)
    t(p2.aInserir.length === 1,
      `trocar a conta de uma linha a torna NOVA para a dedup (${p2.aInserir.length} a inserir) — a conta está na assinatura`)

    // O que NÃO pode mudar a chave: a conta passar a existir no cadastro.
    const criada = await garantirContaManual(ORG, 'Banco Fantasma', 'CHECKING_ACCOUNT', null)
    t(!('error' in criada), 'cadastra "Banco Fantasma" DEPOIS da importação')
    const denovo = await documentoCom(TRES_LINHAS)
    const p3 = await planejar(denovo)
    t(p3.duplicadas === 3 && p3.aInserir.length === 0,
      `criar a conta e reimportar continua deduplicando (${p3.duplicadas} duplicadas) — a RESOLUÇÃO não entra na chave`)
    t(p3.normalizadas[2].conta?.nome === 'Banco Fantasma',
      'e agora a terceira linha resolve: mesma chave, vínculo novo')
  }

  // ═══ 6. Balanço: a conta continua sendo do arquivo ════════════════════════
  console.log('\n── 6. balanço ──')
  {
    const doc = await documentoCom([
      { rowIndex: 0, date: '2027-03-31', amount: '1000.00', direction: 'inflow', description: 'Caixa e equivalentes', rawData: { __contrato: { conta: 'Caixa Espécie' } } },
      { rowIndex: 1, date: '2027-03-31', amount: '2000.00', direction: 'inflow', description: 'Fornecedores', rawData: { __contrato: { conta: 'Caixa Av D' } } },
    ], { reportType: 'balance_sheet', referenceDate: '2027-03-31', conta: { nome: 'Caixa Av. D', tipo: 'CHECKING_ACCOUNT', numero: null } })

    const p = await planejar(doc)
    t(p.normalizadas.length === 2, `as 2 linhas de balanço normalizam (são ${p.normalizadas.length})`)
    t(p.contasDoArquivo.length === 1 && p.contasDoArquivo[0].doCabecalho,
      'no balanço a conta é a do ARQUIVO — a coluna da linha não é lida, e a tela também não a oferece')
    t(p.normalizadas.every(n => n.conta?.nome === 'Caixa Av. D'),
      'as duas linhas ficam com a conta do cabeçalho')
    t(p.deduplicando === false, 'e balanço segue sem deduplicar — snapshot se substitui')
  }

  // ═══ 7. A outra porta: o MCP ══════════════════════════════════════════════
  console.log('\n── 7. MCP ──')
  {
    const cabecalho = cabecalhoDoArquivoSchema.parse({ tipoDeRelatorio: 'movimentos' })
    const linhas = [
      { data: '2027-04-01', descricao: 'PAGAMENTO FORNECEDOR X', valor: 500, sentido: 'outflow' as const, conta: 'Caixa Espécie' },
      { data: '2027-04-02', descricao: 'PAGAMENTO FORNECEDOR Y', valor: 700, sentido: 'outflow' as const, conta: 'Conta Que Nao Existe' },
    ]
    const plano = await planejarImportacao(ORG, cabecalho, linhas)
    if ('error' in plano) { t(false, plano.error); return }

    t(plano.aInserir[0].conta?.nome === 'Caixa Espécie', 'MCP: a conta da linha casa com o cadastro')
    t(plano.aInserir[1].conta === null, 'MCP: conta de linha inexistente NÃO casa')
    const antes = (await listarContasManuais(ORG)).length
    t(antes === 3, `MCP: planejar não criou nada (${antes} contas, as 3 de antes)`)

    // O cabeçalho, ao contrário da linha, CRIA — é o que a descrição publicada
    // ao modelo promete desde a 4.5.C e o código nunca fazia.
    const comCabecalho = cabecalhoDoArquivoSchema.parse({
      tipoDeRelatorio: 'movimentos', conta: 'caixa filial osasco', tipoDeConta: 'CHECKING_ACCOUNT',
    })
    const p2 = await planejarImportacao(ORG, comCabecalho, [
      { data: '2027-04-03', descricao: 'DESPESA FILIAL', valor: 90, sentido: 'outflow' as const },
    ])
    if ('error' in p2) { t(false, p2.error); return }
    const r = await aplicarImportacao(ORG, USUARIO, 'Teste conta por linha', comCabecalho, [
      { data: '2027-04-03', descricao: 'DESPESA FILIAL', valor: 90, sentido: 'outflow' as const },
    ], p2)
    t(r.inseridos === 1, `MCP: gravou 1 lançamento (gravou ${r.inseridos})`)

    const depois = await listarContasManuais(ORG)
    const nova = depois.find(c => c.accountId === 'arq:caixa-filial-osasco')
    t(depois.length === 4, `MCP: a conta do CABEÇALHO foi criada (${depois.length} contas)`)
    t(nova?.lancamentos === 1, `MCP: e o lançamento ficou pendurado NELA (${nova?.lancamentos})`)

    const [docMcp] = await db.execute<{ nome: string | null }>(sql`
      SELECT metadata->'account'->>'nome' AS nome FROM documents WHERE id = ${r.documentId}::uuid`)
    t(docMcp.nome === 'caixa filial osasco',
      `MCP: documents.metadata.account guarda a grafia canônica do cadastro ("${docMcp.nome}")`)
  }

  // ═══ 8. Isolamento ════════════════════════════════════════════════════════
  console.log('\n── 8. isolamento ──')
  {
    const [{ n }] = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM transactions
       WHERE organization_id <> ${ORG}::uuid
         AND created_at >= ${INICIO.toISOString()}::timestamptz`)
    t(Number(n) === 0, `nenhum lançamento escrito fora da organização de teste nesta execução (são ${n})`)

    const [{ n: contas }] = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM data_sources
       WHERE provider = 'manual' AND organization_id <> ${ORG}::uuid
         AND created_at >= ${INICIO.toISOString()}::timestamptz`)
    t(Number(contas) === 0, `nenhuma conta manual criada fora da organização de teste (são ${contas})`)
  }

  await db.delete(organizations).where(eq(organizations.id, ORG))
  const [{ n: sobrou }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM organizations WHERE name = ${NOME_ORG}`)
  t(Number(sobrou) === 0, 'organização de teste removida — o CASCADE levou tudo')

  console.log(`\n${ok} ok · ${falhas} falhas`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(async e => {
  console.error(e)
  await db.delete(organizations).where(eq(organizations.name, NOME_ORG)).catch(() => {})
  process.exit(1)
})
