import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { transactions, documents, organizations, dataSources, invoices } from '@/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import {
  loadOrgContext,
  categorizeTransaction,
  logCategorizationEvent,
  domainFromReportType,
  type NfContext,
  type OrgContext,
} from '@/lib/categorizer'

// CHUNK_SIZE define quantas transações cada step.run processa. Cada step é
// uma invocação serverless independente, sujeita ao maxDuration de 300s do
// Vercel. Com ~1s por chamada Haiku, 50 linhas = ~50s/step, bem folgado.
// Pra 7000+ linhas isso vira ~140 steps — dentro do limite default de 1000
// steps/função do Inngest.
const CHUNK_SIZE = 50

async function processChunk(
  ids: string[],
  organizationId: string,
  ctx: OrgContext,
): Promise<{ categorized: number; needsReview: number; skipped: number }> {
  if (ids.length === 0) return { categorized: 0, needsReview: 0, skipped: 0 }

  const txList = await db
    .select({
      id: transactions.id,
      organizationId: transactions.organizationId,
      description: transactions.description,
      amount: transactions.amount,
      direction: transactions.direction,
      metadata: transactions.metadata,
      documentId: transactions.documentId,
      dataSourceId: transactions.dataSourceId,
      accountId: transactions.accountId,
      accountName: transactions.accountName,
      accountType: transactions.accountType,
      accountNumber: transactions.accountNumber,
      invoiceId: transactions.invoiceId,
    })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, organizationId),
      inArray(transactions.id, ids),
    ))

  // Deriva o domínio (bp/dre) a partir do report_type do documento de cada transação.
  const docIds = Array.from(new Set(txList.map(tx => tx.documentId).filter((id): id is string => id !== null)))
  const docRows = docIds.length > 0
    ? await db
      .select({ id: documents.id, reportType: documents.reportType })
      .from(documents)
      .where(inArray(documents.id, docIds))
    : []
  const docDomainMap = new Map(docRows.map(d => [d.id, domainFromReportType(d.reportType)]))

  // Camada 0.5: carrega dados de NF-e para transações já reconciliadas
  const invoiceIds = Array.from(new Set(txList.map(tx => tx.invoiceId).filter((id): id is string => id !== null)))
  const invoiceRows = invoiceIds.length > 0
    ? await db
      .select({
        id: invoices.id,
        tipo: invoices.tipo,
        emitenteNome: invoices.emitenteNome,
        emitenteCnpj: invoices.emitenteCnpj,
        destinatarioNome: invoices.destinatarioNome,
        destinatarioCnpj: invoices.destinatarioCnpj,
      })
      .from(invoices)
      .where(inArray(invoices.id, invoiceIds))
    : []
  const invoiceMap = new Map(invoiceRows.map(i => [i.id, i]))

  // Carrega metadados das conexões (uma query) para enriquecer o contexto do LLM
  const dsIds = Array.from(new Set(txList.map(tx => tx.dataSourceId).filter((id): id is string => id !== null)))
  const dsRows = dsIds.length > 0
    ? await db
      .select({ id: dataSources.id, metadata: dataSources.metadata })
      .from(dataSources)
      .where(inArray(dataSources.id, dsIds))
    : []
  const dsMetaMap = new Map(dsRows.map(d => [d.id, (d.metadata ?? {}) as Record<string, unknown>]))

  let categorized = 0
  let needsReview = 0
  let skipped = 0
  const agentEventPromises: Promise<void>[] = []

  for (const tx of txList) {
    const documentDomain = tx.documentId ? (docDomainMap.get(tx.documentId) ?? 'dre') : 'dre'

    const dsMeta = tx.dataSourceId ? dsMetaMap.get(tx.dataSourceId) ?? {} : {}
    const connectionLabel =
      (typeof dsMeta.customLabel === 'string' && dsMeta.customLabel) ||
      (typeof dsMeta.institutionName === 'string' && dsMeta.institutionName) ||
      null
    const customBadge = dsMeta.customBadge as { text?: string } | undefined
    const connectionBadge = customBadge?.text ?? null

    const inv = tx.invoiceId ? invoiceMap.get(tx.invoiceId) : null
    const nfContext: NfContext | null = inv ? {
      nfTipo: inv.tipo as 'saida' | 'entrada',
      nfEmitente: inv.emitenteNome,
      nfEmitenteCnpj: inv.emitenteCnpj,
      nfDestinatario: inv.destinatarioNome,
      nfDestinatarioCnpj: inv.destinatarioCnpj,
    } : null

    const { result, llmCost } = await categorizeTransaction({
      ...tx,
      metadata: tx.metadata as Record<string, unknown> | null,
      accountName: tx.accountName,
      accountType: tx.accountType,
      accountNumber: tx.accountNumber,
      connectionLabel,
      connectionBadge,
      nfContext,
    }, ctx, documentDomain)

    const hasAnyDimension = result && (
      result.categoryId || result.costCenterId ||
      result.businessUnitId || result.legalEntityId ||
      result.contactId
    )

    if (!hasAnyDimension) {
      skipped++
      continue
    }

    // Escreve só o que veio preenchido. O job também roda por "Categorizar
    // agora", sobre lançamento que já tem classificação — e o `set` fixo
    // apagava com null toda dimensão que o LLM não reconhecesse nesta passada,
    // inclusive a que o cliente tinha posto à mão. Com a categoria deixando de
    // ser obrigatória para o resultado existir, isso passaria a zerar a
    // natureza também.
    const updates: Partial<typeof transactions.$inferInsert> = { updatedAt: new Date() }

    // Confiança, método e revisão descrevem a escolha da natureza — só se
    // movem junto com ela.
    if (result!.categoryId) {
      updates.categoryId = result!.categoryId
      updates.categorizationConfidence = String(result!.confidence)
      updates.categorizationMethod = result!.method
      updates.needsReview = result!.needsReview
    }
    if (result!.costCenterId) updates.costCenterId = result!.costCenterId
    if (result!.businessUnitId) updates.businessUnitId = result!.businessUnitId
    if (result!.legalEntityId) updates.legalEntityId = result!.legalEntityId
    if (result!.contactId) updates.contactId = result!.contactId

    await db
      .update(transactions)
      .set(updates)
      .where(and(
        eq(transactions.id, tx.id),
        eq(transactions.organizationId, organizationId),
      ))

    if (llmCost) {
      agentEventPromises.push(
        logCategorizationEvent({
          organizationId,
          transactionId: tx.id,
          result: result!,
          llmCost,
        })
      )
    }

    // Ganhar só dimensão não é estar categorizado: sem natureza o lançamento
    // continua fora da DRE e precisa de gente.
    if (!result!.categoryId || result!.needsReview) needsReview++
    else categorized++
  }

  await Promise.allSettled(agentEventPromises)

  return { categorized, needsReview, skipped }
}

export const categorizeTransactions = inngest.createFunction(
  {
    id: 'categorize-transactions',
    name: 'Categorizar transações',
    triggers: [{ event: 'transaction/batch-inserted' }],
    concurrency: { limit: 1, key: 'event.data.organizationId' },
  },
  async ({ event, step }) => {
    const { transactionIds, organizationId, forceRun } = event.data as {
      transactionIds: string[]
      organizationId: string
      forceRun?: boolean
    }

    if (transactionIds.length === 0) return { categorized: 0, needsReview: 0, skipped: 0, total: 0 }

    const shouldRun = await step.run('check-settings', async () => {
      if (forceRun) return true
      const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1)
      const s = (org?.settings ?? {}) as Record<string, unknown>
      return s.autoCategorize !== false
    })
    if (!shouldRun) {
      return { categorized: 0, needsReview: 0, skipped: transactionIds.length, reason: 'disabled' }
    }

    const ctx = await step.run('load-context', () => loadOrgContext(organizationId))

    const totals = { categorized: 0, needsReview: 0, skipped: 0 }
    const chunkCount = Math.ceil(transactionIds.length / CHUNK_SIZE)

    for (let i = 0; i < chunkCount; i++) {
      const slice = transactionIds.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
      const partial = await step.run(`chunk-${i}`, () => processChunk(slice, organizationId, ctx))
      totals.categorized += partial.categorized
      totals.needsReview += partial.needsReview
      totals.skipped += partial.skipped
    }

    return { ...totals, total: transactionIds.length }
  },
)
