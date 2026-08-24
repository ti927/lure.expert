// O contrato de importação: o que é um lançamento completo, e como um arquivo
// o descreve.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ISTO EXISTE
//
// Hoje existem quatro `INSERT INTO transactions` independentes, com zero código
// compartilhado — `sync-pluggy-item`, `approveAndInsert`, `import-write` (MCP) e
// `sync-acquirer-item`. Cada porta preencheu o que conseguiu, e o mesmo
// lançamento fica diferente conforme por onde entrou. Medido em 24/ago: campos
// de conta em 2.592/2.592 pelo Pluggy e 0/7.762 pelo upload; deduplicação em
// 100% pelo Pluggy e 0% pela tela.
//
// Este arquivo é a definição única. Ele NÃO centraliza o `db.insert` — os quatro
// envelopes são irreconciliáveis (cursor com memoização do Inngest; lote de 100
// mais evento de categorização; `ON CONFLICT` sobre plano prévio), e uma função
// de gravação comum viraria o arquivo mais frágil do projeto. O que se
// compartilha é a **normalização**: cada porta continua com o seu insert,
// montando os valores a partir do objeto que sai daqui.
//
// ─────────────────────────────────────────────────────────────────────────────
// TRÊS PRODUTORES, UMA ESPECIFICAÇÃO
//
//   1. A pessoa que baixa a planilha modelo e tabula o extrato à mão.
//   2. A IA no MCP, que recebe um extrato em qualquer formato e converte PARA
//      este. Sem um alvo publicado ela inventa a estrutura a cada conversa.
//   3. O parser do app, que ganha um caminho rápido determinístico quando o
//      cabeçalho casa — e só chama a IA quando não casa.
//
// **O cabeçalho canônico é caminho rápido, nunca requisito.** A promessa da
// Fase 2 é "cliente sobe relatório (qualquer formato)", e ela é a promessa ao
// dono de PME que arrasta o CSV do banco. Cabeçalho desconhecido continua caindo
// no parser LLM, inalterado.
//
// Sem `'use server'` e sem SDK da Anthropic de propósito: é o que permite os
// parsers, o MCP e os scripts importarem daqui.

import { z } from 'zod'
import { norm, parseAmount, parseDate } from '@/lib/format'

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulário
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Os dois layouts.
 *
 * `movimentos` alimenta **DRE e DFC ao mesmo tempo** — é o mesmo lançamento
 * lido por duas datas diferentes, e é para isso que as duas datas existem.
 * **Não existe "importar uma DFC":** o fluxo é uma leitura de `transactions`
 * por `COALESCE(effective_date, date)`.
 *
 * `balanco` alimenta o BP, que é **snapshot por documento**: `getBpAllDates`
 * agrupa por `documents.reference_date` e soma as transações daquele documento.
 * Uma linha de balanço é conta + saldo numa data — sem descrição, sem sentido,
 * sem data de caixa.
 */
export const TIPOS_DE_RELATORIO = ['movimentos', 'balanco'] as const
export type TipoDeRelatorio = (typeof TIPOS_DE_RELATORIO)[number]

/**
 * Conjunto FECHADO de tipo de conta.
 *
 * Os três primeiros vieram de `account.subtype` do Pluggy e viraram esquema do
 * produto por acidente (`ACCT_LABELS` só conhece esses três). `ACQUIRER` já é
 * escrito por `sync-acquirer-item` e não está no mapa — quando a Fase 8 voltar,
 * a tela mostraria a string crua. `OTHER` é a saída honesta para arquivo que não
 * diz.
 */
export const TIPOS_DE_CONTA = [
  'CHECKING_ACCOUNT', 'SAVINGS_ACCOUNT', 'CREDIT_CARD', 'ACQUIRER', 'OTHER',
] as const
export type TipoDeConta = (typeof TIPOS_DE_CONTA)[number]

/** Rótulo PT-BR aceito na planilha para cada tipo de conta. */
export const ROTULO_DE_CONTA: Record<TipoDeConta, string> = {
  CHECKING_ACCOUNT: 'C. Corrente',
  SAVINGS_ACCOUNT:  'Poupança',
  CREDIT_CARD:      'Cartão',
  ACQUIRER:         'Adquirente',
  OTHER:            'Outra',
}

const ALIAS_DE_TIPO_DE_CONTA: Record<string, TipoDeConta> = {
  'c. corrente': 'CHECKING_ACCOUNT', 'conta corrente': 'CHECKING_ACCOUNT',
  'cc': 'CHECKING_ACCOUNT', 'corrente': 'CHECKING_ACCOUNT',
  'poupanca': 'SAVINGS_ACCOUNT', 'poupança': 'SAVINGS_ACCOUNT',
  'cartao': 'CREDIT_CARD', 'cartão': 'CREDIT_CARD', 'cartao de credito': 'CREDIT_CARD',
  'credito': 'CREDIT_CARD',
  'adquirente': 'ACQUIRER', 'maquininha': 'ACQUIRER',
  'outra': 'OTHER', 'outro': 'OTHER',
}

export function lerTipoDeConta(texto: string | null | undefined): TipoDeConta {
  if (!texto) return 'OTHER'
  const t = norm(texto)
  if ((TIPOS_DE_CONTA as readonly string[]).includes(texto)) return texto as TipoDeConta
  return ALIAS_DE_TIPO_DE_CONTA[t] ?? 'OTHER'
}

// ─────────────────────────────────────────────────────────────────────────────
// As colunas
// ─────────────────────────────────────────────────────────────────────────────

export interface ColunaCanonica {
  /** O nome que sai na planilha modelo. */
  canonico: string
  /** O campo correspondente no schema. */
  campo: string
  /** Outros nomes aceitos. Comparados por `norm`, igualdade exata. */
  aliases: string[]
  obrigatoria: boolean
  /**
   * `v1` = lida e gravada hoje. `reservada` = declarada na planilha e no doc,
   * mas ainda sem leitor — o script de conformidade a reporta como pendência
   * em vez de a esconder. Prometer as quatro dimensões agora estouraria a
   * sessão: elas exigem resolução contra cadastro, que `previewFlatImport` sabe
   * fazer e `approveAndInsert` não.
   */
  leitor: 'v1' | 'reservada'
  ajuda: string
}

export const COLUNAS_MOVIMENTOS: ColunaCanonica[] = [
  // Os aliases marcados "visto em campo" saíram do relatório de
  // `verify-import-contract.ts` sobre o staging real, não de suposição.
  { canonico: 'Data de competência', campo: 'competencia', obrigatoria: true, leitor: 'v1',
    aliases: ['data', 'data de emissao', 'emissao', 'data da compra', 'competencia',
      'data lancamento', 'data venda', 'data da venda', 'data nf'],
    ajuda: 'Quando o fato aconteceu. Compra no cartão = data da compra. NF = emissão.' },
  { canonico: 'Data de caixa', campo: 'caixa', obrigatoria: false, leitor: 'v1',
    aliases: ['data de pagamento', 'data pagamento', 'data de credito', 'data de debito', 'liquidacao', 'data de liquidacao', 'vencimento'],
    ajuda: 'Quando o dinheiro se moveu. EM BRANCO significa igual à competência — não repita a competência aqui.' },
  { canonico: 'Descrição', campo: 'descricao', obrigatoria: true, leitor: 'v1',
    aliases: ['historico', 'lancamento', 'memo', 'observacao do extrato',
      'nome produto', 'produto', 'descricao do produto'],
    ajuda: 'Como aparece no extrato.' },
  { canonico: 'Valor', campo: 'valor', obrigatoria: true, leitor: 'v1',
    aliases: ['valor r$', 'montante', 'total', 'vlr'],
    ajuda: 'Sempre POSITIVO. O sinal vem do sentido, nunca do número.' },
  { canonico: 'Sentido', campo: 'sentido', obrigatoria: true, leitor: 'v1',
    aliases: ['tipo', 'entrada/saida', 'c/d', 'debito/credito', 'natureza do lancamento'],
    ajuda: 'Entrada ou Saída.' },
  { canonico: 'Moeda', campo: 'moeda', obrigatoria: false, leitor: 'v1',
    aliases: ['currency'],
    ajuda: 'Em branco = BRL. O produto é BRL only.' },
  { canonico: 'Conta', campo: 'conta', obrigatoria: false, leitor: 'v1',
    aliases: ['conta bancaria', 'banco', 'cartao', 'origem do recurso'],
    ajuda: 'Nome da conta ou cartão. Em geral vale para o arquivo inteiro — preencha no cabeçalho da revisão.' },
  { canonico: 'Tipo de conta', campo: 'tipoDeConta', obrigatoria: false, leitor: 'v1',
    aliases: ['tipo da conta'],
    ajuda: `Um de: ${Object.values(ROTULO_DE_CONTA).join(', ')}.` },
  { canonico: 'Número da conta', campo: 'numeroDaConta', obrigatoria: false, leitor: 'v1',
    aliases: ['numero da conta', 'agencia/conta', 'final do cartao'],
    ajuda: 'Opcional. Só quando o arquivo traz.' },
  { canonico: 'Natureza', campo: 'natureza', obrigatoria: false, leitor: 'v1',
    aliases: ['categoria', 'categoria filho', 'natureza filho', 'conta contabil', 'plano de contas'],
    ajuda: 'Código ou nome do plano de contas. Só natureza folha.' },
  { canonico: 'Centro de custo', campo: 'centroDeCusto', obrigatoria: false, leitor: 'reservada',
    aliases: ['cc', 'centro custo'], ajuda: 'Código ou nome. Ainda não lida na importação.' },
  { canonico: 'Unidade de negócio', campo: 'unidadeDeNegocio', obrigatoria: false, leitor: 'reservada',
    aliases: ['uen', 'unidade'], ajuda: 'Código ou nome. Ainda não lida na importação.' },
  { canonico: 'Entidade', campo: 'entidade', obrigatoria: false, leitor: 'reservada',
    aliases: ['entidade juridica', 'empresa', 'filial'], ajuda: 'Código ou nome. Ainda não lida na importação.' },
  { canonico: 'Contato', campo: 'contato', obrigatoria: false, leitor: 'reservada',
    aliases: ['cliente', 'fornecedor', 'contraparte', 'cnpj', 'cpf'],
    ajuda: 'Nome ou documento. Ainda não lida na importação.' },
  { canonico: 'Documento', campo: 'documento', obrigatoria: false, leitor: 'reservada',
    aliases: ['nf', 'nota fiscal', 'numero do documento', 'chave de acesso',
      'num nf', 'num pedido', 'numero do pedido'],
    ajuda: 'Número da nota ou chave de acesso. Ainda não lida na importação.' },
  { canonico: 'ID de origem', campo: 'idDeOrigem', obrigatoria: false, leitor: 'v1',
    aliases: ['id', 'identificador', 'id externo'],
    ajuda: 'Id do ERP. Quando vem, ele vence o cálculo por conteúdo na deduplicação.' },
  { canonico: 'Observação', campo: 'observacao', obrigatoria: false, leitor: 'reservada',
    aliases: ['obs', 'nota', 'comentario'], ajuda: 'Texto livre. Ainda não lida na importação.' },
]

export const COLUNAS_SALDOS: ColunaCanonica[] = [
  { canonico: 'Natureza', campo: 'natureza', obrigatoria: true, leitor: 'v1',
    aliases: ['conta', 'conta contabil', 'categoria', 'plano de contas', 'descricao'],
    ajuda: 'A conta patrimonial. Código ou nome, e precisa ser de um tipo de BP.' },
  { canonico: 'Saldo', campo: 'valor', obrigatoria: true, leitor: 'v1',
    aliases: ['valor', 'saldo em', 'montante'],
    ajuda: 'O saldo na data de referência do arquivo. Sempre positivo — a natureza dá o lado.' },
  { canonico: 'Observação', campo: 'observacao', obrigatoria: false, leitor: 'reservada',
    aliases: ['obs', 'nota'], ajuda: 'Texto livre. Ainda não lida na importação.' },
]

export function colunasDe(tipo: TipoDeRelatorio): ColunaCanonica[] {
  return tipo === 'balanco' ? COLUNAS_SALDOS : COLUNAS_MOVIMENTOS
}

// ─────────────────────────────────────────────────────────────────────────────
// Nível de ARQUIVO — o que a linha não carrega
// ─────────────────────────────────────────────────────────────────────────────

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')

/**
 * O contrato tem dois níveis, e este é o de cima.
 *
 * A conta é do ARQUIVO, não da linha: um extrato é de uma conta só, e
 * `tipoDeConta`/`numeroDaConta` nunca variam entre linhas do mesmo documento.
 * Quatro campos editáveis por linha em 7.762 linhas seria trabalho inventado —
 * é um campo no cabeçalho da revisão.
 *
 * `dataDeReferencia` é obrigatória no balanço porque é ela que vira a coluna de
 * `/balanco`; e é ela que a linha de BP herda como `date`, já que um balanço não
 * tem data por linha.
 */
export const cabecalhoDoArquivoSchema = z.object({
  tipoDeRelatorio: z.enum(TIPOS_DE_RELATORIO).default('movimentos'),
  dataDeReferencia: dataIso.nullable().default(null),
  conta: z.string().trim().max(200).nullable().default(null),
  tipoDeConta: z.enum(TIPOS_DE_CONTA).nullable().default(null),
  numeroDaConta: z.string().trim().max(60).nullable().default(null),
  moeda: z.string().trim().length(3).default('BRL'),
}).superRefine((c, ctx) => {
  if (c.tipoDeRelatorio === 'balanco' && !c.dataDeReferencia) {
    ctx.addIssue({
      code: 'custom',
      path: ['dataDeReferencia'],
      message: 'Balanço exige a data de referência: é ela que vira a coluna do mês e a data de cada linha.',
    })
  }
})

export type CabecalhoDoArquivo = z.infer<typeof cabecalhoDoArquivoSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Nível de LINHA
// ─────────────────────────────────────────────────────────────────────────────

export const lancamentoCanonicoSchema = z.object({
  competencia: dataIso,
  caixa: dataIso.nullable().default(null),
  descricao: z.string().trim().min(1).max(500),
  valor: z.number().positive('O valor é sempre positivo — o sinal vem do sentido'),
  sentido: z.enum(['inflow', 'outflow']),
  moeda: z.string().trim().length(3).default('BRL'),
  conta: z.string().trim().max(200).nullable().default(null),
  tipoDeConta: z.enum(TIPOS_DE_CONTA).nullable().default(null),
  numeroDaConta: z.string().trim().max(60).nullable().default(null),
  natureza: z.string().trim().max(200).nullable().default(null),
  idDeOrigem: z.string().trim().max(200).nullable().default(null),
})
export type LancamentoCanonico = z.infer<typeof lancamentoCanonicoSchema>

export const saldoCanonicoSchema = z.object({
  natureza: z.string().trim().min(1).max(200),
  valor: z.number().nonnegative(),
  observacao: z.string().trim().max(500).nullable().default(null),
})
export type SaldoCanonico = z.infer<typeof saldoCanonicoSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Resolução de cabeçalho
// ─────────────────────────────────────────────────────────────────────────────

export interface CabecalhoResolvido {
  /** campo canônico → índice da coluna no arquivo */
  mapa: Record<string, number>
  /** cabeçalhos do arquivo que não casaram com nada */
  desconhecidas: string[]
  /** colunas obrigatórias que faltaram */
  faltando: string[]
  /** true quando todas as obrigatórias casaram — o gatilho do caminho rápido */
  completo: boolean
}

/**
 * Casa o cabeçalho de um arquivo contra as colunas canônicas.
 *
 * Igualdade **exata após `norm`**, nunca `includes`. A heurística legada usa
 * `includes` e é exatamente por isso que ela confunde "Data" com "Data de
 * pagamento". Aqui, ambiguidade é ausência.
 *
 * Coluna extra desconhecida **não** desabilita o caminho rápido: export de ERP
 * sempre traz colunas a mais, e recusar por causa delas anularia o ganho.
 */
export function resolverCabecalho(
  headers: string[],
  tipo: TipoDeRelatorio = 'movimentos',
): CabecalhoResolvido {
  const colunas = colunasDe(tipo)
  const normalizados = headers.map(h => norm(h ?? ''))
  const mapa: Record<string, number> = {}
  const usados = new Set<number>()

  for (const col of colunas) {
    const nomes = [norm(col.canonico), ...col.aliases.map(norm)]
    const idx = normalizados.findIndex((h, i) => !usados.has(i) && h !== '' && nomes.includes(h))
    if (idx >= 0) {
      mapa[col.campo] = idx
      usados.add(idx)
    }
  }

  const faltando = colunas
    .filter(c => c.obrigatoria && mapa[c.campo] === undefined)
    .map(c => c.canonico)

  const desconhecidas = headers.filter((_, i) => !usados.has(i) && normalizados[i] !== '')

  return { mapa, desconhecidas, faltando, completo: faltando.length === 0 }
}

// ─────────────────────────────────────────────────────────────────────────────
// Conta
// ─────────────────────────────────────────────────────────────────────────────

export interface ContaCanonica {
  accountId: string | null
  accountName: string | null
  accountType: TipoDeConta | null
  accountNumber: string | null
}

/**
 * Texto de conta → as quatro colunas de `transactions`.
 *
 * `accountId` é **derivado e determinístico** (`arq:<slug do nome>`), não texto
 * livre. É o que faz a mesma conta em dois arquivos diferentes casar, e é o que
 * `getDataSourcesWithTransactions` agrupa para montar o filtro de `/transacoes`.
 * Hoje o MCP grava o texto cru do modelo ali, e o filtro mostra rótulo pela
 * metade.
 */
export function contaCanonica(
  nome: string | null | undefined,
  tipo?: string | null,
  numero?: string | null,
): ContaCanonica {
  const limpo = (nome ?? '').trim()
  if (!limpo) return { accountId: null, accountName: null, accountType: null, accountNumber: null }

  const slug = norm(limpo).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  return {
    accountId: `arq:${slug}`,
    accountName: limpo.slice(0, 200),
    accountType: lerTipoDeConta(tipo),
    accountNumber: (numero ?? '').trim().slice(0, 60) || null,
  }
}

// A chave de deduplicação vive em `@/lib/import-dedup`, não aqui — este arquivo
// é importado por `csv-templates.ts`, que roda no cliente, e `node:crypto` não
// existe lá. Separação de empacotamento, não de desenho.

// ─────────────────────────────────────────────────────────────────────────────
// A normalização — a função que todas as portas de arquivo passam a usar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O que vai para `transactions`. Não inclui o que é decidido pela porta:
 * `organizationId`, `dataSourceId`, `documentId`, `externalId` e `status`.
 *
 * **`status` fica de fora de propósito.** Não é divergência a normalizar: o
 * Pluggy grava `pending` porque nenhum humano viu aquelas linhas ainda (o portão
 * é `confirmPendingTransactions` em `/contas`), e a tela grava `confirmed`
 * porque a pessoa acabou de aprovar uma por uma. A regra do contrato é
 * declarativa: **`confirmed` quando houve aceite humano explícito, `pending`
 * quando não houve.**
 */
export interface LancamentoParaGravar {
  date: string
  effectiveDate: string
  amount: string
  currency: string
  direction: 'inflow' | 'outflow'
  description: string
  accountId: string | null
  accountName: string | null
  accountType: string | null
  accountNumber: string | null
  /** Texto da natureza como veio do arquivo. Quem resolve contra o plano de contas é a porta. */
  naturezaBruta: string | null
  idDeOrigem: string | null
}

export type Normalizacao =
  | { ok: true; valor: LancamentoParaGravar }
  | { ok: false; motivo: string }

const SENTIDO_ENTRADA = new Set(['inflow', 'entrada', 'credito', 'c', 'receita', 'recebimento', '+'])
const SENTIDO_SAIDA   = new Set(['outflow', 'saida', 'debito', 'd', 'despesa', 'pagamento', '-'])

export function lerSentido(texto: unknown): 'inflow' | 'outflow' | null {
  if (typeof texto !== 'string') return null
  const t = norm(texto)
  if (SENTIDO_ENTRADA.has(t)) return 'inflow'
  if (SENTIDO_SAIDA.has(t)) return 'outflow'
  return null
}

/**
 * Linha bruta (texto de planilha, ou objeto já tipado) + contexto do arquivo →
 * objeto de gravação, ou recusa com motivo legível.
 *
 * **Recusa por LINHA, nunca por lote.** Uma natureza errada não pode custar as
 * outras 39 linhas boas — é o mesmo princípio da importação de planilha da 9.5.
 * Quem chama acumula as recusas e mostra.
 */
export function normalizarLancamento(
  bruto: Record<string, unknown>,
  ctx: CabecalhoDoArquivo,
): Normalizacao {
  const texto = (k: string): string | null => {
    const v = bruto[k]
    if (v === null || v === undefined) return null
    const s = String(v).trim()
    return s === '' ? null : s
  }

  // ── Balanço: a linha não tem data nem sentido; os dois vêm do arquivo ──────
  if (ctx.tipoDeRelatorio === 'balanco') {
    if (!ctx.dataDeReferencia) return { ok: false, motivo: 'Balanço sem data de referência.' }
    const valor = typeof bruto.valor === 'number' ? bruto.valor : parseAmount(texto('valor'))
    if (valor === null) return { ok: false, motivo: 'Saldo ausente ou ilegível.' }
    const natureza = texto('natureza')
    if (!natureza) return { ok: false, motivo: 'Balanço exige a conta (natureza) em cada linha.' }

    const conta = contaCanonica(ctx.conta, ctx.tipoDeConta, ctx.numeroDaConta)
    return {
      ok: true,
      valor: {
        date: ctx.dataDeReferencia,
        effectiveDate: ctx.dataDeReferencia,
        amount: Math.abs(valor).toFixed(2),
        currency: ctx.moeda,
        // Toda linha de BP entra como `inflow`: quem dá o lado é a natureza, e
        // `process-document.ts` já força isso hoje para `balance_sheet`.
        direction: 'inflow',
        description: natureza,
        ...conta,
        naturezaBruta: natureza,
        idDeOrigem: null,
      },
    }
  }

  // ── Movimentos ────────────────────────────────────────────────────────────
  const competencia = typeof bruto.competencia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bruto.competencia)
    ? bruto.competencia
    : parseDate(texto('competencia'))
  if (!competencia) return { ok: false, motivo: 'Data de competência ausente ou ilegível.' }

  const caixaBruto = texto('caixa')
  const caixa = caixaBruto
    ? (/^\d{4}-\d{2}-\d{2}$/.test(caixaBruto) ? caixaBruto : parseDate(caixaBruto))
    : null
  if (caixaBruto && !caixa) return { ok: false, motivo: `Data de caixa ilegível: "${caixaBruto}".` }

  const valorNum = typeof bruto.valor === 'number' ? bruto.valor : parseAmount(texto('valor'))
  if (valorNum === null) return { ok: false, motivo: 'Valor ausente ou ilegível.' }
  if (valorNum === 0) return { ok: false, motivo: 'Valor zero.' }

  const descricao = texto('descricao')
  if (!descricao) return { ok: false, motivo: 'Descrição vazia.' }

  const sentido = lerSentido(bruto.sentido)
  if (!sentido) return { ok: false, motivo: 'Sentido ausente — informe Entrada ou Saída.' }

  const conta = contaCanonica(
    texto('conta') ?? ctx.conta,
    texto('tipoDeConta') ?? ctx.tipoDeConta,
    texto('numeroDaConta') ?? ctx.numeroDaConta,
  )

  return {
    ok: true,
    valor: {
      date: competencia,
      // Em branco significa igual à competência. É a regra da Decisão 7, e é o
      // que `COALESCE(effective_date, date)` já assume nas seis queries de caixa.
      effectiveDate: caixa ?? competencia,
      amount: Math.abs(valorNum).toFixed(2),
      currency: texto('moeda') ?? ctx.moeda,
      direction: sentido,
      description: descricao.slice(0, 500),
      ...conta,
      naturezaBruta: texto('natureza'),
      idDeOrigem: texto('idDeOrigem'),
    },
  }
}
