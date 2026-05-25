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
import { eq, and, ne, ilike, desc, inArray } from 'drizzle-orm'
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

// Conditions atuais: { description?: string, accountId?: string } — match AND implícito.
// Regras com targetCategoryId só disparam no mesmo domínio (BP↔BP, DRE↔DRE).
function applyRules(
  description: string,
  accountId: string | null,
  rules: OrgContext['rules'],
  domainCategoryIds: Set<string>,
): CategorizationResult | null {
  // Regras com accountId vêm primeiro (mais específicas que regras globais por descrição).
  const sorted = [...rules].sort((a, b) => {
    const aHas = (a.conditions as Record<string, unknown>).accountId ? 1 : 0
    const bHas = (b.conditions as Record<string, unknown>).accountId ? 1 : 0
    return bHas - aHas
  })

  for (const rule of sorted) {
    const c = rule.conditions as { description?: string; accountId?: string }

    if (c.accountId) {
      if (!accountId || c.accountId !== accountId) continue
    }
    if (c.description) {
      if (!description.toLowerCase().includes(c.description.toLowerCase())) continue
    }
    if (!c.accountId && !c.description) continue

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

Quando vier o bloco "Contexto da conta:" (nome da conta, etiqueta do usuário ou merchant), priorize atribuir centro de custo, unidade de negócio ou entidade jurídica cujos nomes coincidam (correspondência total ou substring forte) com esses sinais — atribua com confiança alta. Não force matches frágeis ou parciais ambíguos.

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

function buildAccountContextBlock(account?: AccountContext): string {
  if (!account) return ''
  const lines: string[] = []

  const labelPart = account.connectionLabel?.trim() ?? null
  const namePart = account.accountName?.trim() && account.accountName.trim() !== labelPart
    ? account.accountName.trim()
    : null
  const typePart = account.accountType?.trim() ?? null
  const numberPart = account.accountNumber?.trim() ?? null

  const contaParts: string[] = []
  if (labelPart) contaParts.push(labelPart)
  if (namePart) contaParts.push(`[${namePart}]`)
  if (typePart) contaParts.push(typePart)
  if (numberPart) contaParts.push(numberPart)
  if (contaParts.length > 0) lines.push(`- Conta: ${contaParts.join(' · ')}`)

  if (account.connectionBadge?.trim()) lines.push(`- Etiqueta do usuário: ${account.connectionBadge.trim()}`)
  if (account.merchantName?.trim()) lines.push(`- Merchant: ${account.merchantName.trim()}`)

  if (lines.length === 0) return ''
  return `\nContexto da conta:\n${lines.join('\n')}`
}

function buildNfContextBlock(nf?: NfContext | null): string {
  if (!nf) return ''
  const lines: string[] = []
  const counterpart = nf.nfTipo === 'saida'
    ? (nf.nfDestinatario ?? nf.nfDestinatarioCnpj)
    : (nf.nfEmitente ?? nf.nfEmitenteCnpj)
  if (counterpart) lines.push(`- Contraparte NF-e: ${counterpart}`)
  if (nf.nfEmitenteCnpj && nf.nfTipo === 'entrada') lines.push(`- CNPJ emitente: ${nf.nfEmitenteCnpj}`)
  if (lines.length === 0) return ''
  return `\nContexto NF-e:\n${lines.join('\n')}`
}

function buildCategoryHintsBlock(hints?: Record<string, string> | null): string {
  if (!hints) return ''
  const entries = Object.entries(hints).filter(([, v]) => v && v.trim().length > 0)
  if (entries.length === 0) return ''
  // Sinais de hierarquia da planilha de origem (Grupo, Família, Categoria, etc.).
  // O categorizador deve dar peso forte a estes na escolha da natureza, mas
  // ainda assim mapear pra uma das categorias listadas no system prompt.
  const lines = entries.map(([k, v]) => `- ${k}: ${v.trim()}`)
  return `\nClassificação na planilha de origem (forte sinal pra escolher a natureza):\n${lines.join('\n')}`
}

async function classifyWithLLM(
  description: string,
  amount: string,
  direction: string,
  ctx: OrgContext,
  domain: DocumentDomain,
  pluggyCategory?: string | null,
  accountContext?: AccountContext,
  nfContext?: NfContext | null,
  categoryHints?: Record<string, string> | null,
): Promise<LLMCallResult | null> {
  if (ctx.categories.length === 0) return null

  const systemPrompt = buildSystemPrompt(ctx, domain)
  const categoryHint = pluggyCategory ? `\nCategoria do banco (Pluggy): ${pluggyCategory}` : ''
  const accountBlock = buildAccountContextBlock(accountContext)
  const nfBlock = buildNfContextBlock(nfContext)
  const hintsBlock = buildCategoryHintsBlock(categoryHints)
  const userMessage = `Descrição: ${description}\nValor: ${amount}\nDireção: ${direction === 'inflow' ? 'entrada' : 'saída'}${categoryHint}${accountBlock}${nfBlock}${hintsBlock}`

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

export interface AccountContext {
  accountName?: string | null
  accountType?: string | null
  accountNumber?: string | null
  connectionLabel?: string | null
  connectionBadge?: string | null
  merchantName?: string | null
}

export interface NfContext {
  nfEmitente?: string | null
  nfEmitenteCnpj?: string | null
  nfDestinatario?: string | null
  nfDestinatarioCnpj?: string | null
  nfTipo?: 'saida' | 'entrada' | null
}

export async function categorizeTransaction(
  tx: {
    id: string
    organizationId: string
    description: string
    amount: string
    direction: string
    metadata?: Record<string, unknown> | null
    accountId?: string | null
    accountName?: string | null
    accountType?: string | null
    accountNumber?: string | null
    connectionLabel?: string | null
    connectionBadge?: string | null
    nfContext?: NfContext | null
  },
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
  const ruleResult = applyRules(tx.description, tx.accountId ?? null, ctx.rules, domainCategoryIds)
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
  const merchantName = typeof meta.merchantName === 'string' ? meta.merchantName : null
  const categoryHints = meta.categoryHints && typeof meta.categoryHints === 'object' && !Array.isArray(meta.categoryHints)
    ? (meta.categoryHints as Record<string, string>)
    : null

  const accountContext: AccountContext = {
    accountName: tx.accountName ?? null,
    accountType: tx.accountType ?? null,
    accountNumber: tx.accountNumber ?? null,
    connectionLabel: tx.connectionLabel ?? null,
    connectionBadge: tx.connectionBadge ?? null,
    merchantName,
  }

  const llm = await classifyWithLLM(
    tx.description, tx.amount, tx.direction, domainCtx, documentDomain, pluggyCategory, accountContext, tx.nfContext, categoryHints,
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
