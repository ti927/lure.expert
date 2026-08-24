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
function brutoDaLinha(r: TransactionStaging, ctx: CabecalhoDoArquivo): Record<string, unknown> {
  const valor = r.amount === null ? null : Number(r.amount)

  if (ctx.tipoDeRelatorio === 'balanco') {
    // A linha de balanço é conta + saldo. Sem data, sem sentido, sem descrição:
    // a data vem do arquivo e o lado vem da natureza.
    return { valor, natureza: r.description }
  }

  return {
    competencia: r.date,
    caixa: r.effectiveDate,
    descricao: r.description,
    valor,
    sentido: r.direction,
  }
}

export interface LinhaNormalizada {
  staging: TransactionStaging
  valor: LancamentoParaGravar
  /** `null` quando o tipo de relatório não deduplica (balanço). */
  chave: string | null
  duplicada: boolean
}

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

  for (const r of linhasEmOrdem) {
    const n = normalizarLancamento(brutoDaLinha(r, cabecalho), cabecalho)
    if (n.ok) {
      normalizadas.push({ staging: r, valor: n.valor, chave: null, duplicada: false })
    } else {
      recusadas.push({ rowIndex: r.rowIndex, descricao: r.description ?? '', motivo: n.motivo })
    }
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
  }
}
