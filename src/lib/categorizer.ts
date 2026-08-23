import { db } from '@/db'
import {
  transactions,
  categorizationRules,
  categories,
  costCenters,
  businessUnits,
  legalEntities,
  contacts,
} from '@/db/schema'
import { eq, and, ne, ilike, asc, desc, inArray } from 'drizzle-orm'
import { registrarUsoDeIa, tokensDaResposta } from '@/lib/ai-usage'
import { resolverAcessoIa } from '@/lib/ai-access'
import { BP_TYPES } from '@/lib/bp-types'

const MODELO_CATEGORIZACAO = 'claude-haiku-4-5-20251001'

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
  contactId: string | null
  confidence: number
  method: 'csv_match' | 'rule' | 'recurrence' | 'embedding' | 'llm'
  needsReview: boolean
}

export interface LeafCategory {
  id: string
  code: string | null
  name: string
  type: string
  parentName: string | null
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
    targetContactId: string | null
  }>
  categories: LeafCategory[]
  costCenters: Array<{ id: string; name: string; code: string | null }>
  businessUnits: Array<{ id: string; name: string; code: string | null }>
  legalEntities: Array<{ id: string; name: string; cnpj: string | null }>
  contacts: Array<{
    id: string
    name: string
    tradeName: string | null
    document: string | null
    isCustomer: boolean
    isSupplier: boolean
  }>
}

export async function loadOrgContext(organizationId: string): Promise<OrgContext> {
  const [rules, allCats, ccs, bus, les, cts] = await Promise.all([
    db.select({
      id: categorizationRules.id,
      conditions: categorizationRules.conditions,
      targetCategoryId: categorizationRules.targetCategoryId,
      targetCostCenterId: categorizationRules.targetCostCenterId,
      targetBusinessUnitId: categorizationRules.targetBusinessUnitId,
      targetLegalEntityId: categorizationRules.targetLegalEntityId,
      targetContactId: categorizationRules.targetContactId,
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

    // Nome fantasia e papel entram porque o extrato traz o fantasia com muito
    // mais frequência que a razão social, e o papel desempata contato que é
    // cliente e fornecedor ao mesmo tempo. Ordem alfabética torna determinístico
    // o corte de CONTACTS_NO_PROMPT lá no system prompt.
    db.select({
      id: contacts.id,
      name: contacts.name,
      tradeName: contacts.tradeName,
      document: contacts.document,
      isCustomer: contacts.isCustomer,
      isSupplier: contacts.isSupplier,
    })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.isActive, true)))
      .orderBy(asc(contacts.name)),
  ])

  // Nós folha = categorias cujo id não aparece como parentId de nenhuma outra categoria.
  // Isso inclui: todos os Filhos (parentId != null) + Pais sem filhos (caso de uso BP).
  const parentIdSet = new Set(allCats.map(c => c.parentId).filter((p): p is string => p !== null))
  const nameById = new Map(allCats.map(c => [c.id, c.name]))
  const leafCats: LeafCategory[] = allCats
    .filter(c => !parentIdSet.has(c.id))
    .map(c => ({
      id: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      parentName: c.parentId ? (nameById.get(c.parentId) ?? null) : null,
    }))

  return {
    organizationId,
    rules: rules as OrgContext['rules'],
    categories: leafCats,
    costCenters: ccs,
    businessUnits: bus,
    legalEntities: les,
    contacts: cts,
  }
}

// ─── Camada 0: Match autoritativo do CSV ─────────────────────────────────────
// Quando o CSV tem colunas literais "Categoria Filho" / "Natureza Filho" /
// "Conta Contábil" / etc, o valor é tratado como nome canônico da folha do
// plano de contas. Tenta lookup exato normalizado; se houver ambiguidade,
// desempata pelo nome do pai. Sem match → cai pra Layer 1+ (regra → LLM).

export interface CsvCategoryMapping {
  categoriaFilho?: string
  categoriaPai?: string
  // Tipo do plano de contas como o usuário expressou na coluna do CSV
  // (ex: "Receita", "CMV", "Despesa Operacional"). findCategoryByCsvMapping
  // converte pra código interno via TIPO_ALIASES.
  tipoNatureza?: string
}

// Aliases pra mapear o que o usuário escreve na coluna Tipo Natureza pra
// código interno do plano de contas (definido em src/lib/dre-types.ts).
// Ordem importa — códigos mais específicos vêm primeiro pra evitar match
// prematuro (ex: "deducao" antes de "receita" pra "deducao de receita").
const TIPO_ALIASES: Array<{ code: string; patterns: string[] }> = [
  { code: 'deducoes_tributarias', patterns: ['deducao tributaria', 'deducoes tributarias', 'imposto', 'tributo', 'impostos sobre vendas'] },
  { code: 'deducoes_operacionais', patterns: ['deducao operacional', 'deducoes operacionais', 'devolucao', 'desconto comercial', 'abatimento'] },
  { code: 'receita_operacional', patterns: ['receita operacional', 'receita', 'venda', 'faturamento', 'vendas'] },
  { code: 'cpv', patterns: ['cpv', 'cmv', 'custo dos produtos', 'custo dos servicos', 'custo dos produtos servicos vendidos', 'custo'] },
  { code: 'sga', patterns: ['sga', 'sg a', 'despesa operacional', 'despesas operacionais', 'despesa administrativa', 'despesa comercial', 'despesa'] },
  { code: 'resultado_financeiro', patterns: ['resultado financeiro', 'receita financeira', 'despesa financeira', 'juros'] },
  { code: 'ir', patterns: ['ir csll', 'ir e csll', 'imposto de renda', 'csll', 'ir'] },
  { code: 'emprestimos_amortizacoes', patterns: ['emprestimo', 'emprestimos', 'amortizacao', 'amortizacoes', 'financiamento'] },
  { code: 'investimentos_retiradas', patterns: ['investimento', 'investimentos', 'retirada', 'retiradas', 'aporte', 'distribuicao de lucros'] },
  { code: 'transfer', patterns: ['transferencia', 'transferencias', 'transfer'] },
  { code: 'ativo_nao_circulante', patterns: ['ativo nao circulante'] },
  { code: 'passivo_nao_circulante', patterns: ['passivo nao circulante'] },
  { code: 'ativo_circulante', patterns: ['ativo circulante', 'ativo'] },
  { code: 'passivo_circulante', patterns: ['passivo circulante', 'passivo'] },
  { code: 'patrimonio_liquido', patterns: ['patrimonio liquido', 'patrimonio'] },
]

function inferTipoCode(userText: string): string | null {
  const n = normalizeForMatch(userText)
  if (!n) return null
  for (const { code, patterns } of TIPO_ALIASES) {
    for (const p of patterns) {
      if (n === p || n.includes(p)) return code
    }
  }
  return null
}

// Normaliza pra comparação robusta entre nome da folha do plano de contas e
// valor da célula do CSV: lowercase + tira acentos + colapsa qualquer
// caractere não-alfanumérico em espaço (en-dash, em-dash, barra, parênteses)
// + colapsa whitespace múltiplo. Assim "AC3 – Porcelanato / Flex" do CSV
// casa com "AC3 - Porcelanato / Flex" do plano (mesmo com hyphen comum).
// Usa ̀-ͯ (combining diacritical marks) em escape explícito —
// SWC/Next.js já strippou range literal antes em produção.
function normalizeForMatch(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function findCategoryByCsvMapping(
  mapping: CsvCategoryMapping | null | undefined,
  leaves: LeafCategory[],
): string | null {
  if (!mapping?.categoriaFilho) return null
  const targetFilho = normalizeForMatch(mapping.categoriaFilho)
  if (!targetFilho) return null

  let candidates = leaves.filter(c => normalizeForMatch(c.name) === targetFilho)
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0].id

  // Múltiplos: aplica filtros adicionais cumulativos.
  // 1) Tipo (Receita vs CMV etc) — desempata casos onde o mesmo nome de
  //    natureza aparece em tipos diferentes do plano de contas.
  if (mapping.tipoNatureza) {
    const tipoCode = inferTipoCode(mapping.tipoNatureza)
    if (tipoCode) {
      const filteredByTipo = candidates.filter(c => c.type === tipoCode)
      if (filteredByTipo.length === 1) return filteredByTipo[0].id
      if (filteredByTipo.length > 0) candidates = filteredByTipo
    }
  }

  // 2) Pai — desempata casos onde mesmo nome de filho aparece sob pais
  //    diferentes dentro do mesmo tipo.
  if (candidates.length > 1 && mapping.categoriaPai) {
    const targetPai = normalizeForMatch(mapping.categoriaPai)
    if (targetPai) {
      const filteredByPai = candidates.filter(c =>
        c.parentName && normalizeForMatch(c.parentName) === targetPai,
      )
      if (filteredByPai.length === 1) return filteredByPai[0].id
      if (filteredByPai.length > 0) candidates = filteredByPai
    }
  }

  return candidates.length === 1 ? candidates[0].id : null
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
      contactId: rule.targetContactId,
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
      contactId: transactions.contactId,
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
    contactId: prev.contactId ?? null,
    confidence: 0.93,
    method: 'recurrence',
    needsReview: false,
  }
}

// ─── Camada 3: Embedding similarity (não implementado ainda) ─────────────────

// ─── Camada 4: Claude Haiku ──────────────────────────────────────────────────

// As outras três dimensões têm dezenas de itens; a carteira de contatos de uma
// PME tem milhares. O system prompt é cacheado (`cache_control` na chamada), mas
// listar tudo ainda infla cada requisição — daí o teto, com o corte declarado ao
// modelo pra ele devolver null em vez de inventar quem ficou de fora.
const CONTACTS_NO_PROMPT = 400

function buildContactList(ctxContacts: OrgContext['contacts']): string {
  if (ctxContacts.length === 0) return '\nContatos: nenhum cadastrado — retorne null'

  const shown = ctxContacts.slice(0, CONTACTS_NO_PROMPT)
  const linhas = shown.map(ct => {
    const fantasia = ct.tradeName && ct.tradeName !== ct.name ? ` (${ct.tradeName})` : ''
    const doc = ct.document ? ` [${ct.document}]` : ''
    const papel = ct.isCustomer && ct.isSupplier
      ? ' — cliente/fornecedor'
      : ct.isCustomer ? ' — cliente'
      : ct.isSupplier ? ' — fornecedor'
      : ''
    return `${ct.id}: ${ct.name}${fantasia}${doc}${papel}`
  })

  const corte = ctxContacts.length > CONTACTS_NO_PROMPT
    ? `\n(lista truncada nos primeiros ${CONTACTS_NO_PROMPT} de ${ctxContacts.length} contatos ativos — se a contraparte não estiver acima, retorne null)`
    : ''

  return `\nContatos (id: nome (fantasia) [documento] — papel):\n${linhas.join('\n')}${corte}`
}

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

  const ctList = buildContactList(ctx.contacts)

  return `Você é um categorizador de transações financeiras para PMEs brasileiras.
${domainNote}

Quando vier o bloco "Contexto da conta:" (nome da conta, etiqueta do usuário ou merchant), priorize atribuir centro de custo, unidade de negócio ou entidade jurídica cujos nomes coincidam (correspondência total ou substring forte) com esses sinais — atribua com confiança alta. Não force matches frágeis ou parciais ambíguos.

O contato é a contraparte do lançamento: quem recebeu o dinheiro numa saída, de quem ele veio numa entrada. Atribua só com correspondência forte entre a descrição (ou o bloco "Contexto NF-e", quando houver) e o nome, o nome fantasia ou o documento de um contato listado — o extrato costuma trazer o nome fantasia, não a razão social. Se a contraparte não estiver na lista, retorne null; nunca invente um uuid, e não atribua por coincidência de uma palavra comum ("central", "brasil", "comercio") quando o resto do nome não bate.

O papel serve para desempatar, não para vetar: entre dois contatos parecidos, prefira o fornecedor numa saída e o cliente numa entrada. Um contato de papel divergente ainda pode ser a contraparte certa — reembolso, estorno e devolução a cliente são saídas legítimas, e cadastro incompleto é comum. Nesse caso atribua, mas com contact_confidence mais baixa.

A contact_confidence mede só a identificação da contraparte, independente da categoria: nome fantasia ou documento batendo por inteiro fica acima de 90 mesmo que a natureza do lançamento seja indefinida. Abaixo de 70 o contato é descartado.

Categorias disponíveis (código: nome):
${catList}
${ccList}${buList}${leList}${ctList}

Retorne APENAS este JSON sem nenhum texto adicional:
{
  "category_code": "<código da categoria ou null>",
  "category_confidence": <0-100>,
  "cost_center_id": "<uuid exato ou null>",
  "cost_center_confidence": <0-100>,
  "business_unit_id": "<uuid exato ou null>",
  "business_unit_confidence": <0-100>,
  "legal_entity_id": "<uuid exato ou null>",
  "legal_entity_confidence": <0-100>,
  "contact_id": "<uuid exato ou null>",
  "contact_confidence": <0-100>
}`
}

interface LLMCallResult {
  result: CategorizationResult
  tokensInput: number
  tokensOutput: number
  /** Leitura de cache é cobrada à parte, ~10× mais barata que input novo. */
  cacheReadTokens: number
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

  // Recusa devolve null, e a cascata segue: as camadas 0 a 2 (CSV, regras,
  // recorrencia) ja resolveram o que sabiam, e o que sobrar vai para a fila de
  // revisao -- exatamente o que ja acontecia quando o modelo falhava.
  const acesso = await resolverAcessoIa(ctx.organizationId)
  if (!acesso.ok) return null

  const response = await acesso.client.messages.create({
    model: MODELO_CATEGORIZACAO,
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

  // O preço saiu daqui na Fase 0 e vive em `lib/ai-pricing.ts`, junto com o dos
  // parsers — antes cada consumidor tinha (ou não tinha) a sua própria conta.
  const { inputTokens: tokensInput, outputTokens: tokensOutput, cacheReadTokens } =
    tokensDaResposta(response.usage)

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
  const ctId = parsed.contact_id as string | null
  const ctConf = Number(parsed.contact_confidence ?? 0) / 100

  const category = catConf > 0 && catCode ? ctx.categories.find(c => c.code === catCode) : null
  const validCc = ccId && ctx.costCenters.some(cc => cc.id === ccId) ? ccId : null
  const validBu = buId && ctx.businessUnits.some(bu => bu.id === buId) ? buId : null
  const validLe = leId && ctx.legalEntities.some(le => le.id === leId) ? leId : null
  // Mesma guarda das outras: o uuid devolvido tem de existir no contexto. Sem
  // ela o Haiku inventaria um contato e a FK estouraria na gravacao.
  // O piso de confiança é exclusivo do contato: as outras três dimensões casam
  // por nome de conta ou etiqueta, e esta casa contra a descrição do extrato,
  // onde o fornecedor aparece truncado e abreviado — é a que mais produz match
  // frágil. Abaixo de 70 fica em branco, e o cliente atribui na tela.
  const validCt = ctId && ctConf >= 0.7 && ctx.contacts.some(ct => ct.id === ctId) ? ctId : null

  // Categoria indefinida não invalida o resto. Descrição de PIX e TED costuma
  // identificar a contraparte sem dizer nada sobre a natureza — antes de o
  // contato existir isso significava resultado vazio de qualquer jeito, e agora
  // jogaria fora um contato reconhecido com confiança alta. Só descarta quando
  // nada sobrou. Quem grava trata cada campo em separado.
  if (!category && !validCc && !validBu && !validLe && !validCt) return null

  return {
    result: {
      categoryId: category?.id ?? null,
      costCenterId: validCc,
      businessUnitId: validBu,
      legalEntityId: validLe,
      contactId: validCt,
      confidence: catConf,
      method: 'llm',
      needsReview: catConf < 0.9,
    },
    tokensInput,
    tokensOutput,
    cacheReadTokens,
  }
}

// ─── Orquestrador principal ──────────────────────────────────────────────────

export interface CategorizationOutput {
  result: CategorizationResult | null
  llmCost?: { tokensInput: number; tokensOutput: number; cacheReadTokens: number }
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

  const meta = (tx.metadata ?? {}) as Record<string, unknown>

  // Camada 0: Match autoritativo do CSV (Categoria Pai/Filho do arquivo).
  // Lookup determinístico contra o plano de contas — quando casa, pula LLM.
  const csvMapping = meta.categoryMapping && typeof meta.categoryMapping === 'object' && !Array.isArray(meta.categoryMapping)
    ? (meta.categoryMapping as CsvCategoryMapping)
    : null
  const csvMatchId = findCategoryByCsvMapping(csvMapping, domainCats)
  if (csvMatchId) {
    return {
      result: {
        categoryId: csvMatchId,
        costCenterId: null,
        businessUnitId: null,
        legalEntityId: null,
        contactId: null,
        confidence: 1.0,
        method: 'csv_match',
        needsReview: false,
      },
    }
  }

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

/**
 * Só grava quando o Haiku foi realmente chamado — as camadas 0 a 2 (CSV,
 * regras, recorrência) não custam nada e não geram evento.
 *
 * Desde a Fase 0 a escrita passa por `registrarUsoDeIa`, que é o ponto único de
 * medição: o preço vem da mesma tabela que os parsers usam, em vez de ser
 * recalculado aqui.
 */
export async function logCategorizationEvent(params: {
  organizationId: string
  transactionId: string
  result: CategorizationResult
  llmCost?: { tokensInput: number; tokensOutput: number; cacheReadTokens: number }
}) {
  const { organizationId, transactionId, result, llmCost } = params
  if (!llmCost) return

  await registrarUsoDeIa({
    organizationId,
    kind:  'categorization',
    model: MODELO_CATEGORIZACAO,
    usage: {
      inputTokens:     llmCost.tokensInput,
      outputTokens:    llmCost.tokensOutput,
      cacheReadTokens: llmCost.cacheReadTokens,
    },
    entityType: 'transaction',
    entityId:   transactionId,
    payload: {
      method: result.method,
      confidence: result.confidence,
      needsReview: result.needsReview,
      categoryId: result.categoryId,
      costCenterId: result.costCenterId,
      businessUnitId: result.businessUnitId,
      legalEntityId: result.legalEntityId,
      contactId: result.contactId,
    },
  })
}
