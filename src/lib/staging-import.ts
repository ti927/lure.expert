// A ponte entre `transactions_staging` e o contrato de importação.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ISTO É UM ARQUIVO, E NÃO CÓDIGO DENTRO DE `approveAndInsert`
//
// Duas telas precisam da MESMA resposta: o aviso da tela de revisão ("12 destas
// linhas já foram importadas") e a gravação. Se o aviso e o insert calculassem
// separado, o aviso mentiria — e mentiria justamente sobre o número que o
// usuário usa para decidir clicar em importar.
//
// Fora de `'use server'` de propósito, pela convenção da casa: o que está aqui
// pode ser exercitado direto contra o banco num script, sem sessão HTTP.
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE ESTAVA QUEBRADO E ISTO CONSERTA (medido em 24/ago, contra o banco)
//
//   · dedup no caminho da tela: 0 de 7.762. O DoD literal da Sessão 2.8 do
//     GUIA_OPERACIONAL — "reuploadar mesmo arquivo, ver 0 inserções" — nunca foi
//     construído. Subir o mesmo extrato duas vezes dobrava a contabilidade.
//   · campos de conta: 0 de 7.762.
//   · balanço: `approveAndInsert` filtrava `r.date && r.amount && r.direction`, e
//     uma linha de balanço não tem data própria — tem a data do ARQUIVO. Toda
//     linha caía em `skipped`. É por isso que nunca existiu um BP no banco:
//     0 documentos `balance_sheet` em toda a base.

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { transactions } from '@/db/schema'
import type { TransactionStaging } from '@/db/schema/transactions-staging'
import type { Document } from '@/db/schema/documents'
import {
  cabecalhoDoArquivoSchema,
  normalizarLancamento,
  lerTipoDeConta,
  type CabecalhoDoArquivo,
  type LancamentoParaGravar,
} from '@/lib/import-contract'
import { chavear, deduplica } from '@/lib/import-dedup'
import {
  mapaDeContasManuais,
  type ContaManual,
  type ResumoDeContaDoArquivo,
} from '@/lib/accounts'

type Exec = Pick<typeof db, 'select'>

/** A conta declarada para o arquivo inteiro, guardada em `documents.metadata`. */
export interface ContaDoArquivo {
  nome: string
  tipo: string | null
  numero: string | null
}

export function lerContaDoDocumento(doc: Pick<Document, 'metadata'>): ContaDoArquivo | null {
  const meta = (doc.metadata ?? {}) as Record<string, unknown>
  const conta = meta.account
  if (!conta || typeof conta !== 'object') return null
  const c = conta as Record<string, unknown>
  const nome = typeof c.nome === 'string' ? c.nome.trim() : ''
  if (!nome) return null
  return {
    nome,
    tipo: typeof c.tipo === 'string' ? c.tipo : null,
    numero: typeof c.numero === 'string' && c.numero.trim() ? c.numero.trim() : null,
  }
}

/**
 * O nível de ARQUIVO do contrato, montado a partir do registro em `documents`.
 *
 * O formulário de `/upload` já coleta quase tudo — origem, período e, para
 * balanço, a data de referência (obrigatória lá desde a Fase 6). O que faltava
 * era alguém ler.
 */
export function cabecalhoDoDocumento(
  doc: Pick<Document, 'metadata' | 'reportType' | 'referenceDate'>,
): { error: string } | CabecalhoDoArquivo {
  const conta = lerContaDoDocumento(doc)
  const parsed = cabecalhoDoArquivoSchema.safeParse({
    tipoDeRelatorio: doc.reportType === 'balance_sheet' ? 'balanco' : 'movimentos',
    dataDeReferencia: doc.referenceDate ?? null,
    conta: conta?.nome ?? null,
    tipoDeConta: conta ? lerTipoDeConta(conta.tipo) : null,
    numeroDaConta: conta?.numero ?? null,
    moeda: 'BRL',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues.map(i => i.message).join(' ') }
  }
  return parsed.data
}

/**
 * Uma linha de staging vira a entrada bruta que o contrato sabe normalizar.
 *
 * Os valores vão **tipados** (número, ISO) em vez de texto: o contrato testa
 * `typeof === 'number'` e o formato ISO antes de cair no parser de texto, então
 * assim o caminho de texto nem é exercido. Importa porque `amount` vem do
 * Postgres como string com PONTO decimal ("467.62"), e um parser de moeda
 * brasileiro leria isso como milhar.
 */
/**
 * A conta escolhida NA TELA para uma linha, guardada em `raw_data.__conta`.
 *
 * Fica **ao lado** de `__contrato` e não por cima: `raw_data` é o espelho fiel do
 * que o arquivo disse (é copiado inteiro para `transactions.raw_data`, e é o que
 * torna a camada 0 auditável). Sobrescrever `__contrato` apagaria a diferença
 * entre "o arquivo disse Caixa" e "alguém corrigiu para Caixa".
 *
 * `nome: null` é o "sem conta" explícito — a única forma de uma linha recusar a
 * conta do cabeçalho.
 */
export interface ContaEditadaNaLinha {
  nome: string | null
  tipo?: string | null
  numero?: string | null
}

export function lerContaEditada(rawData: unknown): ContaEditadaNaLinha | null {
  const raw = (rawData ?? {}) as Record<string, unknown>
  const c = raw.__conta
  if (!c || typeof c !== 'object') return null
  const o = c as Record<string, unknown>
  if (!('nome' in o)) return null
  return {
    nome: typeof o.nome === 'string' && o.nome.trim() ? o.nome.trim() : null,
    tipo: typeof o.tipo === 'string' ? o.tipo : null,
    numero: typeof o.numero === 'string' && o.numero.trim() ? o.numero.trim() : null,
  }
}

/**
 * Uma linha de staging vira a entrada bruta que o contrato sabe normalizar, com
 * o contexto de arquivo que vale **para ela**.
 *
 * O contexto é por linha porque a precedência tem três degraus:
 *
 *     __conta (a escolha humana)  >  __contrato (o que o arquivo disse)  >  cabeçalho
 *
 * Os dois últimos já funcionavam dentro de `normalizarLancamento`
 * (`texto('conta') ?? ctx.conta`). O primeiro precisa do contexto capado: em
 * `texto()`, string vazia vira `null` e cai no cabeçalho, então "sem conta" não
 * é representável pelo bruto — tem de ser um `ctx` sem conta.
 */
function preparoDaLinha(
  r: TransactionStaging,
  ctx: CabecalhoDoArquivo,
): { bruto: Record<string, unknown>; ctx: CabecalhoDoArquivo; contaDaLinha: boolean } {
  const valor = r.amount === null ? null : Number(r.amount)

  // As colunas canônicas que não têm campo próprio na staging (conta, tipo e
  // número de conta, moeda, id de origem, natureza) chegam por `rawData`,
  // escritas pelo parser quando o cabeçalho é o publicado. Quando não são,
  // ficam vazias e o nível de ARQUIVO responde por elas — que é o caso comum.
  const raw = (r.rawData ?? {}) as Record<string, unknown>
  const contrato = raw.__contrato && typeof raw.__contrato === 'object'
    ? (raw.__contrato as Record<string, string>)
    : {}

  if (ctx.tipoDeRelatorio === 'balanco') {
    // A linha de balanço é conta + saldo. Sem data, sem sentido, sem descrição:
    // a data vem do arquivo e o lado vem da natureza. A conta também: o ramo de
    // balanço de `normalizarLancamento` lê só `ctx`, e por isso a coluna Conta
    // por linha não existe nem no plano nem na tela para BP.
    return { bruto: { valor, natureza: contrato.natureza ?? r.description }, ctx, contaDaLinha: false }
  }

  const bruto: Record<string, unknown> = {
    ...contrato,
    competencia: r.date,
    caixa: r.effectiveDate,
    descricao: r.description,
    valor,
    sentido: r.direction,
  }

  const edicao = lerContaEditada(r.rawData)
  if (!edicao) {
    return { bruto, ctx, contaDaLinha: Boolean(contrato.conta?.trim()) }
  }

  // Com edição, o cabeçalho não responde mais por esta linha — nem para
  // completar tipo/número, que passariam a descrever outra conta.
  const ctxSemConta: CabecalhoDoArquivo = { ...ctx, conta: null, tipoDeConta: null, numeroDaConta: null }

  if (!edicao.nome) {
    delete bruto.conta
    delete bruto.tipoDeConta
    delete bruto.numeroDaConta
    return { bruto, ctx: ctxSemConta, contaDaLinha: false }
  }

  bruto.conta = edicao.nome
  bruto.tipoDeConta = edicao.tipo ?? ''
  bruto.numeroDaConta = edicao.numero ?? ''
  return { bruto, ctx: ctxSemConta, contaDaLinha: true }
}

export interface LinhaNormalizada {
  staging: TransactionStaging
  valor: LancamentoParaGravar
  /** `null` quando o tipo de relatório não deduplica (balanço). */
  chave: string | null
  duplicada: boolean
  /**
   * A conta CADASTRADA a que a linha se vincula — é ela que dá o
   * `data_source_id`. `null` significa que nenhuma casou, e **nada é criado**:
   * a linha entra sem vínculo, mantendo as colunas `account_*`.
   */
  conta: ContaManual | null
  /** O que a linha (ou o cabeçalho) declarou, mesmo quando não casou com o cadastro. */
  contaDeclarada: { nome: string; accountId: string } | null
}

/** O que a tela mostra na coluna Conta de cada linha. */
export interface ContaDaLinha {
  accountId: string
  rotulo: string
  /** `false` = o arquivo citou, o cadastro não tem. A linha entra sem vínculo. */
  cadastrada: boolean
}

/**
 * A edição de conta feita na tela de revisão.
 *
 * `definir` só aceita conta que JÁ existe: o arquivo (e a edição sobre ele)
 * nunca cria conta — criar é ato explícito, em `/contas` ou no bloco do
 * cabeçalho.
 */
export type EdicaoDeConta =
  | { modo: 'definir'; nome: string }
  | { modo: 'sem-conta' }
  | { modo: 'do-arquivo' }

export interface LinhaRecusada {
  rowIndex: number
  descricao: string
  motivo: string
}

export interface PlanoDeStaging {
  cabecalho: CabecalhoDoArquivo
  /** Todas as que passaram na normalização, duplicadas inclusive. */
  normalizadas: LinhaNormalizada[]
  recusadas: LinhaRecusada[]
  /** As que serão de fato inseridas. */
  aInserir: LinhaNormalizada[]
  duplicadas: number
  /** Falso para balanço — snapshot se substitui, não se acumula. */
  deduplicando: boolean
  /** Uma entrada por conta distinta citada, na ordem em que apareceram. */
  contasDoArquivo: ResumoDeContaDoArquivo[]
  /** Linhas normalizadas que não citam conta nenhuma — nem própria, nem do cabeçalho. */
  semConta: number
}

/**
 * O que a importação faria, sem gravar.
 *
 * **A ordem das linhas é significativa e por isso é exigida do chamador.** A
 * chave de dedup numera as repetições de linhas idênticas (dois cafés de R$ 15
 * no mesmo dia são dois lançamentos legítimos), então as linhas precisam vir na
 * ordem do arquivo — `ORDER BY row_index`. Sem isso a numeração muda entre
 * execuções e o mesmo arquivo passa a gerar chaves diferentes: a dedup deixaria
 * de reconhecer o próprio trabalho.
 */
export async function planejarStaging(
  organizationId: string,
  doc: Pick<Document, 'metadata' | 'reportType' | 'referenceDate'>,
  linhasEmOrdem: TransactionStaging[],
  exec: Exec = db,
): Promise<{ error: string } | PlanoDeStaging> {
  const cabecalho = cabecalhoDoDocumento(doc)
  if ('error' in cabecalho) return cabecalho

  const normalizadas: LinhaNormalizada[] = []
  const recusadas: LinhaRecusada[] = []

  // O cadastro inteiro numa query só, antes do laço. A resolução é por
  // IDENTIDADE (`arq:<slug>`), não por texto — ver `mapaDeContasManuais`.
  const cadastro = await mapaDeContasManuais(organizationId, exec)
  const porConta = new Map<string, ResumoDeContaDoArquivo>()
  let semConta = 0

  for (const r of linhasEmOrdem) {
    const p = preparoDaLinha(r, cabecalho)
    const n = normalizarLancamento(p.bruto, p.ctx)
    if (!n.ok) {
      recusadas.push({ rowIndex: r.rowIndex, descricao: r.description ?? '', motivo: n.motivo })
      continue
    }

    // **A resolução não toca `n.valor`.** As quatro colunas `account_*` são
    // gravadas do jeito que o arquivo declarou, casando com o cadastro ou não —
    // e é isso que mantém a chave de dedup estável: se ela dependesse de a conta
    // estar cadastrada, o mesmo arquivo geraria chaves diferentes antes e depois
    // de alguém criar a conta, e a segunda importação duplicaria a
    // contabilidade em silêncio.
    const accountId = n.valor.accountId
    let conta: ContaManual | null = null
    let contaDeclarada: { nome: string; accountId: string } | null = null

    if (accountId) {
      conta = cadastro.get(accountId) ?? null
      contaDeclarada = { nome: n.valor.accountName ?? accountId, accountId }
      const resumo = porConta.get(accountId)
      if (resumo) {
        resumo.linhas++
        if (p.contaDaLinha) resumo.doCabecalho = false
      } else {
        porConta.set(accountId, {
          nomeDeclarado: contaDeclarada.nome,
          accountId,
          conta,
          linhas: 1,
          doCabecalho: !p.contaDaLinha,
        })
      }
    } else {
      semConta++
    }

    normalizadas.push({ staging: r, valor: n.valor, chave: null, duplicada: false, conta, contaDeclarada })
  }

  const deduplicando = deduplica(cabecalho.tipoDeRelatorio)

  if (deduplicando && normalizadas.length > 0) {
    const chaves = chavear(normalizadas.map(n => ({
      competencia: n.valor.date,
      valor: Number(n.valor.amount),
      sentido: n.valor.direction,
      descricao: n.valor.description,
      conta: n.valor.accountId,
    })))
    normalizadas.forEach((n, i) => { n.chave = chaves[i] })

    // A busca é por `external_id` na ORGANIZAÇÃO inteira, não na fonte deste
    // documento: o mesmo extrato já importado pelo MCP, ou sob outra conta,
    // continua sendo o mesmo lançamento. É a mesma decisão de `import-write.ts`,
    // e é o que faz as duas portas de arquivo enxergarem uma à outra.
    const existentes = await exec
      .select({ externalId: transactions.externalId })
      .from(transactions)
      .where(and(
        eq(transactions.organizationId, organizationId),
        inArray(transactions.externalId, chaves),
      ))
    const jaTem = new Set(existentes.map(e => e.externalId).filter((v): v is string => !!v))
    for (const n of normalizadas) {
      if (n.chave && jaTem.has(n.chave)) n.duplicada = true
    }
  }

  const aInserir = normalizadas.filter(n => !n.duplicada)

  return {
    cabecalho,
    normalizadas,
    recusadas,
    aInserir,
    duplicadas: normalizadas.length - aInserir.length,
    deduplicando,
    contasDoArquivo: Array.from(porConta.values()),
    semConta,
  }
}
