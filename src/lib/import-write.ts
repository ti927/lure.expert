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
import { chavear } from '@/lib/import-dedup'
import { norm as normalizar } from '@/lib/format'

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

export const linhaImportadaSchema = z.object({
  data: dataIso.describe('Data de competência do lançamento, AAAA-MM-DD.'),
  dataDeCaixa: dataIso.optional()
    .describe('Quando o dinheiro se moveu, se for diferente. Alimenta o fluxo; a outra alimenta a DRE.'),
  descricao: z.string().trim().min(1).max(500),
  valor: z.number().positive()
    .describe('Sempre POSITIVO. O sinal vem de `sentido`, nunca do número.'),
  sentido: z.enum(['inflow', 'outflow']).describe('inflow = entrada, outflow = saída.'),
  conta: z.string().trim().max(200).optional()
    .describe('Identificador da conta no extrato, quando o arquivo traz mais de uma.'),
  categoria: z.string().trim().max(200).optional()
    .describe('Natureza vinda do arquivo — código ("4.4") ou nome. Casada contra o plano de contas; ' +
      'o que não casar entra sem natureza e vai para a fila de classificação.'),
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
function chavearLinhas(linhas: LinhaImportada[]): string[] {
  return chavear(linhas.map(l => ({
    competencia: l.data,
    valor: l.valor,
    sentido: l.sentido,
    descricao: l.descricao,
    conta: l.conta ?? null,
  })))
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolução da natureza — a camada 0, sem o formato de CSV
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Casa o que o arquivo chamou de natureza contra o plano de contas.
 *
 * `findCategoryByCsvMapping` do categorizador faz isto para o formato de CSV
 * (Categoria Pai / Filho / Tipo), com desempate cumulativo. Aqui a entrada é um
 * campo só, então a busca é mais simples de propósito: código exato primeiro,
 * nome normalizado depois. Ambíguo não casa — entra sem natureza e vai para a
 * fila, que é o comportamento honesto quando o arquivo não foi claro.
 *
 * **Só natureza folha**, pela mesma razão de sempre: pendurar lançamento num pai
 * duplicaria o valor na cascata da DRE.
 */
async function resolverNaturezas(
  organizationId: string,
  termos: string[],
): Promise<Map<string, { id: string; nome: string } | 'ambiguo'>> {
  const mapa = new Map<string, { id: string; nome: string } | 'ambiguo'>()
  if (termos.length === 0) return mapa

  const folhas = await db
    .select({ id: categories.id, codigo: categories.code, nome: categories.name })
    .from(categories)
    .where(and(
      eq(categories.organizationId, organizationId),
      eq(categories.isActive, true),
      sql`NOT EXISTS (SELECT 1 FROM ${categories} f WHERE f.parent_id = ${categories}.id)`,
    ))

  const porCodigo = new Map<string, { id: string; nome: string }>()
  const porNome = new Map<string, { id: string; nome: string }[]>()
  for (const f of folhas) {
    if (f.codigo) porCodigo.set(normalizar(f.codigo), { id: f.id, nome: f.nome })
    const chave = normalizar(f.nome)
    porNome.set(chave, [...(porNome.get(chave) ?? []), { id: f.id, nome: f.nome }])
  }

  for (const termo of Array.from(new Set(termos))) {
    const t = normalizar(termo)
    const porCod = porCodigo.get(t)
    if (porCod) { mapa.set(termo, porCod); continue }
    const porNom = porNome.get(t)
    if (porNom?.length === 1) { mapa.set(termo, porNom[0]); continue }
    if (porNom && porNom.length > 1) { mapa.set(termo, 'ambiguo'); continue }
    // "4.4 Insumos e Matérias-Primas" — código e nome juntos, como a própria
    // ferramenta `listar_categorias` devolve. Casa pelo prefixo de código.
    const prefixo = t.split(' ')[0]
    const porPrefixo = porCodigo.get(prefixo)
    if (porPrefixo) mapa.set(termo, porPrefixo)
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
  amostra: { data: string; descricao: string; valor: number; sentido: string; natureza: string | null }[]
  /** Índices (no lote original) das linhas a inserir, com chave e natureza. */
  aInserir: { indice: number; chave: string; categoryId: string | null }[]
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

  const chaves = chavearLinhas(linhas)

  // Quais já existem. A busca é por `external_id` na organização inteira, não
  // só na fonte desta origem: o mesmo extrato importado ontem sob outro nome de
  // origem continua sendo o mesmo lançamento.
  const existentes = chaves.length > 0
    ? await db.select({ externalId: transactions.externalId })
        .from(transactions)
        .where(and(
          eq(transactions.organizationId, organizationId),
          inArray(transactions.externalId, chaves),
        ))
    : []
  const jaTem = new Set(existentes.map(e => e.externalId).filter((v): v is string => !!v))

  const termos = linhas.map(l => l.categoria).filter((v): v is string => !!v)
  const naturezas = await resolverNaturezas(organizationId, termos)

  const aInserir: PlanoDeImportacao['aInserir'] = []
  const naoResolvidas = new Set<string>()
  let entradas = 0, saidas = 0, comNatureza = 0
  let de: string | null = null, ate: string | null = null

  linhas.forEach((l, i) => {
    if (jaTem.has(chaves[i])) return

    const achada = l.categoria ? naturezas.get(l.categoria) : undefined
    const categoryId = achada && achada !== 'ambiguo' ? achada.id : null
    if (l.categoria && !categoryId) naoResolvidas.add(l.categoria)
    if (categoryId) comNatureza++

    if (l.sentido === 'inflow') entradas += l.valor
    else saidas += l.valor
    if (!de || l.data < de) de = l.data
    if (!ate || l.data > ate) ate = l.data

    aInserir.push({ indice: i, chave: chaves[i], categoryId })
  })

  return {
    novas: aInserir.length,
    duplicadas: linhas.length - aInserir.length,
    recusadas,
    entradas,
    saidas,
    periodo: de && ate ? { de, ate } : null,
    comNatureza,
    naturezasNaoResolvidas: Array.from(naoResolvidas).slice(0, 20),
    amostra: aInserir.slice(0, 8).map(({ indice, categoryId }) => {
      const l = linhas[indice]
      const n = l.categoria ? naturezas.get(l.categoria) : undefined
      return {
        data: l.data, descricao: l.descricao, valor: l.valor, sentido: l.sentido,
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
  linhas: LinhaImportada[],
  plano: PlanoDeImportacao,
): Promise<ResultadoImportacao> {
  // Uma fonte por origem: é ela que dá o rótulo da conta em `/transacoes`.
  const nomeFonte = `MCP — ${origem}`.slice(0, 200)
  let [fonte] = await db.select().from(dataSources).where(and(
    eq(dataSources.organizationId, organizationId),
    eq(dataSources.provider, 'mcp'),
    eq(dataSources.name, nomeFonte),
  )).limit(1)

  if (!fonte) {
    ;[fonte] = await db.insert(dataSources).values({
      organizationId, type: 'statement', provider: 'mcp', name: nomeFonte,
    }).returning()
  }

  // O registro em `documents` existe para o lançamento ter origem: sem ele o
  // filtro "importação" de `/transacoes` não enxerga o lote e não há como
  // separar o que entrou por aqui. `storage_path` é NOT NULL e não há arquivo —
  // o esquema `mcp://` marca isso de forma legível, e `deleteDocument` sabe
  // pular a remoção no Storage.
  const [doc] = await db.insert(documents).values({
    organizationId,
    type: 'statement',
    filename: origem.slice(0, 200),
    storagePath: `mcp://${organizationId}/${Date.now()}`,
    mimeType: 'application/x-mcp-rows',
    sizeBytes: JSON.stringify(linhas).length,
    extractionStatus: 'completed',
    uploadedByUserId: userId,
    reportType: 'other',
    metadata: { source_type: 'statement', origem, via: 'mcp', linhasRecebidas: linhas.length },
  }).returning({ id: documents.id })

  const BATCH = 100
  const inseridos: { id: string; categoryId: string | null }[] = []

  for (let i = 0; i < plano.aInserir.length; i += BATCH) {
    const bloco = plano.aInserir.slice(i, i + BATCH)
    const rows = await db.insert(transactions).values(bloco.map(({ indice, chave, categoryId }) => {
      const l = linhas[indice]
      return {
        organizationId,
        dataSourceId: fonte.id,
        documentId: doc.id,
        externalId: chave,
        date: l.data,
        effectiveDate: l.dataDeCaixa ?? l.data,
        amount: l.valor.toFixed(2),
        currency: 'BRL',
        direction: l.sentido,
        description: l.descricao,
        accountId: l.conta ?? null,
        rawData: { ...l },
        metadata: { sourceType: 'statement', via: 'mcp', origem },
        categoryId,
        categorizationMethod: categoryId ? 'csv_match' : null,
        categorizationConfidence: categoryId ? '1.0' : null,
        needsReview: false,
        status: 'confirmed' as const,
      }
    }))
      .onConflictDoNothing()
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
