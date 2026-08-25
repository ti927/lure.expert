// Importação de lançamentos por linhas já tabuladas — o caminho do MCP.
//
// ─────────────────────────────────────────────────────────────────────────────
// O arquivo NÃO trafega. As linhas trafegam.
//
// O plano de 23/ago dizia "o arquivo nunca vai em base64 dentro do JSON-RPC" e
// concluiu "URL assinada de upload". A conclusão certa era outra: quem tem o
// arquivo é a pessoa, e ela já o anexa na própria conversa. O modelo lê CSV,
// Excel e PDF melhor que o nosso parser — então ele tabula e manda as LINHAS.
//
// Consequência: este caminho não usa Storage, não usa `transactions_staging`,
// não usa o job `process-document` e não chama a Anthropic uma única vez. A
// camada inteira de parsing existe porque o app não sabe ler arquivo arbitrário;
// aqui, quem lê já leu.
//
// O que ele PRESERVA do caminho da tela, porque não é acessório:
//   · um registro em `documents`, para o lançamento ter origem rastreável e
//     aparecer no filtro "importação" de `/transacoes`;
//   · uma `data_sources` própria, para o rótulo da conta sair certo;
//   · a camada 0 de categorização (natureza vinda do arquivo casada contra o
//     plano de contas), que é o que faz um export de ERP entrar sem IA;
//   · o disparo da categorização para o que sobrou sem natureza.
//
// ─────────────────────────────────────────────────────────────────────────────
// A DEDUPLICAÇÃO É O CORAÇÃO DISTO, não um detalhe
//
// O caminho de upload da tela **não deduplica nada**: subir o mesmo extrato
// duas vezes dobra a contabilidade. Isso sobreviveu porque uma pessoa não
// reenvia o mesmo arquivo sem perceber. Um modelo, sim — ele tenta de novo
// quando uma chamada parece ter falhado, e é exatamente aí que a chamada
// costuma ter dado certo.
//
// Não precisou de migration: já existe `idx_tx_dedup`, único em
// `(data_source_id, external_id)` com `external_id IS NOT NULL`. Cada linha
// recebe um `external_id` derivado do próprio conteúdo, e o INSERT vai com
// `ON CONFLICT DO NOTHING`. Reimportar o mesmo arquivo insere zero.

import { z } from 'zod'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { transactions, documents, dataSources, categories } from '@/db/schema'
import { chavear, deduplica } from '@/lib/import-dedup'
import {
  normalizarLancamento, TIPOS_DE_CONTA, ROTULO_DE_CONTA,
  type CabecalhoDoArquivo, type LancamentoParaGravar,
} from '@/lib/import-contract'
import { findCategoryByText, type LeafCategory } from '@/lib/categorizer'
import { BP_TYPES } from '@/lib/bp-types'

/**
 * Teto por chamada.
 *
 * Não é limite do banco: é o que cabe com folga numa mensagem JSON-RPC e o que
 * o modelo consegue montar sem truncar. Arquivo maior entra em chamadas
 * seguidas com a mesma `origem` — a dedup garante que sobreposição entre lotes
 * não duplica nada.
 */
export const MAX_LINHAS_IMPORTACAO = 500

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD')

/**
 * A LINHA, como a ferramenta a publica.
 *
 * **Não é o schema interno cru.** `data`, `descricao` e `sentido` aparecem como
 * opcionais porque uma linha de BALANÇO não tem nenhuma das três — ela é conta
 * patrimonial + saldo, e a data vem do arquivo. Quem exige cada campo é o tipo
 * de relatório, validado em `planejarImportacao` com mensagem que diz o que
 * faltou. Publicar duas variantes num `oneOf` faria o modelo escolher errado
 * com frequência; um campo declarado "obrigatório para movimentos" na própria
 * descrição erra menos.
 */
export const linhaImportadaSchema = z.object({
  data: dataIso.optional()
    .describe('Data de competência, AAAA-MM-DD. OBRIGATÓRIA em movimentos; ignorada em balanço ' +
      '(lá a data é do arquivo, em `dataDeReferencia`).'),
  dataDeCaixa: dataIso.optional()
    .describe('Quando o dinheiro se moveu, se for diferente da competência. EM BRANCO significa ' +
      'igual à competência — não repita. Compra no cartão: competência = data da compra, ' +
      'caixa = vencimento da fatura.'),
  descricao: z.string().trim().max(500).optional()
    .describe('Como aparece no extrato. OBRIGATÓRIA em movimentos; em balanço a descrição é a própria natureza.'),
  valor: z.number().positive()
    .describe('Sempre POSITIVO. O sinal vem de `sentido`, nunca do número. Em balanço, é o saldo.'),
  sentido: z.enum(['inflow', 'outflow']).optional()
    .describe('inflow = entrada, outflow = saída. OBRIGATÓRIO em movimentos; em balanço quem dá o lado é a natureza.'),
  categoria: z.string().trim().max(200).optional()
    .describe('Natureza do plano de contas — código ("4.4"), nome, ou "4.4 Nome". OBRIGATÓRIA em ' +
      'balanço (é a conta patrimonial). Em movimentos é opcional: o que não casar entra sem ' +
      'natureza e vai para a fila de classificação.'),
  conta: z.string().trim().max(200).optional()
    .describe('Nome da conta ou cartão. Só preencha na linha quando o arquivo tiver MAIS DE UMA ' +
      'conta; quando é uma só, informe em `conta` no nível do arquivo.'),
  contaTipo: z.enum(TIPOS_DE_CONTA).optional()
    .describe(`Tipo da conta desta linha: ${TIPOS_DE_CONTA.map(t => `${t} (${ROTULO_DE_CONTA[t]})`).join(', ')}.`),
  contaNumero: z.string().trim().max(60).optional()
    .describe('Número/final da conta desta linha.'),
  moeda: z.string().trim().length(3).optional()
    .describe('Em branco = BRL. O produto é BRL only.'),
  idDeOrigem: z.string().trim().max(200).optional()
    .describe('Id do lançamento no ERP de origem, quando existir.'),
  observacao: z.string().trim().max(500).optional(),
})

export type LinhaImportada = z.infer<typeof linhaImportadaSchema>

// ─────────────────────────────────────────────────────────────────────────────
// A chave de deduplicação
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A chave de deduplicação mudou de casa para `@/lib/import-contract`.
 *
 * Motivo: ela precisa ser **a mesma nas duas portas de arquivo**. Enquanto vivia
 * aqui, só o MCP deduplicava — subir pela tela o que a IA já importou duplicaria,
 * e a dedup ficaria cega justamente entre os dois caminhos que ela precisa unir.
 *
 * O prefixo passou de `mcp:` para `arq:` lá. O hash **não** inclui o prefixo,
 * então as linhas já gravadas migram por um `UPDATE` de troca de prefixo.
 */
function chavearNormalizadas(valores: LancamentoParaGravar[]): string[] {
  return chavear(valores.map(v => ({
    competencia: v.date,
    valor: Number(v.amount),
    sentido: v.direction,
    descricao: v.description,
    conta: v.accountId,
  })))
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolução da natureza — a camada 0, sem o formato de CSV
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Casa o que o arquivo chamou de natureza contra o plano de contas.
 *
 * **A regra de casamento é `findCategoryByText`**, a mesma que a tela usa desde
 * a 4.5.B — código exato → nome exato → prefixo de código, e ambíguo não casa.
 * Antes esta função tinha a própria cópia da regra; duas cópias significavam
 * que o mesmo arquivo podia entrar diferente conforme a porta.
 *
 * **O filtro de DOMÍNIO é novo, e sem ele o balanço casava errado.** Uma linha
 * "Caixa e Equivalentes" de um balanço podia casar com uma natureza de DRE de
 * nome parecido; pior, `aplicarImportacao` cravava `reportType: 'other'`, que
 * `domainFromReportType` traduz para `'dre'` — então o BP pelo MCP era
 * impossível **e silencioso**.
 *
 * **Só natureza folha**, pela mesma razão de sempre: pendurar lançamento num pai
 * duplicaria o valor na cascata da DRE.
 */
async function resolverNaturezas(
  organizationId: string,
  termos: string[],
  tipoDeRelatorio: 'movimentos' | 'balanco',
): Promise<Map<string, { id: string; nome: string } | 'ambiguo'>> {
  const mapa = new Map<string, { id: string; nome: string } | 'ambiguo'>()
  if (termos.length === 0) return mapa

  const folhas = await db
    .select({
      id: categories.id, code: categories.code, name: categories.name, type: categories.type,
    })
    .from(categories)
    .where(and(
      eq(categories.organizationId, organizationId),
      eq(categories.isActive, true),
      sql`NOT EXISTS (SELECT 1 FROM ${categories} f WHERE f.parent_id = ${categories}.id)`,
    ))

  const bpSet = new Set<string>(BP_TYPES)
  const doDominio: LeafCategory[] = folhas
    .filter(f => (tipoDeRelatorio === 'balanco' ? bpSet.has(f.type) : !bpSet.has(f.type)))
    .map(f => ({ id: f.id, code: f.code, name: f.name, type: f.type, parentName: null }))

  const porId = new Map(doDominio.map(f => [f.id, f.name]))

  for (const termo of Array.from(new Set(termos))) {
    const id = findCategoryByText(termo, doDominio)
    if (id) mapa.set(termo, { id, nome: porId.get(id) ?? termo })
  }

  return mapa
}

// ─────────────────────────────────────────────────────────────────────────────
// O plano
// ─────────────────────────────────────────────────────────────────────────────

export interface LinhaRecusadaImport {
  indice: number
  descricao: string
  motivo: string
}

export interface PlanoDeImportacao {
  /** Linhas que serão inseridas. */
  novas: number
  /** Já existem no banco com a mesma chave — serão ignoradas. */
  duplicadas: number
  /** Fora do schema ou sem o mínimo. */
  recusadas: LinhaRecusadaImport[]
  entradas: number
  saidas: number
  periodo: { de: string; ate: string } | null
  /** Quantas das novas já entram com natureza resolvida do arquivo. */
  comNatureza: number
  /** Termos de categoria que o arquivo trouxe e não casaram. */
  naturezasNaoResolvidas: string[]
  /** `movimentos` ou `balanco` — ecoado do cabeçalho do arquivo. */
  tipoDeRelatorio: 'movimentos' | 'balanco'
  /** Falso para balanço: snapshot se substitui, não se acumula. */
  deduplicando: boolean
  amostra: { data: string; descricao: string; valor: number; sentido: string; natureza: string | null }[]
  /** O que será gravado, já normalizado pelo contrato. */
  aInserir: {
    indice: number
    chave: string | null
    categoryId: string | null
    valor: LancamentoParaGravar
  }[]
}

/**
 * O que a importação faria, sem gravar.
 *
 * Recebe as linhas já validadas pelo Zod — quem chama peneira antes, para que
 * uma linha malformada não derrube o lote (o mesmo princípio da 9.5 e do lote
 * de regras).
 */
export async function planejarImportacao(
  organizationId: string,
  cabecalho: CabecalhoDoArquivo,
  linhas: LinhaImportada[],
  recusadas: LinhaRecusadaImport[] = [],
): Promise<{ error: string } | PlanoDeImportacao> {
  if (linhas.length === 0 && recusadas.length === 0) {
    return { error: 'Informe ao menos uma linha.' }
  }
  if (linhas.length > MAX_LINHAS_IMPORTACAO) {
    return {
      error: `Máximo de ${MAX_LINHAS_IMPORTACAO} linhas por chamada. Divida o arquivo em lotes — ` +
        'pode usar a mesma origem, porque a deduplicação impede que a sobreposição duplique.',
    }
  }

  // Normalização pelo MESMO contrato que a tela usa. Recusa é por LINHA, com
  // motivo legível: uma linha malformada não pode custar as outras 499.
  const normalizadas: { indice: number; valor: LancamentoParaGravar; termo: string | null }[] = []
  const recusasLocais: LinhaRecusadaImport[] = []

  linhas.forEach((l, i) => {
    const bruto: Record<string, unknown> = {
      competencia: l.data,
      caixa: l.dataDeCaixa,
      descricao: l.descricao,
      valor: l.valor,
      sentido: l.sentido,
      natureza: l.categoria,
      conta: l.conta,
      tipoDeConta: l.contaTipo,
      numeroDaConta: l.contaNumero,
      moeda: l.moeda,
      idDeOrigem: l.idDeOrigem,
    }
    const n = normalizarLancamento(bruto, cabecalho)
    if (n.ok) normalizadas.push({ indice: i, valor: n.valor, termo: l.categoria ?? null })
    else recusasLocais.push({ indice: i, descricao: l.descricao ?? l.categoria ?? '', motivo: n.motivo })
  })

  const todasRecusas = [...recusadas, ...recusasLocais]

  const deduplicando = deduplica(cabecalho.tipoDeRelatorio)
  const chaves = deduplicando ? chavearNormalizadas(normalizadas.map(n => n.valor)) : []

  // Quais já existem. A busca é por `external_id` na organização inteira, não
  // só na fonte desta origem: o mesmo extrato importado ontem sob outro nome de
  // origem — ou pela tela — continua sendo o mesmo lançamento.
  const existentes = chaves.length > 0
    ? await db.select({ externalId: transactions.externalId })
        .from(transactions)
        .where(and(
          eq(transactions.organizationId, organizationId),
          inArray(transactions.externalId, chaves),
        ))
    : []
  const jaTem = new Set(existentes.map(e => e.externalId).filter((v): v is string => !!v))

  const termos = normalizadas
    .map(n => n.valor.naturezaBruta)
    .filter((v): v is string => !!v)
  const naturezas = await resolverNaturezas(organizationId, termos, cabecalho.tipoDeRelatorio)

  const aInserir: PlanoDeImportacao['aInserir'] = []
  const naoResolvidas = new Set<string>()
  let entradas = 0, saidas = 0, comNatureza = 0
  let de: string | null = null, ate: string | null = null

  normalizadas.forEach((n, pos) => {
    const chave = deduplicando ? chaves[pos] : null
    if (chave && jaTem.has(chave)) return

    const termo = n.valor.naturezaBruta
    const achada = termo ? naturezas.get(termo) : undefined
    const categoryId = achada && achada !== 'ambiguo' ? achada.id : null
    if (termo && !categoryId) naoResolvidas.add(termo)
    if (categoryId) comNatureza++

    const v = Number(n.valor.amount)
    if (n.valor.direction === 'inflow') entradas += v
    else saidas += v
    if (!de || n.valor.date < de) de = n.valor.date
    if (!ate || n.valor.date > ate) ate = n.valor.date

    aInserir.push({ indice: n.indice, chave, categoryId, valor: n.valor })
  })

  return {
    novas: aInserir.length,
    duplicadas: normalizadas.length - aInserir.length,
    recusadas: todasRecusas,
    entradas,
    saidas,
    periodo: de && ate ? { de, ate } : null,
    comNatureza,
    naturezasNaoResolvidas: Array.from(naoResolvidas).slice(0, 20),
    tipoDeRelatorio: cabecalho.tipoDeRelatorio,
    deduplicando,
    amostra: aInserir.slice(0, 8).map(({ categoryId, valor }) => {
      const n = valor.naturezaBruta ? naturezas.get(valor.naturezaBruta) : undefined
      return {
        data: valor.date, descricao: valor.description, valor: Number(valor.amount),
        sentido: valor.direction,
        natureza: categoryId && n && n !== 'ambiguo' ? n.nome : null,
      }
    }),
    aInserir,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A gravação
// ─────────────────────────────────────────────────────────────────────────────

export interface ResultadoImportacao {
  inseridos: number
  ignoradosPorDuplicidade: number
  comNatureza: number
  documentId: string
  /** Ids que precisam passar pelo categorizador — quem chama dispara. */
  paraCategorizar: string[]
}

/**
 * Grava.
 *
 * `ON CONFLICT DO NOTHING` sobre `idx_tx_dedup` é a segunda barreira: o plano já
 * tirou as duplicadas, mas entre prever e aplicar alguém pode ter importado o
 * mesmo arquivo pela tela. A diferença entre o que se tentou e o que entrou é
 * devolvida, em vez de o número prometido ser o número relatado.
 */
export async function aplicarImportacao(
  organizationId: string,
  userId: string,
  origem: string,
  cabecalho: CabecalhoDoArquivo,
  linhas: LinhaImportada[],
  plano: PlanoDeImportacao,
): Promise<ResultadoImportacao> {
  const ehBalanco = cabecalho.tipoDeRelatorio === 'balanco'

  // Uma fonte por origem: é ela que dá o rótulo da conta em `/transacoes`.
  const nomeFonte = `MCP — ${origem}`.slice(0, 200)
  let [fonte] = await db.select().from(dataSources).where(and(
    eq(dataSources.organizationId, organizationId),
    eq(dataSources.provider, 'mcp'),
    eq(dataSources.name, nomeFonte),
  )).limit(1)

  if (!fonte) {
    ;[fonte] = await db.insert(dataSources).values({
      organizationId, type: ehBalanco ? 'balance_sheet' : 'statement',
      provider: 'mcp', name: nomeFonte,
    }).returning()
  }

  // O registro em `documents` existe para o lançamento ter origem: sem ele o
  // filtro "importação" de `/transacoes` não enxerga o lote e não há como
  // separar o que entrou por aqui. `storage_path` é NOT NULL e não há arquivo —
  // o esquema `mcp://` marca isso de forma legível, e `deleteDocument` sabe
  // pular a remoção no Storage.
  //
  // `reportType` era CRAVADO em `'other'`, e isso tornava BP pelo MCP impossível
  // — em silêncio: `getBpData` filtra `report_type='balance_sheet'`, e
  // `domainFromReportType('other')` devolve `'dre'`, então a camada 0 só
  // oferecia naturezas de DRE para uma linha patrimonial. `reference_date` é o
  // que vira a coluna de `/balanco`, e não havia onde informá-la.
  const [doc] = await db.insert(documents).values({
    organizationId,
    type: ehBalanco ? 'report' : 'statement',
    filename: origem.slice(0, 200),
    storagePath: `mcp://${organizationId}/${Date.now()}`,
    mimeType: 'application/x-mcp-rows',
    sizeBytes: JSON.stringify(linhas).length,
    extractionStatus: 'completed',
    uploadedByUserId: userId,
    reportType: ehBalanco ? 'balance_sheet' : 'other',
    referenceDate: cabecalho.dataDeReferencia,
    metadata: {
      source_type: ehBalanco ? 'balance_sheet' : 'statement',
      origem, via: 'mcp', linhasRecebidas: linhas.length,
      ...(cabecalho.conta ? { account: {
        nome: cabecalho.conta, tipo: cabecalho.tipoDeConta, numero: cabecalho.numeroDaConta,
      } } : {}),
    },
  }).returning({ id: documents.id })

  const BATCH = 100
  const inseridos: { id: string; categoryId: string | null }[] = []

  for (let i = 0; i < plano.aInserir.length; i += BATCH) {
    const bloco = plano.aInserir.slice(i, i + BATCH)
    const values = bloco.map(({ indice, chave, categoryId, valor }) => ({
      organizationId,
      dataSourceId: fonte.id,
      documentId: doc.id,
      externalId: chave,
      date: valor.date,
      effectiveDate: valor.effectiveDate,
      amount: valor.amount,
      currency: valor.currency,
      direction: valor.direction,
      description: valor.description,
      // `accountId` recebia o TEXTO CRU do modelo. Agora é o identificador
      // derivado (`arq:<slug>`), o mesmo que a tela produz — é o que faz a
      // mesma conta em arquivos diferentes casar, e o que o filtro de
      // `/transacoes` agrupa.
      accountId: valor.accountId,
      accountName: valor.accountName,
      accountType: valor.accountType,
      accountNumber: valor.accountNumber,
      rawData: { ...linhas[indice] },
      metadata: { sourceType: ehBalanco ? 'balance_sheet' : 'statement', via: 'mcp', origem },
      categoryId,
      categorizationMethod: categoryId ? 'csv_match' : null,
      categorizationConfidence: categoryId ? '1.0' : null,
      needsReview: false,
      status: 'confirmed' as const,
    }))

    const q = db.insert(transactions).values(values)
    const rows = await (plano.deduplicando ? q.onConflictDoNothing() : q)
      .returning({ id: transactions.id, categoryId: transactions.categoryId })

    inseridos.push(...rows)
  }

  return {
    inseridos: inseridos.length,
    ignoradosPorDuplicidade: plano.duplicadas + (plano.aInserir.length - inseridos.length),
    comNatureza: inseridos.filter(r => r.categoryId).length,
    documentId: doc.id,
    paraCategorizar: inseridos.filter(r => !r.categoryId).map(r => r.id),
  }
}
