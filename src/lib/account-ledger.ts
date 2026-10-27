// Conferência de saldo — o extrato de UMA conta, com saldo corrido.
//
// A pergunta da tela é "o saldo bate com o banco?". Por isso três regras que
// não são as de `/transacoes`:
//
//  1. A data é a de CAIXA (`effective_date`, ou a competência quando vazia) —
//     é a do extrato do banco. A ordem principal é sempre ela; o que a tela
//     escolhe é a ordem DENTRO do dia.
//  2. O saldo é o REAL da conta: o saldo corrido é calculado numa subconsulta
//     sobre TODOS os lançamentos da conta, e só depois os filtros escondem
//     linhas. Filtrar uma natureza não muda o saldo de nenhuma linha — senão o
//     número deixaria de bater com o banco, que é o propósito da tela.
//  3. Há dois saldos por linha: o CORRIDO (depois desta linha, na ordem
//     escolhida — muda se a ordem do dia muda) e o FECHAMENTO do dia (depois de
//     todas as linhas da data — não muda nunca). É o fechamento que se confere.
//
// O saldo parte da ÂNCORA (`account_opening_balances`, migration 0034): o saldo
// no início de um dia, informado por quem confere. Sem âncora não há saldo — a
// Decisão 23 tirou do app justamente a soma de movimento apresentada como
// posição. Lançamentos antes da data da âncora ficam sem saldo.
//
// Leitura OPERACIONAL (uma linha por lançamento): lê `transactions`, e os
// filtros de natureza/dimensão perguntam às linhas (`condicoesDaListagem`).
// Fora de `'use server'` para ser exercitável por script.

import { z } from 'zod'
import { and, asc, count, desc, eq, getTableColumns, isNull, ne, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import {
  transactions, categories, documents, costCenters, businessUnits, legalEntities, contacts,
  accountOpeningBalances, dataSources,
} from '@/db/schema'
import { naturezasDoRateioSql, rateioComParteSemNaturezaSql } from '@/lib/sql-dimensions'
import { condicoesDaListagem, dataDeCaixaSql, type FiltrosDaListagem } from '@/lib/transactions-list-filters'
import { sanitizePageSize } from '@/lib/transactions-page-size'

type Exec = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

// ─── Saldo inicial ──────────────────────────────────────────────────────────

export interface SaldoInicial {
  /** Saldo no INÍCIO deste dia (YYYY-MM-DD). */
  data: string
  valor: number
  nota: string | null
  informadoPor: string | null
  atualizadoEm: string
}

export const saldoInicialSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'),
  // Pode ser negativo (cheque especial). Duas casas, como o lançamento.
  valor: z.number().finite().refine(v => Math.abs(v) < 1e13, 'Valor grande demais.'),
  nota: z.string().trim().max(500).optional().nullable(),
})

export async function lerSaldoInicial(
  organizationId: string, accountId: string, exec: Pick<typeof db, 'select'> = db,
): Promise<SaldoInicial | null> {
  const [r] = await exec.select().from(accountOpeningBalances).where(and(
    eq(accountOpeningBalances.organizationId, organizationId),
    eq(accountOpeningBalances.accountId, accountId),
  )).limit(1)
  if (!r) return null
  return {
    data: r.balanceDate,
    valor: Number(r.amount),
    nota: r.note,
    informadoPor: r.informedByUserId,
    atualizadoEm: r.updatedAt.toISOString(),
  }
}

/** Grava (ou substitui) o saldo inicial da conta. Uma âncora por conta. */
export async function gravarSaldoInicial(
  organizationId: string,
  accountId: string,
  entrada: z.input<typeof saldoInicialSchema>,
  userId: string | null,
  exec: Exec = db,
): Promise<{ error: string } | { ok: true }> {
  const p = saldoInicialSchema.safeParse(entrada)
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Dados inválidos.' }
  if (!accountId.trim()) return { error: 'Conta não informada.' }

  const valores = {
    balanceDate: p.data.data,
    amount: p.data.valor.toFixed(2),
    note: p.data.nota?.trim() || null,
    informedByUserId: userId,
  }
  await exec.insert(accountOpeningBalances)
    .values({ organizationId, accountId, ...valores })
    .onConflictDoUpdate({
      target: [accountOpeningBalances.organizationId, accountOpeningBalances.accountId],
      set: valores,
    })
  return { ok: true }
}

export async function apagarSaldoInicial(
  organizationId: string, accountId: string, exec: Exec = db,
): Promise<void> {
  await exec.delete(accountOpeningBalances).where(and(
    eq(accountOpeningBalances.organizationId, organizationId),
    eq(accountOpeningBalances.accountId, accountId),
  ))
}

// ─── A conta ────────────────────────────────────────────────────────────────

export interface ContaDoExtrato {
  accountId: string
  nome: string | null
  tipo: string | null
  numero: string | null
  dataSourceId: string | null
  /** Metadados da conexão (logo, badge). O servidor assina a URL do logo. */
  metadata: Record<string, unknown> | null
}

/**
 * Nome, tipo e número da conta — do lançamento MAIS RECENTE (conta renomeada
 * mostra o nome de hoje). Conta manual ainda sem lançamento vem do cadastro.
 * `null` = a conta não existe nesta organização.
 */
export async function descreverConta(
  organizationId: string, accountId: string, exec: Pick<typeof db, 'select'> = db,
): Promise<ContaDoExtrato | null> {
  const [t] = await exec
    .select({
      nome: transactions.accountName,
      tipo: transactions.accountType,
      numero: transactions.accountNumber,
      dataSourceId: transactions.dataSourceId,
      metadata: dataSources.metadata,
    })
    .from(transactions)
    .leftJoin(dataSources, eq(transactions.dataSourceId, dataSources.id))
    .where(and(
      eq(transactions.organizationId, organizationId),
      eq(transactions.accountId, accountId),
    ))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(1)
  if (t) {
    return {
      accountId, nome: t.nome, tipo: t.tipo, numero: t.numero,
      dataSourceId: t.dataSourceId, metadata: (t.metadata ?? null) as Record<string, unknown> | null,
    }
  }

  // Conta manual sem lançamento: só o cadastro sabe que ela existe.
  const [ds] = await exec
    .select({ id: dataSources.id, name: dataSources.name, metadata: dataSources.metadata })
    .from(dataSources)
    .where(and(
      eq(dataSources.organizationId, organizationId),
      sql`${dataSources.metadata}->>'accountId' = ${accountId}`,
    ))
    .limit(1)
  if (!ds) return null
  const meta = (ds.metadata ?? {}) as Record<string, unknown>
  const conta = (Array.isArray(meta.accounts) ? meta.accounts[0] : null) as
    { subtype?: string; number?: string } | null
  return {
    accountId, nome: ds.name, tipo: conta?.subtype ?? null, numero: conta?.number?.trim() || null,
    dataSourceId: ds.id, metadata: meta,
  }
}

// ─── O extrato ──────────────────────────────────────────────────────────────

/**
 * A ordem DENTRO do dia. As chaves são as mesmas de `/transacoes` (o cabeçalho
 * da coluna alterna `_asc`/`_desc`), menos data e conta. O padrão é a ordem de
 * chegada, que no extrato importado é a ordem do banco.
 */
function ordemDentroDoDia(sort: string | undefined): SQL[] {
  switch (sort) {
    case 'amount_asc':        return [sql`${transactions.amount} ASC`]
    case 'amount_desc':       return [sql`${transactions.amount} DESC`]
    case 'desc_asc':          return [sql`${transactions.description} ASC`]
    case 'desc_desc':         return [sql`${transactions.description} DESC`]
    case 'direction_asc':     return [sql`${transactions.direction} ASC`]
    case 'direction_desc':    return [sql`${transactions.direction} DESC`]
    case 'reporttype_asc':    return [sql`${documents.reportType} ASC`]
    case 'reporttype_desc':   return [sql`${documents.reportType} DESC`]
    case 'category_asc':      return [sql`${categories.code} ASC`, sql`${categories.name} ASC`]
    case 'category_desc':     return [sql`${categories.code} DESC`, sql`${categories.name} DESC`]
    case 'costcenter_asc':    return [sql`${costCenters.code} ASC`, sql`${costCenters.name} ASC`]
    case 'costcenter_desc':   return [sql`${costCenters.code} DESC`, sql`${costCenters.name} DESC`]
    case 'businessunit_asc':  return [sql`${businessUnits.code} ASC`, sql`${businessUnits.name} ASC`]
    case 'businessunit_desc': return [sql`${businessUnits.code} DESC`, sql`${businessUnits.name} DESC`]
    case 'legalentity_asc':   return [sql`${legalEntities.name} ASC`]
    case 'legalentity_desc':  return [sql`${legalEntities.name} DESC`]
    case 'contact_asc':       return [sql`${contacts.name} ASC`]
    case 'contact_desc':      return [sql`${contacts.name} DESC`]
    default:                  return [sql`${transactions.createdAt} ASC`]
  }
}

export interface ExtratoParams extends Omit<FiltrosDaListagem, 'accountId'> {
  page?: number
  pageSize?: number
  /** Ordem dentro do dia; `date_desc` inverte a exibição (mais recente primeiro). */
  sort?: string
}

export interface ResumoDoExtrato {
  saldoInicial: SaldoInicial | null
  /** Desde a data do saldo inicial, sem filtro nenhum. */
  entradas: number
  saidas: number
  /** Saldo inicial + entradas − saídas: o fechamento do último dia com lançamento. */
  saldoFinal: number | null
  ultimaData: string | null
  /** Lançamentos da conta anteriores ao saldo inicial — aparecem sem saldo. */
  antesDoSaldoInicial: number
}

/**
 * O extrato da conta, paginado, com o saldo de cada linha.
 *
 * Duas camadas: `corrido` numera e acumula TODOS os lançamentos da conta na
 * ordem cronológica + a ordem do dia; a consulta de fora aplica os filtros e
 * pagina. Funções de janela rodam antes do LIMIT, então a página 3 já chega com
 * o saldo certo.
 */
export async function lerExtratoDaConta(
  organizationId: string,
  accountId: string,
  params: ExtratoParams = {},
  exec: Pick<typeof db, 'select'> = db,
) {
  const { page = 1, pageSize, sort, ...filtros } = params
  const size = sanitizePageSize(pageSize)
  const offset = (Math.max(1, page) - 1) * size
  const ancora = await lerSaldoInicial(organizationId, accountId, exec)

  const daConta = and(
    eq(transactions.organizationId, organizationId),
    eq(transactions.accountId, accountId),
    ne(transactions.status, 'pending'),
  )!

  const caixa = dataDeCaixaSql
  const mov = sql`(CASE WHEN ${transactions.direction} = 'inflow' THEN ${transactions.amount} ELSE -${transactions.amount} END)`
  const ordem = sql.join([sql`${caixa} ASC`, ...ordemDentroDoDia(sort), sql`${transactions.id} ASC`], sql`, `)

  // Sem âncora, o saldo é nulo em toda linha: não há posição a afirmar.
  const apos = ancora ? sql`(${caixa} >= ${ancora.data}::date)` : sql`FALSE`
  const base = ancora ? sql`${ancora.valor.toFixed(2)}::numeric` : sql`NULL::numeric`
  const movAposAncora = sql`(CASE WHEN ${apos} THEN ${mov} ELSE 0 END)`

  const corrido = exec
    .select({
      id: sql<string>`${transactions.id}`.as('corrido_id'),
      ordem: sql<number>`ROW_NUMBER() OVER (ORDER BY ${ordem})`.as('corrido_ordem'),
      saldo: sql<string | null>`CASE WHEN ${apos} THEN ${base} + SUM(${movAposAncora}) OVER (
        ORDER BY ${ordem} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) END`.as('corrido_saldo'),
      // RANGE pela data: inclui todas as linhas do mesmo dia, em qualquer ordem.
      fechamento: sql<string | null>`CASE WHEN ${apos} THEN ${base} + SUM(${movAposAncora}) OVER (
        ORDER BY ${caixa} RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) END`.as('corrido_fechamento'),
    })
    .from(transactions)
    .leftJoin(documents, eq(transactions.documentId, documents.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(costCenters, eq(transactions.costCenterId, costCenters.id))
    .leftJoin(businessUnits, eq(transactions.businessUnitId, businessUnits.id))
    .leftJoin(legalEntities, eq(transactions.legalEntityId, legalEntities.id))
    .leftJoin(contacts, eq(transactions.contactId, contacts.id))
    .where(daConta)
    .as('corrido')

  const where = and(daConta, ...condicoesDaListagem(filtros, { regime: 'caixa' }))
  const inverter = sort === 'date_desc'

  const [rows, [{ total }], [totals], [resumo]] = await Promise.all([
    exec
      .select({
        ...getTableColumns(transactions),
        documentReportType: documents.reportType,
        dataCaixa: sql<string>`${caixa}::text`,
        saldo: corrido.saldo,
        fechamentoDoDia: corrido.fechamento,
        // A última linha VISÍVEL do dia (cronologicamente) — onde a tela mostra
        // o fechamento. Calculada depois dos filtros e antes do LIMIT, então vale
        // também quando a última linha real do dia está escondida por filtro.
        ultimaDoDia: sql<boolean>`(LEAD(${caixa}) OVER (ORDER BY ${corrido.ordem}) IS DISTINCT FROM ${caixa})`,
        isAllocated: sql<boolean>`EXISTS (
          SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = ${transactions}.id
        )`,
        // `${transactions}.id` pela Decisão 18.
        allocCategoryIds: naturezasDoRateioSql(sql`${transactions}.id`),
        allocSemNatureza: rateioComParteSemNaturezaSql(sql`${transactions}.id`),
      })
      .from(transactions)
      .innerJoin(corrido, eq(corrido.id, transactions.id))
      .leftJoin(documents, eq(transactions.documentId, documents.id))
      .where(where)
      .orderBy(inverter ? desc(corrido.ordem) : asc(corrido.ordem))
      .limit(size)
      .offset(offset),
    exec.select({ total: count() }).from(transactions)
      .leftJoin(documents, eq(transactions.documentId, documents.id))
      .where(where),
    exec.select({
      inflow: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'inflow' THEN ${transactions.amount} ELSE 0 END), 0)`,
      outflow: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'outflow' THEN ${transactions.amount} ELSE 0 END), 0)`,
    }).from(transactions)
      .leftJoin(documents, eq(transactions.documentId, documents.id))
      .where(where),
    // O resumo ignora os filtros: é a posição da conta.
    exec.select({
      entradas: sql<string>`COALESCE(SUM(CASE WHEN ${apos} AND ${transactions.direction} = 'inflow' THEN ${transactions.amount} END), 0)`,
      saidas: sql<string>`COALESCE(SUM(CASE WHEN ${apos} AND ${transactions.direction} = 'outflow' THEN ${transactions.amount} END), 0)`,
      ultimaData: sql<string | null>`MAX(${caixa})::text`,
      antes: sql<number>`COUNT(*) FILTER (WHERE NOT ${apos})::int`,
    }).from(transactions).where(daConta),
  ])

  const entradas = Number(resumo.entradas)
  const saidas = Number(resumo.saidas)
  const r: ResumoDoExtrato = {
    saldoInicial: ancora,
    entradas,
    saidas,
    saldoFinal: ancora ? Math.round((ancora.valor + entradas - saidas) * 100) / 100 : null,
    ultimaData: resumo.ultimaData,
    // Sem âncora, "antes" não tem sentido — não há data de corte.
    antesDoSaldoInicial: ancora ? Number(resumo.antes) : 0,
  }

  return {
    rows,
    total,
    pages: Math.ceil(total / size),
    pageSize: size,
    page,
    totals: { inflow: totals.inflow, outflow: totals.outflow },
    resumo: r,
  }
}

/**
 * Quantos lançamentos da organização não têm conta — os importados por arquivo
 * antes da 4.5. Eles não entram no saldo de conta nenhuma, e a tela diz isso.
 */
export async function contarLancamentosSemConta(
  organizationId: string, exec: Pick<typeof db, 'select'> = db,
): Promise<number> {
  const [r] = await exec.select({ n: count() }).from(transactions).where(and(
    eq(transactions.organizationId, organizationId),
    isNull(transactions.accountId),
    ne(transactions.status, 'pending'),
  ))
  return Number(r?.n ?? 0)
}
