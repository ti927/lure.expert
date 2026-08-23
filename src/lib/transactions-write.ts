// A escrita de classificação, fora de `'use server'`.
//
// Movida de `src/server/transactions.ts` — não copiada. O servidor MCP não pode
// importar de `src/server/**` (todo arquivo de lá chama `redirect()`, que numa
// resposta JSON-RPC vira exceção crua), e duas cópias da regra de classificação
// é como a tela e o MCP passam a classificar diferente sem ninguém notar.
//
// O que ficou na server action: a sessão, o `revalidatePath` e o formato de
// retorno que o diálogo espera.

import { z } from 'zod'
import { and, eq, gte, inArray, isNull, lte, ne, sql, SQL } from 'drizzle-orm'
import { db } from '@/db'
import { transactions, categorizationRules, categories, transactionAllocations } from '@/db/schema'

export const dimensionSchema = z.object({
  categoryId:     z.string().uuid().nullable().optional(),
  costCenterId:   z.string().uuid().nullable().optional(),
  businessUnitId: z.string().uuid().nullable().optional(),
  legalEntityId:  z.string().uuid().nullable().optional(),
  contactId:      z.string().uuid().nullable().optional(),
})

export type DimensionData = z.infer<typeof dimensionSchema>

/** As quatro que o rateio reparte. A natureza não é rateada. */
const DIMENSOES_RATEAVEIS = ['costCenterId', 'businessUnitId', 'legalEntityId', 'contactId'] as const

export function mexeEmDimensaoRateavel(data: DimensionData): boolean {
  return DIMENSOES_RATEAVEIS.some(k => data[k] !== undefined)
}

/**
 * Só Natureza Filho pode ser atribuída a lançamento.
 *
 * O plano de contas tem três níveis, e pendurar lançamento num pai quebraria a
 * cascata da DRE — o valor apareceria no pai E na soma dos filhos.
 */
export async function assertLeafCategory(
  categoryId: string,
  organizationId: string,
): Promise<string | null> {
  const [cat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.organizationId, organizationId)))
    .limit(1)
  if (!cat) return 'Categoria não encontrada.'

  const [child] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, categoryId), eq(categories.organizationId, organizationId)))
    .limit(1)
  if (child) return 'Categorias com subcategorias não podem ser atribuídas diretamente a transações.'
  return null
}

/**
 * As colunas a gravar.
 *
 * `undefined` significa "não mexer" e `null` significa "limpar" — a distinção é
 * o que permite classificar só a natureza sem apagar o centro de custo que já
 * estava lá.
 */
export function montarUpdates(data: DimensionData): Partial<typeof transactions.$inferInsert> {
  const updates: Partial<typeof transactions.$inferInsert> = {
    categorizationMethod: 'manual',
    needsReview: false,
    updatedAt: new Date(),
  }
  if (data.categoryId     !== undefined) updates.categoryId     = data.categoryId
  if (data.costCenterId   !== undefined) updates.costCenterId   = data.costCenterId
  if (data.businessUnitId !== undefined) updates.businessUnitId = data.businessUnitId
  if (data.legalEntityId  !== undefined) updates.legalEntityId  = data.legalEntityId
  if (data.contactId      !== undefined) updates.contactId      = data.contactId
  return updates
}

/**
 * Ensina o categorizador com o que o humano decidiu.
 *
 * Identidade composta `(description, accountId)`: a mesma descrição em contas
 * diferentes pode ter destino diferente, e uma regra global sobrescreveria a
 * específica.
 */
export async function upsertRule(
  organizationId: string,
  description: string,
  accountId: string | null,
  data: DimensionData,
) {
  const trimmed = description.slice(0, 200)

  const [existing] = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(
      eq(categorizationRules.organizationId, organizationId),
      sql`${categorizationRules.conditions}->>'description' = ${trimmed}`,
      accountId
        ? sql`${categorizationRules.conditions}->>'accountId' = ${accountId}`
        : sql`${categorizationRules.conditions}->>'accountId' IS NULL`,
    ))
    .limit(1)

  if (existing) {
    const updates: Partial<typeof categorizationRules.$inferInsert> = { updatedAt: new Date() }
    if (data.categoryId     !== undefined) updates.targetCategoryId     = data.categoryId
    if (data.costCenterId   !== undefined) updates.targetCostCenterId   = data.costCenterId
    if (data.businessUnitId !== undefined) updates.targetBusinessUnitId = data.businessUnitId
    if (data.legalEntityId  !== undefined) updates.targetLegalEntityId  = data.legalEntityId
    if (data.contactId      !== undefined) updates.targetContactId      = data.contactId

    await db.update(categorizationRules).set(updates).where(eq(categorizationRules.id, existing.id))
    return
  }

  const conditions: Record<string, string> = { description: trimmed }
  if (accountId) conditions.accountId = accountId

  await db.insert(categorizationRules).values({
    organizationId,
    name: `Auto: ${trimmed.slice(0, 80)}`,
    conditions,
    targetCategoryId:     data.categoryId ?? null,
    targetCostCenterId:   data.costCenterId ?? null,
    targetBusinessUnitId: data.businessUnitId ?? null,
    targetLegalEntityId:  data.legalEntityId ?? null,
    targetContactId:      data.contactId ?? null,
    autoGenerated: false,
    confirmedAt: new Date(),
    priority: 0,
  })
}

/** Cria uma regra por par único `(descrição efetiva, conta)` do lote. */
export async function ensinarRegras(
  organizationId: string,
  linhas: { description: string; cleanedDescription: string | null; accountId: string | null }[],
  data: DimensionData,
): Promise<number> {
  const pares = new Map<string, { description: string; accountId: string | null }>()
  for (const tx of linhas) {
    const desc = tx.cleanedDescription || tx.description
    const chave = `${desc}::${tx.accountId ?? ''}`
    if (!pares.has(chave)) pares.set(chave, { description: desc, accountId: tx.accountId })
  }
  await Promise.all(
    Array.from(pares.values()).map(p => upsertRule(organizationId, p.description, p.accountId, data)),
  )
  return pares.size
}

// ─────────────────────────────────────────────────────────────────────────────
// Classificação por FILTRO — o caminho do MCP
// ─────────────────────────────────────────────────────────────────────────────

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')

/**
 * O filtro é estreito de propósito, e é UM só para todas as escritas em lote.
 *
 * Não é a superfície de filtros de `/transacoes` — é o subconjunto que descreve
 * um lote. Reaproveitar o filtro da tela arrastaria a leitura paginada inteira
 * para cá e daria ao modelo vinte maneiras de pedir a mesma coisa. E um único
 * vocabulário de filtro vale mais que um por operação: quem aprendeu a
 * descrever um lote para classificar já sabe descrevê-lo para ratear.
 */
export const filtroLancamentosSchema = z.object({
  descricaoContem: z.string().trim().min(2).max(120).optional()
    .describe('Trecho da descrição, sem diferenciar maiúsculas. Ex.: "UBER".'),
  semNatureza: z.boolean().optional()
    .describe('Só os que ainda não têm natureza.'),
  categorias: z.array(z.string().uuid()).max(50).optional()
    .describe('Só os que hoje estão nestas naturezas — para reclassificar de uma para outra.'),
  de:  dataIso.optional(),
  ate: dataIso.optional(),
  direcao: z.enum(['inflow', 'outflow']).optional(),
  valorMinimo: z.number().nonnegative().optional()
    .describe('Valor em reais, sempre positivo: o sinal vem do sentido, não do número.'),
  valorMaximo: z.number().nonnegative().optional(),
  contas: z.array(z.string()).max(20).optional(),
}).refine(
  f => Object.values(f).some(v => v !== undefined),
  // Sem isto, um filtro vazio casaria com a base inteira da organização. É o
  // erro que mais dói e o mais fácil de cometer.
  'Informe ao menos um critério. Filtro vazio atingiria todos os lançamentos.',
)

export type FiltroLancamentos = z.infer<typeof filtroLancamentosSchema>

/** Teto por operação. O mesmo espírito do limite de 200 do diálogo da tela. */
export const TETO_CLASSIFICACAO = 500

function condicoes(organizationId: string, f: FiltroLancamentos): SQL[] {
  const cond: SQL[] = [
    eq(transactions.organizationId, organizationId),
    // `pending` é lançamento de importação ainda não aprovada; classificá-lo
    // seria decidir sobre algo que o usuário ainda não aceitou.
    ne(transactions.status, 'pending'),
  ]

  if (f.descricaoContem) {
    const alvo = `%${f.descricaoContem}%`
    cond.push(sql`(${transactions.description} ILIKE ${alvo}
                   OR ${transactions.cleanedDescription} ILIKE ${alvo})`)
  }
  if (f.semNatureza) cond.push(isNull(transactions.categoryId))
  if (f.categorias?.length) cond.push(inArray(transactions.categoryId, f.categorias))
  if (f.de)  cond.push(gte(transactions.date, f.de))
  if (f.ate) cond.push(lte(transactions.date, f.ate))
  if (f.direcao) cond.push(eq(transactions.direction, f.direcao))
  if (f.valorMinimo !== undefined) cond.push(gte(transactions.amount, String(f.valorMinimo)))
  if (f.valorMaximo !== undefined) cond.push(lte(transactions.amount, String(f.valorMaximo)))
  if (f.contas?.length) cond.push(inArray(transactions.accountId, f.contas))

  return cond
}

/**
 * Lançamento rateado não aceita dimensão no pai.
 *
 * É regra do banco (gatilho da migration 0026): com rateio, as dimensões do pai
 * ficam vazias, porque preenchê-las faria toda leitura ainda não migrada
 * atribuir o valor INTEGRAL a uma das partes. Sem esta exclusão o UPDATE
 * inteiro seria recusado pelo gatilho, e o lote todo falharia por causa de um
 * lançamento — daí excluir e CONTAR, para a prévia dizer quantos ficaram de fora.
 */
const semRateio = sql`NOT EXISTS (
  SELECT 1 FROM ${transactionAllocations}
  WHERE ${transactionAllocations.transactionId} = ${transactions.id}
)`

/** Os ids que o filtro descreve agora — o ponto de entrada das outras escritas em lote. */
export async function idsPorFiltro(
  organizationId: string,
  filtro: FiltroLancamentos,
  limite: number,
): Promise<string[]> {
  const linhas = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(...condicoes(organizationId, filtro)))
    .orderBy(sql`${transactions.date} ASC`)
    .limit(limite)
  return linhas.map(l => l.id)
}

export interface ResumoClassificacao {
  quantidade: number
  valorTotal: number
  /** Excluídos por serem rateados — só quando a classificação mexe em dimensão. */
  rateadosExcluidos: number
  /** Quantas regras de categorização o lote vai criar ou atualizar. */
  regrasAfetadas: number
  amostra: { data: string; descricao: string; valor: number; sentido: string }[]
  excedeTeto: boolean
}

export async function resumirClassificacao(
  organizationId: string,
  filtro: FiltroLancamentos,
  data: DimensionData,
): Promise<ResumoClassificacao> {
  const base = condicoes(organizationId, filtro)
  const cond = mexeEmDimensaoRateavel(data) ? [...base, semRateio] : base

  const [agregado] = await db
    .select({
      quantidade: sql<number>`COUNT(*)::int`,
      valorTotal: sql<string>`COALESCE(SUM(${transactions.amount}), 0)::text`,
      regras: sql<number>`COUNT(DISTINCT (COALESCE(NULLIF(${transactions.cleanedDescription}, ''), ${transactions.description}), ${transactions.accountId}))::int`,
    })
    .from(transactions)
    .where(and(...cond))

  let rateadosExcluidos = 0
  if (mexeEmDimensaoRateavel(data)) {
    const [r] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(and(...base, sql`NOT (${semRateio})`))
    rateadosExcluidos = Number(r?.n ?? 0)
  }

  const amostra = await db
    .select({
      data: transactions.date,
      descricao: sql<string>`COALESCE(NULLIF(${transactions.cleanedDescription}, ''), ${transactions.description})`,
      valor: transactions.amount,
      sentido: transactions.direction,
    })
    .from(transactions)
    .where(and(...cond))
    .orderBy(sql`${transactions.date} DESC`)
    .limit(5)

  const quantidade = Number(agregado?.quantidade ?? 0)
  return {
    quantidade,
    valorTotal: Number(agregado?.valorTotal ?? 0),
    rateadosExcluidos,
    regrasAfetadas: Number(agregado?.regras ?? 0),
    amostra: amostra.map(a => ({
      data: a.data, descricao: a.descricao, valor: Number(a.valor), sentido: a.sentido,
    })),
    excedeTeto: quantidade > TETO_CLASSIFICACAO,
  }
}

export interface ResultadoClassificacao {
  atualizados: number
  regrasAfetadas: number
  rateadosExcluidos: number
}

/**
 * Aplica a classificação ao conjunto que o filtro descreve AGORA.
 *
 * Recalcula do zero em vez de reusar a lista da prévia: se algo mudou no
 * intervalo entre prever e aplicar, o certo é o chamador ser recusado (a
 * comparação com o resumo gravado acontece em quem chama) e não aplicar sobre
 * uma fotografia velha.
 */
export async function classificarPorFiltro(
  organizationId: string,
  filtro: FiltroLancamentos,
  data: DimensionData,
  opcoes: { criarRegras?: boolean } = {},
): Promise<ResultadoClassificacao> {
  const base = condicoes(organizationId, filtro)
  const cond = mexeEmDimensaoRateavel(data) ? [...base, semRateio] : base

  const alvos = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      cleanedDescription: transactions.cleanedDescription,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(and(...cond))
    .limit(TETO_CLASSIFICACAO)

  if (alvos.length === 0) return { atualizados: 0, regrasAfetadas: 0, rateadosExcluidos: 0 }

  await db
    .update(transactions)
    .set(montarUpdates(data))
    .where(and(
      eq(transactions.organizationId, organizationId),
      inArray(transactions.id, alvos.map(a => a.id)),
    ))

  const regrasAfetadas = opcoes.criarRegras === false
    ? 0
    : await ensinarRegras(organizationId, alvos, data)

  return { atualizados: alvos.length, regrasAfetadas, rateadosExcluidos: 0 }
}

/** O caminho da tela: ids explícitos, escolhidos a dedo no diálogo. */
export async function classificarPorIds(
  organizationId: string,
  ids: string[],
  data: DimensionData,
): Promise<number> {
  const linhas = await db
    .select({
      description: transactions.description,
      cleanedDescription: transactions.cleanedDescription,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(and(eq(transactions.organizationId, organizationId), inArray(transactions.id, ids)))

  await db
    .update(transactions)
    .set(montarUpdates(data))
    .where(and(eq(transactions.organizationId, organizationId), inArray(transactions.id, ids)))

  await ensinarRegras(organizationId, linhas, data)
  return linhas.length
}
