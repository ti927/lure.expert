'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/db'
import { transactions, transactionAllocations, costCenters, businessUnits, legalEntities, contacts } from '@/db/schema'
import { eq, and, inArray, asc, sql } from 'drizzle-orm'
import { getAuthContext } from '@/lib/auth-context'
import { toCents, applyProportion } from '@/lib/allocation-math'

const MAX_PARTES = 50
const MAX_LOTE   = 200

const uuidOrNull = z.string().uuid().nullable()

const parteSchema = z.object({
  /** Em reais, com 2 casas — convertido para centavos antes de qualquer conta. */
  amount:         z.number().positive('Cada parte precisa de valor maior que zero'),
  costCenterId:   uuidOrNull,
  businessUnitId: uuidOrNull,
  legalEntityId:  uuidOrNull,
  contactId:      uuidOrNull,
  notes:          z.string().max(500).nullable().optional(),
})
export type AllocationPart = z.infer<typeof parteSchema>

export interface AllocationRow extends AllocationPart {
  id:       string
  sequence: number
}

/** As partes de um lançamento, em ordem. Vazio = lançamento sem rateio. */
export async function getAllocations(transactionId: string): Promise<AllocationRow[]> {
  const { organizationId } = await getAuthContext()
  const rows = await db
    .select({
      id:             transactionAllocations.id,
      sequence:       transactionAllocations.sequence,
      amount:         transactionAllocations.amount,
      costCenterId:   transactionAllocations.costCenterId,
      businessUnitId: transactionAllocations.businessUnitId,
      legalEntityId:  transactionAllocations.legalEntityId,
      contactId:      transactionAllocations.contactId,
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
async function validarDimensoes(organizationId: string, partes: AllocationPart[]): Promise<string | null> {
  const unicos = (f: (p: AllocationPart) => string | null | undefined) =>
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
 * Substitui o rateio de um lançamento pelas partes informadas.
 *
 * Lista vazia remove o rateio e devolve o lançamento ao estado simples. A soma
 * é conferida aqui em centavos para dar mensagem boa, e conferida de novo pelo
 * banco no commit (migration 0026) — a do banco é a que vale, esta é cortesia.
 */
export async function saveAllocations(transactionId: string, partes: AllocationPart[]) {
  const { organizationId } = await getAuthContext()

  const parsed = z.array(parteSchema).max(MAX_PARTES, `Máximo de ${MAX_PARTES} partes.`).safeParse(partes)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const [tx] = await db
    .select({ id: transactions.id, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.organizationId, organizationId)))
    .limit(1)
  if (!tx) return { error: 'Lançamento não encontrado.' }

  if (parsed.data.length > 0) {
    const totalCents = toCents(tx.amount)
    const somaCents  = parsed.data.reduce((a, p) => a + toCents(p.amount), 0)
    if (somaCents !== totalCents) {
      const falta = (totalCents - somaCents) / 100
      return {
        error: falta > 0
          ? `Faltam R$ ${falta.toFixed(2).replace('.', ',')} para fechar o lançamento.`
          : `As partes passam R$ ${Math.abs(falta).toFixed(2).replace('.', ',')} do lançamento.`,
      }
    }
    const dimErro = await validarDimensoes(organizationId, parsed.data)
    if (dimErro) return { error: dimErro }
  }

  await db.transaction(async (t) => {
    await t.delete(transactionAllocations)
      .where(and(
        eq(transactionAllocations.organizationId, organizationId),
        eq(transactionAllocations.transactionId, transactionId),
      ))

    if (parsed.data.length > 0) {
      // Com rateio, a classificação vive nas partes: as colunas do lançamento
      // ficam vazias, e o gatilho do banco recusa o contrário.
      await t.update(transactions)
        .set({
          costCenterId: null, businessUnitId: null,
          legalEntityId: null, contactId: null,
          updatedAt: new Date(),
        })
        .where(and(eq(transactions.id, transactionId), eq(transactions.organizationId, organizationId)))

      await t.insert(transactionAllocations).values(parsed.data.map((p, i) => ({
        organizationId,
        transactionId,
        sequence:       i + 1,
        amount:         p.amount.toFixed(2),
        costCenterId:   p.costCenterId,
        businessUnitId: p.businessUnitId,
        legalEntityId:  p.legalEntityId,
        contactId:      p.contactId,
        notes:          p.notes ?? null,
      })))
    }
  })

  revalidatePath('/transacoes')
  revalidatePath('/dre')
  revalidatePath('/fluxo')
  return { success: true, partes: parsed.data.length }
}

export async function removeAllocations(transactionId: string) {
  return saveAllocations(transactionId, [])
}

// ─── Rateio em lote ───────────────────────────────────────────────────────────

const pesoSchema = z.object({
  weight:         z.number().positive('O percentual precisa ser maior que zero'),
  costCenterId:   uuidOrNull,
  businessUnitId: uuidOrNull,
  legalEntityId:  uuidOrNull,
  contactId:      uuidOrNull,
})
export type AllocationWeight = z.infer<typeof pesoSchema>

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
 * A proporção é convertida em valores por lançamento com o método do maior
 * resto (`applyProportion`), então cada lançamento fecha no centavo — e a
 * prévia mostra exatamente onde a sobra caiu, em vez de o sistema decidir por
 * baixo do pano.
 */
export async function previewBatchAllocation(ids: string[], pesos: AllocationWeight[]) {
  const { organizationId } = await getAuthContext()
  if (ids.length === 0) return { error: 'Nenhum lançamento selecionado.' }
  if (ids.length > MAX_LOTE) return { error: `Máximo de ${MAX_LOTE} lançamentos por vez.` }

  const parsedPesos = z.array(pesoSchema).min(1).max(MAX_PARTES).safeParse(pesos)
  if (!parsedPesos.success) return { error: parsedPesos.error.issues[0].message }

  const dimErro = await validarDimensoes(organizationId, parsedPesos.data.map(p => ({
    amount: 1, costCenterId: p.costCenterId, businessUnitId: p.businessUnitId,
    legalEntityId: p.legalEntityId, contactId: p.contactId,
  })))
  if (dimErro) return { error: dimErro }

  const txs = await db
    .select({
      id: transactions.id, date: transactions.date,
      description: transactions.description, amount: transactions.amount,
      jaRateado: sql<boolean>`EXISTS (
        SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = ${transactions.id}
      )`,
    })
    .from(transactions)
    .where(and(eq(transactions.organizationId, organizationId), inArray(transactions.id, ids)))
    .orderBy(asc(transactions.date))

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
export async function applyBatchAllocation(ids: string[], pesos: AllocationWeight[]) {
  const preview = await previewBatchAllocation(ids, pesos)
  if ('error' in preview) return preview

  let aplicados = 0
  for (const row of preview.rows) {
    const partes: AllocationPart[] = row.parts.map((valor, i) => ({
      amount:         valor,
      costCenterId:   pesos[i].costCenterId,
      businessUnitId: pesos[i].businessUnitId,
      legalEntityId:  pesos[i].legalEntityId,
      contactId:      pesos[i].contactId,
      notes:          null,
    })).filter(p => p.amount > 0)   // peso minúsculo sobre valor pequeno pode zerar

    if (partes.length === 0) continue
    const r = await saveAllocations(row.transactionId, partes)
    if ('error' in r) return { error: `"${row.description}": ${r.error}` }
    aplicados++
  }

  return { success: true, aplicados }
}
