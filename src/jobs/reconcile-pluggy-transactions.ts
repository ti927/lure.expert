import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { transactions } from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'

// Thresholds de similaridade (pg_trgm similarity(), escala 0–1)
const SCORE_AUTO = 0.85   // ≥ 0.85 → duplicata automática
const SCORE_MIN  = 0.50   // ≥ 0.50 → fila de revisão manual

export const reconcilePluggyTransactions = inngest.createFunction(
  {
    id: 'reconcile-pluggy-transactions',
    name: 'Reconciliar transações Pluggy com uploads manuais',
    triggers: [{ event: 'pluggy/reconcile.requested' }],
    concurrency: { limit: 1, key: 'event.data.organizationId' },
  },
  async ({ event, step }) => {
    const { transactionIds, organizationId } = event.data as {
      transactionIds: string[]
      organizationId: string
    }

    if (transactionIds.length === 0) return { processed: 0, duplicates: 0, flagged: 0 }

    // Busca as transações Pluggy recém-inseridas
    const pluggyTxs = await step.run('fetch-pluggy-transactions', async () => {
      return db
        .select({
          id: transactions.id,
          date: transactions.date,
          amount: transactions.amount,
          direction: transactions.direction,
          description: transactions.description,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.organizationId, organizationId),
            sql`${transactions.id} = ANY(ARRAY[${sql.raw(transactionIds.map(id => `'${id}'::uuid`).join(','))}])`
          )
        )
    })

    let duplicates = 0
    let flagged = 0

    // Processa cada transação Pluggy individualmente para aproveitar os steps do Inngest
    for (const tx of pluggyTxs) {
      const result = await step.run(`reconcile-tx-${tx.id}`, async () => {
        // Busca o melhor candidato entre transações de upload (não-Pluggy) da mesma org
        // Critérios: mesma direção + mesmo valor + ±2 dias + similaridade trigram na descrição
        const rows = await db.execute<{
          id: string
          score: number
        }>(sql`
          SELECT
            t.id,
            similarity(t.description, ${tx.description}) AS score
          FROM transactions t
          JOIN data_sources ds ON ds.id = t.data_source_id
          WHERE t.organization_id = ${organizationId}::uuid
            AND t.direction       = ${tx.direction}
            AND t.amount          = ${tx.amount}::numeric
            AND t.date BETWEEN (${tx.date}::date - INTERVAL '2 days')
                           AND (${tx.date}::date + INTERVAL '2 days')
            AND ds.provider      != 'pluggy'
            AND t.status         NOT IN ('duplicate', 'ignored')
            AND t.duplicate_of   IS NULL
            AND similarity(t.description, ${tx.description}) >= ${SCORE_MIN}
          ORDER BY score DESC
          LIMIT 1
        `)

        const match = rows[0]
        if (!match) return { action: 'none' as const }

        const score = Number(match.score)

        if (score >= SCORE_AUTO) {
          // Duplicata automática: marca o upload como duplicata, aponta para a canônica (Pluggy)
          await db
            .update(transactions)
            .set({
              status: 'duplicate',
              duplicateOf: tx.id,
              updatedAt: new Date(),
            })
            .where(eq(transactions.id, match.id))

          return { action: 'duplicate' as const, matchId: match.id, score }
        }

        // Fila de revisão manual: seta needs_review + flag no metadata
        const [current] = await db
          .select({ metadata: transactions.metadata })
          .from(transactions)
          .where(eq(transactions.id, match.id))
          .limit(1)

        const existingMeta = (current?.metadata ?? {}) as Record<string, unknown>

        await db
          .update(transactions)
          .set({
            needsReview: true,
            metadata: {
              ...existingMeta,
              reconciliationPending: true,
              reconciliationCandidateId: tx.id,
              reconciliationScore: score,
            },
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, match.id))

        return { action: 'flagged' as const, matchId: match.id, score }
      })

      if (result.action === 'duplicate') duplicates++
      if (result.action === 'flagged') flagged++
    }

    return { processed: pluggyTxs.length, duplicates, flagged }
  },
)
