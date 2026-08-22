'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/db'
import {
  allocationTemplates, allocationTemplateLines, transactionAllocations,
  costCenters, businessUnits, legalEntities, contacts,
} from '@/db/schema'
import { eq, and, inArray, asc, sql } from 'drizzle-orm'
import { getAuthContext } from '@/lib/auth-context'

const MAX_LINHAS = 50

const uuidOrNull = z.string().uuid().nullable()

const linhaSchema = z.object({
  /** Peso relativo. Não precisa somar 100 — só a razão entre eles importa. */
  weight:         z.number().positive('O peso precisa ser maior que zero'),
  costCenterId:   uuidOrNull,
  businessUnitId: uuidOrNull,
  legalEntityId:  uuidOrNull,
  contactId:      uuidOrNull,
})
export type TemplateLineInput = z.infer<typeof linhaSchema>

const modeloSchema = z.object({
  id:          z.string().uuid().nullable().optional(),
  name:        z.string().trim().min(1, 'Dê um nome ao modelo').max(80, 'Nome muito longo'),
  description: z.string().trim().max(300).nullable().optional(),
  lines:       z.array(linhaSchema)
    .min(2, 'Um modelo de rateio precisa de ao menos 2 partes')
    .max(MAX_LINHAS, `Máximo de ${MAX_LINHAS} partes.`),
})
export type TemplateInput = z.infer<typeof modeloSchema>

export interface TemplateLineRow extends TemplateLineInput {
  id:       string
  sequence: number
}

export interface TemplateRow {
  id:          string
  name:        string
  description: string | null
  isActive:    boolean
  lines:       TemplateLineRow[]
  /** Lançamentos (não partes) rateados por este modelo sem edição posterior. */
  usageCount:  number
}

/**
 * Todos os modelos da organização, com as linhas e a contagem de uso.
 *
 * Duas consultas, não N+1: as linhas de todos os modelos vêm de uma vez e são
 * agrupadas em memória. Um cliente com 20 modelos de 5 partes são 100 linhas —
 * não vale paginar.
 */
export async function listAllocationTemplates(incluirArquivados = false): Promise<TemplateRow[]> {
  const { organizationId } = await getAuthContext()

  const cabecalhos = await db
    .select({
      id:          allocationTemplates.id,
      name:        allocationTemplates.name,
      description: allocationTemplates.description,
      isActive:    allocationTemplates.isActive,
      // COUNT(DISTINCT transaction_id): o número promete LANÇAMENTOS. Contar
      // partes diria 2 para um único lançamento dividido em dois, e a tela
      // existe justamente para decidir se dá para apagar o modelo.
      usageCount: sql<number>`(
        SELECT COUNT(DISTINCT a.transaction_id)::int
        FROM transaction_allocations a
        WHERE a.allocation_template_id = ${allocationTemplates.id}
      )`,
    })
    .from(allocationTemplates)
    .where(
      incluirArquivados
        ? eq(allocationTemplates.organizationId, organizationId)
        : and(eq(allocationTemplates.organizationId, organizationId), eq(allocationTemplates.isActive, true))
    )
    .orderBy(asc(allocationTemplates.name))

  if (cabecalhos.length === 0) return []

  const linhas = await db
    .select({
      id:             allocationTemplateLines.id,
      templateId:     allocationTemplateLines.templateId,
      sequence:       allocationTemplateLines.sequence,
      weight:         allocationTemplateLines.weight,
      costCenterId:   allocationTemplateLines.costCenterId,
      businessUnitId: allocationTemplateLines.businessUnitId,
      legalEntityId:  allocationTemplateLines.legalEntityId,
      contactId:      allocationTemplateLines.contactId,
    })
    .from(allocationTemplateLines)
    .where(and(
      eq(allocationTemplateLines.organizationId, organizationId),
      inArray(allocationTemplateLines.templateId, cabecalhos.map(c => c.id)),
    ))
    .orderBy(asc(allocationTemplateLines.sequence))

  const porModelo = new Map<string, TemplateLineRow[]>()
  for (const l of linhas) {
    const lista = porModelo.get(l.templateId) ?? []
    lista.push({
      id: l.id, sequence: l.sequence, weight: Number(l.weight),
      costCenterId: l.costCenterId, businessUnitId: l.businessUnitId,
      legalEntityId: l.legalEntityId, contactId: l.contactId,
    })
    porModelo.set(l.templateId, lista)
  }

  return cabecalhos.map(c => ({ ...c, lines: porModelo.get(c.id) ?? [] }))
}

/**
 * Toda dimensão citada tem de pertencer à organização.
 *
 * As quatro consultas são escritas por extenso pelo mesmo motivo de
 * `allocations.ts`: unificar as tabelas do Drizzle numa variável só sai com
 * cast, que é mentir para o compilador exatamente onde ele protege o
 * isolamento entre organizações.
 */
async function validarDimensoes(organizationId: string, linhas: TemplateLineInput[]): Promise<string | null> {
  const unicos = (f: (l: TemplateLineInput) => string | null | undefined) =>
    Array.from(new Set(linhas.map(f).filter((v): v is string => !!v)))

  const ccIds = unicos(l => l.costCenterId)
  if (ccIds.length > 0) {
    const achados = await db.select({ id: costCenters.id }).from(costCenters)
      .where(and(eq(costCenters.organizationId, organizationId), inArray(costCenters.id, ccIds)))
    if (achados.length !== ccIds.length) return 'Centro de custo não pertence à sua organização.'
  }

  const buIds = unicos(l => l.businessUnitId)
  if (buIds.length > 0) {
    const achados = await db.select({ id: businessUnits.id }).from(businessUnits)
      .where(and(eq(businessUnits.organizationId, organizationId), inArray(businessUnits.id, buIds)))
    if (achados.length !== buIds.length) return 'Unidade de negócio não pertence à sua organização.'
  }

  const leIds = unicos(l => l.legalEntityId)
  if (leIds.length > 0) {
    const achados = await db.select({ id: legalEntities.id }).from(legalEntities)
      .where(and(eq(legalEntities.organizationId, organizationId), inArray(legalEntities.id, leIds)))
    if (achados.length !== leIds.length) return 'Entidade jurídica não pertence à sua organização.'
  }

  const ctIds = unicos(l => l.contactId)
  if (ctIds.length > 0) {
    const achados = await db.select({ id: contacts.id }).from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), inArray(contacts.id, ctIds)))
    if (achados.length !== ctIds.length) return 'Contato não pertence à sua organização.'
  }

  return null
}

/**
 * Cria ou substitui um modelo. Com `id`, atualiza; sem, cria.
 *
 * As linhas são regravadas do zero em vez de comparadas uma a uma: são poucas,
 * a ordem importa, e diff de conjunto pequeno só rende bug. O carimbo nos
 * rateios já feitos aponta para o MODELO, não para as linhas, então nenhum
 * histórico se perde nessa troca.
 */
export async function saveAllocationTemplate(input: TemplateInput) {
  const { organizationId } = await getAuthContext()

  const parsed = modeloSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { id, name, description, lines } = parsed.data

  const dimErro = await validarDimensoes(organizationId, lines)
  if (dimErro) return { error: dimErro }

  try {
    const templateId = await db.transaction(async (t) => {
      let alvo = id ?? null

      if (alvo) {
        const atualizados = await t.update(allocationTemplates)
          .set({ name, description: description ?? null, updatedAt: new Date() })
          .where(and(eq(allocationTemplates.id, alvo), eq(allocationTemplates.organizationId, organizationId)))
          .returning({ id: allocationTemplates.id })
        if (atualizados.length === 0) throw new Error('Modelo não encontrado.')
        await t.delete(allocationTemplateLines)
          .where(and(
            eq(allocationTemplateLines.templateId, alvo),
            eq(allocationTemplateLines.organizationId, organizationId),
          ))
      } else {
        const [criado] = await t.insert(allocationTemplates)
          .values({ organizationId, name, description: description ?? null })
          .returning({ id: allocationTemplates.id })
        alvo = criado.id
      }

      await t.insert(allocationTemplateLines).values(lines.map((l, i) => ({
        organizationId,
        templateId:     alvo!,
        sequence:       i + 1,
        weight:         l.weight.toFixed(6),
        costCenterId:   l.costCenterId,
        businessUnitId: l.businessUnitId,
        legalEntityId:  l.legalEntityId,
        contactId:      l.contactId,
      })))

      return alvo!
    })

    revalidatePath('/configuracoes/modelos-de-rateio')
    revalidatePath('/transacoes')
    return { success: true, id: templateId }
  } catch (e) {
    const pg = e as { message?: string; cause?: { message?: string } }
    const bruta = pg?.cause?.message ?? pg?.message ?? 'erro desconhecido'
    // O índice único é a única recusa esperada aqui; vale traduzi-la.
    if (bruta.includes('idx_alloc_tpl_org_name')) {
      return { error: `Já existe um modelo chamado "${name}".` }
    }
    console.error('[allocation-templates] falha ao gravar modelo', { id, erro: bruta })
    return { error: `Não foi possível gravar o modelo: ${bruta}` }
  }
}

/**
 * Arquiva ou reativa. Arquivado some do seletor e preserva o carimbo dos
 * rateios já feitos — é o caminho preferível ao delete quando o modelo já rodou.
 */
export async function toggleAllocationTemplateActive(id: string, isActive: boolean) {
  const { organizationId } = await getAuthContext()
  await db.update(allocationTemplates)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(allocationTemplates.id, id), eq(allocationTemplates.organizationId, organizationId)))
  revalidatePath('/configuracoes/modelos-de-rateio')
  return { success: true }
}

/**
 * Apaga o modelo. Os rateios já feitos por ele NÃO são desfeitos — só perdem a
 * etiqueta de origem (`ON DELETE SET NULL` na migration 0027). Apagar um modelo
 * nunca mexe em número de DRE.
 */
export async function deleteAllocationTemplate(id: string) {
  const { organizationId } = await getAuthContext()
  await db.delete(allocationTemplates)
    .where(and(eq(allocationTemplates.id, id), eq(allocationTemplates.organizationId, organizationId)))
  revalidatePath('/configuracoes/modelos-de-rateio')
  revalidatePath('/transacoes')
  return { success: true }
}

/** Quantos lançamentos este modelo rateou — a pergunta antes de apagar. */
export async function getAllocationTemplateUsage(id: string): Promise<number> {
  const { organizationId } = await getAuthContext()
  const [linha] = await db
    .select({ n: sql<number>`COUNT(DISTINCT ${transactionAllocations.transactionId})::int` })
    .from(transactionAllocations)
    .where(and(
      eq(transactionAllocations.organizationId, organizationId),
      eq(transactionAllocations.allocationTemplateId, id),
    ))
  return linha?.n ?? 0
}
