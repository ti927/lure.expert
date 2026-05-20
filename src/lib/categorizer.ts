import { db } from '@/db'
import {
  transactions,
  categorizationRules,
  categories,
  costCenters,
  businessUnits,
  legalEntities,
  agentEvents,
} from '@/db/schema'
import { eq, and, isNotNull, ne, ilike, desc, inArray } from 'drizzle-orm'
import { anthropic } from '@/lib/anthropic'
import { BP_TYPES } from '@/lib/bp-types'

const BP_TYPE_SET = new Set<string>(BP_TYPES)

export type DocumentDomain = 'bp' | 'dre'

function isBpType(type: string): boolean {
  return BP_TYPE_SET.has(type)
}

export function domainFromReportType(reportType: string | null | undefined): DocumentDomain {
  return reportType === 'balance_sheet' ? 'bp' : 'dre'
}

export interface CategorizationResult {
  categoryId: string | null
  costCenterId: string | null
  businessUnitId: string | null
  legalEntityId: string | null
  confidence: number
  method: 'rule' | 'recurrence' | 'embedding' | 'llm'
  needsReview: boolean
}

export interface OrgContext {
  organizationId: string
  rules: Array<{
    id: string
    conditions: Record<string, unknown>
    targetCategoryId: string | null
    targetCostCenterId: string | null
    targetBusinessUnitId: string | null
    targetLegalEntityId: string | null
  }>
  categories: Array<{ id: string; code: string | null; name: string; type: string }>
  costCenters: Array<{ id: string; name: string; code: string | null }>
  businessUnits: Array<{ id: string; name: string; code: string | null }>
  legalEntities: Array<{ id: string; name: string; cnpj: string | null }>
}

export async function loadOrgContext(organizationId: string): Promise<OrgContext> {
  const [rules, allCats, ccs, bus, les] = await Promise.all([
    db.select({
      id: categorizationRules.id,
      conditions: categorizationRules.conditions,
      targetCategoryId: categorizationRules.targetCategoryId,
      targetCostCenterId: categorizationRules.targetCostCenterId,
      targetBusinessUnitId: categorizationRules.targetBusinessUnitId,
      targetLegalEntityId: categorizationRules.targetLegalEntityId,
    })
      .from(categorizationRules)
      .where(and(
        eq(categorizationRules.organizationId, organizationId),
        eq(categorizationRules.isActive, true),
      ))
      .orderBy(desc(categorizationRules.priority)),

    // Carrega TODAS as categorias ativas (DRE + BP, Pai e Filho)
    db.select({
      id: categories.id,
      code: categories.code,
      name: categories.name,
      type: categories.type,
      parentId: categories.parentId,
    })
      .from(categories)
      .where(and(
        eq(categories.organizationId, organizationId),
        eq(categories.isActive, true),
      )),

    db.select({ id: costCenters.id, name: costCenters.name, code: costCenters.code })
      .from(costCenters)
      .where(and(eq(costCenters.organizationId, organizationId), eq(costCenters.isActive, true))),

    db.select({ id: businessUnits.id, name: businessUnits.name, code: businessUnits.code })
      .from(businessUnits)
      .where(and(eq(businessUnits.organizationId, organizationId), eq(businessUnits.isActive, true))),

    db.select({ id: legalEntities.id, name: legalEntities.name, cnpj: legalEntities.cnpj })
      .from(legalEntities)
      .where(and(eq(legalEntities.organizationId, organizationId), eq(legalEntities.isActive, true))),
  ])

  // Nós folha = categorias cujo id não aparece como parentId de nenhuma outra categoria.
  // Isso inclui: todos os Filhos (parentId != null) + Pais sem filhos (caso de uso BP).
  const parentIdSet = new Set(allCats.map(c => c.parentId).filter((p): p is string => p !== null))
  const leafCats = allCats
    .filter(c => !parentIdSet.has(c.id))
    .map(c => ({ id: c.id, code: c.code, name: c.name, type: c.type }))

  return {
    organizationId,
    rules: rules as OrgContext['rules'],
    categories: leafCats,
    costCenters: ccs,
    businessUnits: bus,
    legalEntities: les,
  }
}

// ─── Camada 1: Regras explícitas ─────────────────────────────────────────────

// Regras com targetCategoryId só disparam no mesmo domínio (BP↔BP, DRE↔DRE).
// Regras sem targetCategoryId (só CC/UN/Entidade) são domínio-agnósticas.
function applyRules(
  description: string,
  rules: OrgContext['rules'],
  domainCategoryIds: Set<string>,
): CategorizationResult | null {
  for (const rule of rules) {
    const c = rule.conditions as { field?: string; op?: string; value?: string }
    if (c.field !== 'description' || c.op !== 'contains' || !c.value) continue
    if (!description.toLowerCase().includes(c.value.toLowerCase())) continue

    // Se a regra aponta para uma categoria fora do domínio atual, pula.
    if (rule.targetCategoryId !== null && !domainCategoryIds.has(rule.targetCategoryId)) continue

    return {
      categoryId: rule.targetCategoryId,
      costCenterId: rule.targetCostCenterId,
      businessUnitId: rule.targetBusinessUnitId,
      legalEntityId: rule.targetLegalEntityId,
      confidence: 1.0,
      method: 'rule',
      needsReview: false,
    }
  }
  return null
}

// ─── Camada 2: Recorrência (mesma descrição já classificada no mesmo domínio) ─

async function checkRecurrence(
  organizationId: string,
  transactionId: string,
  description: string,
  validCategoryIds: string[],
): Promise<CategorizationResult | null> {
  // Sem categorias válidas no domínio, recorrência não se aplica.
  if (validCategoryIds.length === 0) return null

  const [prev] = await db
    .select({
      categoryId: transactions.categoryId,
      costCenterId: transactions.costCenterId,
      businessUnitId: transactions.businessUnitId,
      legalEntityId: transactions.legalEntityId,
    })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, organizationId),
      ilike(transactions.description, description),
      inArray(transactions.categoryId, validCategoryIds),
      ne(transactions.id, transactionId),
    ))
    .orderBy(desc(transactions.date))
    .limit(1)

  if (!prev?.categoryId) return null

  return {
    categoryId: prev.categoryId,
    costCenterId: prev.costCenterId ?? null,
    businessUnitId: prev.businessUnitId ?? null,
    legalEntityId: prev.legalEntityId ?? null,
    confidence: 0.93,
    method: 'recurrence',
    needsReview: false,
  }
}

// ─── Camada 3: Embedding similarity (não implementado ainda) ─────────────────

// ─── Camada 4: Claude Haiku ──────────────────────────────────────────────────

function buildSystemPrompt(ctx: OrgContext, domain: DocumentDomain): string {
  const domainNote = domain === 'bp'
    ? 'CONTEXTO: Este lançamento pertence a um relatório de Balanço Patrimonial (BP). Use SOMENTE categorias de BP listadas abaixo (ativo, passivo, patrimônio líquido). Não sugira categorias de DRE.'
    : 'CONTEXTO: Este lançamento pertence a um extrato bancário ou relatório de DRE. Use SOMENTE categorias de DRE listadas abaixo (receitas, custos, despesas, etc.). Não sugira categorias de Balanço Patrimonial.'

  const catList = ctx.categories
    .map(c => `${c.code ?? '—'}: ${c.name} (${c.type})`)
    .join('\n')

  const ccList = ctx.costCenters.length > 0
    ? `\nCentros de custo (id: nome):\n${ctx.costCenters.map(cc => `${cc.id}: ${cc.name}`).join('\n')}`
    : '\nCentros de custo: nenhum cadastrado — retorne null'

  const buList = ctx.businessUnits.length > 0
    ? `\nUnidades de negócio (id: nome):\n${ctx.businessUnits.map(bu => `${bu.id}: ${bu.name}`).join('\n')}`
    : '\nUnidades de negócio: nenhuma cadastrada — retorne null'

  const leList = ctx.legalEntities.length > 0
    ? `\nEntidades jurídicas (id: nome):\n${ctx.legalEntities.map(le => `${le.id}: ${le.name}${le.cnpj ? ` [${le.cnpj}]` : ''}`).join('\n')}`
    : '\nEntidades jurídicas: nenhuma cadastrada — retorne null'

  return `Você é um categorizador de transações financeiras para PMEs brasileiras.
${domainNote}

Categorias disponíveis (código: nome):
${catList}
${ccList}${buList}${leList}

Retorne APENAS este JSON sem nenhum texto adicional:
{
  "category_code": "<código da categoria ou null>",
  "category_confidence": <0-100>,
  "cost_center_id": "<uuid exato ou null>",
  "cost_center_confidence": <0-100>,
  "business_unit_id": "<uuid exato ou null>",
  "business_unit_confidence": <0-100>,
  "legal_entity_id": "<uuid exato ou null>",
  "legal_entity_confidence": <0-100>
}`
}

interface LLMCallResult {
  result: CategorizationResult
  tokensInput: number
  tokensOutput: number
  costUsd: number
}

async function classifyWithLLM(
  description: string,
  amount: string,
  direction: string,
  ctx: OrgContext,
  domain: DocumentDomain,
  pluggyCategory?: string | null,
): Promise<LLMCallResult | null> {
  if (ctx.categories.length === 0) return null

  const systemPrompt = buildSystemPrompt(ctx, domain)
  const categoryHint = pluggyCategory ? `\nCategoria do banco (Pluggy): ${pluggyCategory}` : ''
  const userMessage = `Descrição: ${description}\nValor: ${amount}\nDireção: ${direction === 'inflow' ? 'entrada' : 'saída'}${categoryHint}`

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  })

  const tokensInput = response.usage.input_tokens
  const tokensOutput = response.usage.output_tokens
  const cacheRead = (response.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0
  const costUsd =
    (tokensInput * 0.0000008) +
    (cacheRead * 0.00000008) +
    (tokensOutput * 0.000004)

  const raw = response.content[0].type === 'text' ? response.content[0].text : ''

  let parsed: Record<string, unknown> | null = null
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) parsed = JSON.parse(match[0])
  } catch {
    return null
  }

  if (!parsed) return null

  const catCode = parsed.category_code as string | null
  const catConf = Number(parsed.category_confidence ?? 0) / 100
  const ccId = parsed.cost_center_id as string | null
  const buId = parsed.business_unit_id as string | null
  const leId = parsed.legal_entity_id as string | null

  if (catConf === 0) return null

  const category = catCode ? ctx.categories.find(c => c.code === catCode) : null
  const validCc = ccId && ctx.costCenters.some(cc => cc.id === ccId) ? ccId : null
  const validBu = buId && ctx.businessUnits.some(bu => bu.id === buId) ? buId : null
  const validLe = leId && ctx.legalEntities.some(le => le.id === leId) ? leId : null

  return {
    result: {
      categoryId: category?.id ?? null,
      costCenterId: validCc,
      businessUnitId: validBu,
      legalEntityId: validLe,
      confidence: catConf,
      method: 'llm',
      needsReview: catConf < 0.9,
    },
    tokensInput,
    tokensOutput,
    costUsd,
  }
}

// ─── Orquestrador principal ──────────────────────────────────────────────────

export interface CategorizationOutput {
  result: CategorizationResult | null
  llmCost?: { tokensInput: number; tokensOutput: number; costUsd: number }
}

export async function categorizeTransaction(
  tx: { id: string; organizationId: string; description: string; amount: string; direction: string; metadata?: Record<string, unknown> | null },
  ctx: OrgContext,
  documentDomain: DocumentDomain = 'dre',
): Promise<CategorizationOutput> {

  // Filtra categorias pelo domínio do documento: BP só vê BP, DRE só vê DRE.
  const domainCats = ctx.categories.filter(c =>
    documentDomain === 'bp' ? isBpType(c.type) : !isBpType(c.type),
  )
  const domainCategoryIds = new Set(domainCats.map(c => c.id))
  const domainCtx: OrgContext = { ...ctx, categories: domainCats }

  // Camada 1: Regras (domain-aware)
  const ruleResult = applyRules(tx.description, ctx.rules, domainCategoryIds)
  if (ruleResult) return { result: ruleResult }

  // Camada 2: Recorrência (mesmo domínio)
  const recurrenceResult = await checkRecurrence(
    ctx.organizationId, tx.id, tx.description, Array.from(domainCategoryIds),
  )
  if (recurrenceResult) return { result: recurrenceResult }

  // Camada 3: Embeddings — não implementado

  // Camada 4: Claude Haiku — só oferece categorias do domínio correto
  const meta = (tx.metadata ?? {}) as Record<string, unknown>
  const pluggyCategory = typeof meta.pluggyCategory === 'string' ? meta.pluggyCategory : null
  const llm = await classifyWithLLM(
    tx.description, tx.amount, tx.direction, domainCtx, documentDomain, pluggyCategory,
  )
  if (!llm) return { result: null }

  const { result, ...llmCost } = llm
  return { result, llmCost }
}

// ─── Log para agent_events ───────────────────────────────────────────────────

export async function logCategorizationEvent(params: {
  organizationId: string
  transactionId: string
  result: CategorizationResult
  llmCost?: { tokensInput: number; tokensOutput: number; costUsd: number }
}) {
  const { organizationId, transactionId, result, llmCost } = params
  if (!llmCost) return

  await db.insert(agentEvents).values({
    organizationId,
    type: 'categorization',
    entityType: 'transaction',
    entityId: transactionId,
    payload: {
      method: result.method,
      confidence: result.confidence,
      needsReview: result.needsReview,
      categoryId: result.categoryId,
      costCenterId: result.costCenterId,
      businessUnitId: result.businessUnitId,
      legalEntityId: result.legalEntityId,
    },
    modelUsed: 'claude-haiku-4-5-20251001',
    tokensInput: llmCost.tokensInput,
    tokensOutput: llmCost.tokensOutput,
    costUsd: String(llmCost.costUsd),
    success: true,
  })
}
