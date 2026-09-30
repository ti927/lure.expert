// A escrita do rateio, fora de `'use server'`.
//
// Movido de `src/server/allocations.ts` — mesma razão de `transactions-write`:
// o servidor MCP não pode importar de `src/server/**`, e duas cópias da regra do
// rateio é como a tela e o MCP passam a repartir centavo de jeitos diferentes.
//
// O que ficou na server action: a sessão, o `revalidatePath` e o formato de
// retorno que os diálogos esperam.

import { z } from 'zod'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  transactions, transactionAllocations, allocationTemplates, documents,
  costCenters, businessUnits, legalEntities, contacts,
} from '@/db/schema'
import { toCents, applyProportion } from '@/lib/allocation-math'
import { BP_TYPES } from '@/lib/bp-types'

export const MAX_PARTES = 50
export const MAX_LOTE   = 200

const uuidOrNull = z.string().uuid().nullable()

export const parteSchema = z.object({
  /** Em reais, com 2 casas — convertido para centavos antes de qualquer conta. */
  amount:         z.number().positive('Cada parte precisa de valor maior que zero'),
  /**
   * A natureza da parte (0033). AUSENTE = herdar a natureza padrão do
   * lançamento (ver `naturezaPadrao`) — é o que mantém funcionando quem só
   * divide centro de custo e ainda não manda natureza. `null` = sem natureza.
   */
  categoryId:     uuidOrNull.optional(),
  costCenterId:   uuidOrNull,
  businessUnitId: uuidOrNull,
  legalEntityId:  uuidOrNull,
  contactId:      uuidOrNull,
  notes:          z.string().max(500).nullable().optional(),
})
export type AllocationPart = z.infer<typeof parteSchema>

export interface AllocationRow extends Omit<AllocationPart, 'categoryId'> {
  id:       string
  sequence: number
  categoryId: string | null
  allocationTemplateId: string | null
}

export const pesoSchema = z.object({
  weight:         z.number().positive('O peso precisa ser maior que zero'),
  /** Ausente = cada lançamento do lote herda a própria natureza padrão. */
  categoryId:     uuidOrNull.optional(),
  costCenterId:   uuidOrNull,
  businessUnitId: uuidOrNull,
  legalEntityId:  uuidOrNull,
  contactId:      uuidOrNull,
})
export type AllocationWeight = z.infer<typeof pesoSchema>

export async function listarAllocations(
  organizationId: string,
  transactionId: string,
): Promise<AllocationRow[]> {
  const rows = await db
    .select({
      id:             transactionAllocations.id,
      sequence:       transactionAllocations.sequence,
      amount:         transactionAllocations.amount,
      categoryId:     transactionAllocations.categoryId,
      costCenterId:   transactionAllocations.costCenterId,
      businessUnitId: transactionAllocations.businessUnitId,
      legalEntityId:  transactionAllocations.legalEntityId,
      contactId:      transactionAllocations.contactId,
      allocationTemplateId: transactionAllocations.allocationTemplateId,
      notes:          transactionAllocations.notes,
    })
    .from(transactionAllocations)
    .where(and(
      eq(transactionAllocations.organizationId, organizationId),
      eq(transactionAllocations.transactionId, transactionId),
    ))
    .orderBy(asc(transactionAllocations.sequence))

  return rows.map(r => ({ ...r, amount: Number(r.amount) }))
}

/**
 * Toda dimensão citada tem de pertencer à organização.
 *
 * As quatro consultas são escritas por extenso: as tabelas do Drizzle têm tipos
 * distintos e passá-las por uma variável comum só se resolve com cast, que é
 * mentir para o compilador no exato lugar onde ele estaria protegendo o
 * isolamento entre organizações.
 */
export async function validarDimensoes(
  organizationId: string,
  partes: { costCenterId?: string | null; businessUnitId?: string | null;
            legalEntityId?: string | null; contactId?: string | null }[],
): Promise<string | null> {
  const unicos = (f: (p: (typeof partes)[number]) => string | null | undefined) =>
    Array.from(new Set(partes.map(f).filter((v): v is string => !!v)))

  const ccIds = unicos(p => p.costCenterId)
  if (ccIds.length > 0) {
    const achados = await db.select({ id: costCenters.id }).from(costCenters)
      .where(and(eq(costCenters.organizationId, organizationId), inArray(costCenters.id, ccIds)))
    if (achados.length !== ccIds.length) return 'Centro de custo não pertence à sua organização.'
  }

  const buIds = unicos(p => p.businessUnitId)
  if (buIds.length > 0) {
    const achados = await db.select({ id: businessUnits.id }).from(businessUnits)
      .where(and(eq(businessUnits.organizationId, organizationId), inArray(businessUnits.id, buIds)))
    if (achados.length !== buIds.length) return 'Unidade de negócio não pertence à sua organização.'
  }

  const leIds = unicos(p => p.legalEntityId)
  if (leIds.length > 0) {
    const achados = await db.select({ id: legalEntities.id }).from(legalEntities)
      .where(and(eq(legalEntities.organizationId, organizationId), inArray(legalEntities.id, leIds)))
    if (achados.length !== leIds.length) return 'Entidade jurídica não pertence à sua organização.'
  }

  const ctIds = unicos(p => p.contactId)
  if (ctIds.length > 0) {
    const achados = await db.select({ id: contacts.id }).from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), inArray(contacts.id, ctIds)))
    if (achados.length !== ctIds.length) return 'Contato não pertence à sua organização.'
  }

  return null
}

/**
 * A natureza de uma parte segue a regra da natureza de um lançamento: da
 * organização, Natureza Filho, ativa, e do mesmo domínio do documento — balanço
 * só recebe natureza de Balanço; o resto, só de DRE. É a regra de
 * `domainFromReportType` do categorizador, escrita aqui por extenso para não
 * trazer o categorizador (e o cliente da Anthropic) para o caminho do rateio.
 */
export async function validarNaturezas(
  organizationId: string,
  documentId: string | null,
  ids: (string | null | undefined)[],
): Promise<string | null> {
  const unicos = Array.from(new Set(ids.filter((v): v is string => !!v)))
  if (unicos.length === 0) return null

  // Alias explícitos (`c`, `f`) — sem `${tabela.coluna}` dentro do EXISTS
  // (Decisão 18).
  const rows = await db.execute<{ id: string; name: string; type: string; is_active: boolean; tem_filho: boolean }>(sql`
    SELECT c.id::text AS id, c.name, c.type, c.is_active,
           EXISTS (SELECT 1 FROM categories f WHERE f.parent_id = c.id) AS tem_filho
      FROM categories c
     WHERE c.organization_id = ${organizationId}::uuid
       AND c.id IN (${sql.join(unicos.map(id => sql`${id}::uuid`), sql`, `)})
  `)
  if (rows.length !== unicos.length) return 'Natureza não pertence à sua organização.'

  const pai = rows.find(r => r.tem_filho)
  if (pai) return `"${pai.name}" é Natureza Pai — escolha uma Natureza Filho para a parte.`
  const inativa = rows.find(r => !r.is_active)
  if (inativa) return `A natureza "${inativa.name}" está arquivada.`

  let reportType: string | null = null
  if (documentId) {
    const [doc] = await db
      .select({ r: documents.reportType })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
      .limit(1)
    reportType = doc?.r ?? null
  }
  const ehBalanco = reportType === 'balance_sheet'
  const errada = rows.find(r => (BP_TYPES as readonly string[]).includes(r.type) !== ehBalanco)
  if (errada) {
    return ehBalanco
      ? `"${errada.name}" não é natureza de Balanço, e este lançamento veio de um balanço.`
      : `"${errada.name}" é natureza de Balanço e não pode receber lançamento de movimento.`
  }
  return null
}

/**
 * A natureza que uma parte recebe quando o chamador não diz qual: a do
 * lançamento; se ele já é rateado (e por isso não tem), a única comum às partes
 * atuais. É o que preserva o comportamento de quem só divide centro de custo —
 * inclusive a tela e o MCP enquanto não mandam natureza.
 */
export async function naturezaPadrao(
  organizationId: string,
  transactionId: string,
  categoriaDoLancamento: string | null,
): Promise<{ id: string | null; divergente: boolean }> {
  if (categoriaDoLancamento) return { id: categoriaDoLancamento, divergente: false }
  const rows = await db
    .selectDistinct({ c: transactionAllocations.categoryId })
    .from(transactionAllocations)
    .where(and(
      eq(transactionAllocations.organizationId, organizationId),
      eq(transactionAllocations.transactionId, transactionId),
    ))
  // Partes em naturezas DIFERENTES não têm "a natureza do lançamento" para
  // herdar. Quem chama precisa recusar em vez de gravar sem natureza — senão um
  // rateio só de centro de custo tiraria o valor da DRE em silêncio.
  if (rows.length > 1) return { id: null, divergente: true }
  return { id: rows[0]?.c ?? null, divergente: false }
}

const MSG_DIVERGENTE =
  'as partes atuais têm naturezas diferentes, então não há uma natureza do lançamento para manter. ' +
  'Informe a natureza de cada parte.'

/**
 * Substitui o rateio de um lançamento pelas partes informadas.
 *
 * Lista vazia remove o rateio. A soma é conferida aqui em centavos para dar
 * mensagem boa, e conferida de novo pelo banco no commit (migration 0026) — a do
 * banco é a que vale, esta é cortesia.
 */
export async function gravarAllocations(
  organizationId: string,
  transactionId: string,
  partesPedidas: AllocationPart[],
  templateId?: string | null,
): Promise<{ error: string } | { success: true; partes: number }> {
  const parsed = z.array(parteSchema).max(MAX_PARTES, `Máximo de ${MAX_PARTES} partes.`).safeParse(partesPedidas)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const [tx] = await db
    .select({
      id: transactions.id, amount: transactions.amount,
      categoryId: transactions.categoryId, documentId: transactions.documentId,
    })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.organizationId, organizationId)))
    .limit(1)
  if (!tx) return { error: 'Lançamento não encontrado.' }

  // Parte sem `categoryId` herda a natureza padrão; `null` explícito fica sem.
  const padrao = await naturezaPadrao(organizationId, transactionId, tx.categoryId)
  if (padrao.divergente && parsed.data.some(p => p.categoryId === undefined)) {
    return { error: `Este lançamento está rateado em naturezas diferentes: ${MSG_DIVERGENTE}` }
  }
  const partes = parsed.data.map(p => ({
    ...p,
    categoryId: p.categoryId === undefined ? padrao.id : p.categoryId,
  }))

  if (partes.length > 0) {
    const totalCents = toCents(tx.amount)
    const somaCents  = partes.reduce((a, p) => a + toCents(p.amount), 0)
    if (somaCents !== totalCents) {
      const falta = (totalCents - somaCents) / 100
      return {
        error: falta > 0
          ? `Faltam R$ ${falta.toFixed(2).replace('.', ',')} para fechar o lançamento.`
          : `As partes passam R$ ${Math.abs(falta).toFixed(2).replace('.', ',')} do lançamento.`,
      }
    }
    const dimErro = await validarDimensoes(organizationId, partes)
    if (dimErro) return { error: dimErro }
    // Só a natureza que o chamador ESCOLHEU é validada. A herdada já está no
    // lançamento — e classificar nunca exigiu natureza ativa nem de domínio
    // certo; revalidá-la faria um rateio só de centro de custo, que funcionava,
    // passar a falhar num lançamento de natureza arquivada (revisão final).
    const natErro = await validarNaturezas(organizationId, tx.documentId, parsed.data.map(p => p.categoryId))
    if (natErro) return { error: natErro }
  }

  // O carimbo é conferido, não confiado: um id de outra organização derrubaria
  // a gravação inteira pela FK. Como o carimbo é etiqueta e o rateio é o que o
  // usuário pediu, um id inválido vira null e o rateio segue.
  let templateValido: string | null = null
  if (templateId && partes.length > 0) {
    const [tpl] = await db
      .select({ id: allocationTemplates.id })
      .from(allocationTemplates)
      .where(and(
        eq(allocationTemplates.id, templateId),
        eq(allocationTemplates.organizationId, organizationId),
      ))
      .limit(1)
    templateValido = tpl?.id ?? null
  }

  // Catch loud: sem isto, uma recusa do gatilho do banco sobe como exceção crua.
  // A mensagem do RAISE é escrita para ser lida por gente, então vale repassá-la.
  try {
    await db.transaction(async (t) => {
      // As naturezas de hoje, lidas antes de apagar: se o pedido for REMOVER o
      // rateio, é daqui que a natureza volta para o lançamento.
      const naturezasAtuais = await t
        .selectDistinct({ c: transactionAllocations.categoryId })
        .from(transactionAllocations)
        .where(and(
          eq(transactionAllocations.organizationId, organizationId),
          eq(transactionAllocations.transactionId, transactionId),
        ))

      await t.delete(transactionAllocations)
        .where(and(
          eq(transactionAllocations.organizationId, organizationId),
          eq(transactionAllocations.transactionId, transactionId),
        ))

      if (partes.length === 0) {
        // Remover o rateio devolve a natureza ao lançamento quando as partes
        // concordavam; se divergiam, ele fica sem e volta a pedir classificação
        // — lacuna visível, nunca uma escolha feita por nós.
        const unica = naturezasAtuais.length === 1 ? naturezasAtuais[0].c : null
        if (unica && !tx.categoryId) {
          await t.update(transactions)
            .set({ categoryId: unica, updatedAt: new Date() })
            .where(and(eq(transactions.id, transactionId), eq(transactions.organizationId, organizationId)))
        }
      }

      if (partes.length > 0) {
        // Com rateio, a classificação vive nas partes: a natureza e as
        // dimensões do lançamento ficam vazias, e o gatilho do banco recusa o
        // contrário (0026 e 0033).
        await t.update(transactions)
          .set({
            categoryId: null,
            costCenterId: null, businessUnitId: null,
            legalEntityId: null, contactId: null,
            // Ratear é classificar à mão: o lançamento sai da fila de revisão.
            needsReview: false,
            updatedAt: new Date(),
          })
          .where(and(eq(transactions.id, transactionId), eq(transactions.organizationId, organizationId)))

        await t.insert(transactionAllocations).values(partes.map((p, i) => ({
          organizationId,
          transactionId,
          sequence:       i + 1,
          amount:         p.amount.toFixed(2),
          categoryId:     p.categoryId ?? null,
          costCenterId:   p.costCenterId,
          businessUnitId: p.businessUnitId,
          legalEntityId:  p.legalEntityId,
          contactId:      p.contactId,
          allocationTemplateId: templateValido,
          notes:          p.notes ?? null,
        })))
      }
    })
  } catch (e) {
    const pg = e as { message?: string; cause?: { message?: string } }
    const bruta = pg?.cause?.message ?? pg?.message ?? 'erro desconhecido'
    console.error('[allocations] falha ao gravar rateio', { transactionId, partes: parsed.data.length, erro: bruta })
    return { error: `Não foi possível gravar o rateio: ${bruta}` }
  }

  return { success: true, partes: parsed.data.length }
}

export interface BatchPreviewRow {
  transactionId: string
  date:          string
  description:   string
  amount:        number
  /** Valores em reais, na mesma ordem dos pesos — já fechados no centavo. */
  parts:         number[]
  /** Já tem rateio hoje e será substituído. */
  jaRateado:     boolean
}

/**
 * O que o lote criaria, sem gravar.
 *
 * A proporção vira valores por lançamento pelo método do maior resto
 * (`applyProportion`), então cada lançamento fecha no centavo — e a prévia
 * mostra onde a sobra caiu, em vez de o sistema decidir por baixo do pano.
 */
export async function preverLoteDeRateio(
  organizationId: string,
  ids: string[],
  pesos: AllocationWeight[],
): Promise<{ error: string } | { rows: BatchPreviewRow[]; jaRateados: number }> {
  if (ids.length === 0) return { error: 'Nenhum lançamento selecionado.' }
  if (ids.length > MAX_LOTE) return { error: `Máximo de ${MAX_LOTE} lançamentos por vez.` }

  const parsedPesos = z.array(pesoSchema).min(1).max(MAX_PARTES).safeParse(pesos)
  if (!parsedPesos.success) return { error: parsedPesos.error.issues[0].message }

  const dimErro = await validarDimensoes(organizationId, parsedPesos.data)
  if (dimErro) return { error: dimErro }

  // Natureza fixada no peso vale para todos os lançamentos do lote — então é
  // conferida contra CADA domínio presente (um lote pode misturar movimento e
  // balanço). Aqui, e não só em `gravarAllocations`, para o lote não parar no
  // meio com metade aplicada.
  if (parsedPesos.data.some(p => p.categoryId)) {
    const docs = await db
      .selectDistinct({ d: transactions.documentId })
      .from(transactions)
      .where(and(eq(transactions.organizationId, organizationId), inArray(transactions.id, ids)))
    for (const { d } of docs) {
      const natErro = await validarNaturezas(organizationId, d, parsedPesos.data.map(p => p.categoryId))
      if (natErro) return { error: natErro }
    }
  }

  const txs = await db
    .select({
      id: transactions.id, date: transactions.date,
      description: transactions.description, amount: transactions.amount,
      // `${transactions}.id` e NÃO `${transactions.id}`. O Drizzle só qualifica a
      // coluna quando a consulta tem join; sem join ele emite `"id"` puro, e
      // dentro da subconsulta o escopo interno vence — `a.transaction_id = a.id`,
      // que nunca é verdade. Era o defeito que fazia este aviso viver zerado.
      jaRateado: sql<boolean>`EXISTS (
        SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = ${transactions}.id
      )`,
    })
    .from(transactions)
    .where(and(eq(transactions.organizationId, organizationId), inArray(transactions.id, ids)))
    .orderBy(asc(transactions.date))

  // Peso sem natureza = "manter a do lançamento". Num já rateado em naturezas
  // diferentes isso não existe — a mesma recusa de `gravarAllocations`, aqui na
  // PRÉVIA, para o lote não parar com metade aplicada. Parte sem natureza conta
  // como uma natureza a mais, igual ao `selectDistinct` de `naturezaPadrao`.
  if (parsedPesos.data.some(p => p.categoryId === undefined)) {
    const [div] = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM transactions t
       WHERE t.organization_id = ${organizationId}::uuid
         AND t.id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})
         AND t.category_id IS NULL
         AND (SELECT COUNT(DISTINCT COALESCE(a.category_id::text, '-'))
                FROM transaction_allocations a WHERE a.transaction_id = t.id) > 1
    `)
    const n = Number(div?.n ?? 0)
    if (n > 0) {
      return {
        error: `${n} dos lançamentos ${n === 1 ? 'está rateado' : 'estão rateados'} em naturezas diferentes: ` +
          MSG_DIVERGENTE.replace('Informe a natureza de cada parte.',
            'Informe a natureza em cada peso, ou tire esses lançamentos do lote.'),
      }
    }
  }

  const weights = parsedPesos.data.map(p => p.weight)
  const rows: BatchPreviewRow[] = txs.map(t => ({
    transactionId: t.id,
    date:          t.date,
    description:   t.description,
    amount:        Number(t.amount),
    parts:         applyProportion(toCents(t.amount), weights).map(c => c / 100),
    jaRateado:     t.jaRateado === true,
  }))

  return { rows, jaRateados: rows.filter(r => r.jaRateado).length }
}

/** Aplica o lote. Recalcula do zero em vez de confiar na prévia que veio do cliente. */
export async function aplicarLoteDeRateio(
  organizationId: string,
  ids: string[],
  pesos: AllocationWeight[],
  templateId?: string | null,
): Promise<{ error: string } | { success: true; aplicados: number }> {
  const preview = await preverLoteDeRateio(organizationId, ids, pesos)
  if ('error' in preview) return preview

  let aplicados = 0
  for (const row of preview.rows) {
    const partes: AllocationPart[] = row.parts.map((valor, i) => ({
      amount:         valor,
      // Ausente no peso = cada lançamento herda a própria natureza padrão.
      categoryId:     pesos[i].categoryId,
      costCenterId:   pesos[i].costCenterId,
      businessUnitId: pesos[i].businessUnitId,
      legalEntityId:  pesos[i].legalEntityId,
      contactId:      pesos[i].contactId,
      notes:          null,
    })).filter(p => p.amount > 0)   // peso minúsculo sobre valor pequeno pode zerar

    if (partes.length === 0) continue
    const r = await gravarAllocations(organizationId, row.transactionId, partes, templateId)
    if ('error' in r) return { error: `"${row.description}": ${r.error}` }
    aplicados++
  }

  return { success: true, aplicados }
}
