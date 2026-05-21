import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { transactions, documents, organizations, dataSources } from '@/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import {
  loadOrgContext,
  categorizeTransaction,
  logCategorizationEvent,
  domainFromReportType,
} from '@/lib/categorizer'

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

    if (transactionIds.length === 0) return { categorized: 0, needsReview: 0, skipped: 0 }

    if (!forceRun) {
      const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1)
      const s = (org?.settings ?? {}) as Record<string, unknown>
      if (s.autoCategorize === false) {
        return { categorized: 0, needsReview: 0, skipped: transactionIds.length, reason: 'disabled' }
      }
    }

    const results = await step.run('categorize-all', async () => {
      const ctx = await loadOrgContext(organizationId)

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
          accountName: transactions.accountName,
          accountType: transactions.accountType,
          accountNumber: transactions.accountNumber,
        })
        .from(transactions)
        .where(and(
          eq(transactions.organizationId, organizationId),
          inArray(transactions.id, transactionIds),
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

        const { result, llmCost } = await categorizeTransaction({
          ...tx,
          metadata: tx.metadata as Record<string, unknown> | null,
          accountName: tx.accountName,
          accountType: tx.accountType,
          accountNumber: tx.accountNumber,
          connectionLabel,
          connectionBadge,
        }, ctx, documentDomain)

        const hasAnyDimension = result && (
          result.categoryId || result.costCenterId ||
          result.businessUnitId || result.legalEntityId
        )

        if (!hasAnyDimension) {
          skipped++
          continue
        }

        await db
          .update(transactions)
          .set({
            categoryId: result!.categoryId,
            costCenterId: result!.costCenterId,
            businessUnitId: result!.businessUnitId,
            legalEntityId: result!.legalEntityId,
            categorizationConfidence: String(result!.confidence),
            categorizationMethod: result!.method,
            needsReview: result!.needsReview,
            updatedAt: new Date(),
          })
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

        if (result!.needsReview) needsReview++
        else categorized++
      }

      await Promise.allSettled(agentEventPromises)

      return { categorized, needsReview, skipped, total: txList.length }
    })

    return results
  },
)
