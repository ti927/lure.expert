import { inngest } from '@/lib/inngest'
import { db } from '@/db'
import { invoices, transactions } from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'

const RECONCILE_BATCH = 50
const SCORE_AUTO   = 0.85
const SCORE_REVIEW = 0.50

export const reconcileInvoices = inngest.createFunction(
  {
    id: 'reconcile-invoices',
    name: 'Reconciliar NF-e com transações bancárias',
    triggers: [{ event: 'sefaz/invoices.batch-inserted' }],
    concurrency: { limit: 1, key: 'event.data.organizationId' },
  },
  async ({ event, step }) => {
    const { invoiceIds, organizationId } = event.data as {
      invoiceIds: string[]
      organizationId: string
    }

    if (invoiceIds.length === 0) return { processed: 0, casadas: 0, revisao: 0 }

    // Busca as invoices recém-inseridas ainda com status 'nova'
    const newInvoices = await step.run('fetch-invoices', async () => {
      return db
        .select({
          id: invoices.id,
          tipo: invoices.tipo,
          emitenteNome: invoices.emitenteNome,
          destinatarioNome: invoices.destinatarioNome,
          dataEmissao: invoices.dataEmissao,
          totalNf: invoices.totalNf,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, organizationId),
            sql`${invoices.id} = ANY(ARRAY[${sql.raw(invoiceIds.map(id => `'${id}'::uuid`).join(','))}])`,
            eq(invoices.status, 'nova'),
          )
        )
    })

    let casadas = 0
    let revisao = 0

    for (let i = 0; i < newInvoices.length; i += RECONCILE_BATCH) {
      const batch = newInvoices.slice(i, i + RECONCILE_BATCH)
      const batchNum = Math.floor(i / RECONCILE_BATCH)

      const counts = await step.run(`reconcile-batch-${batchNum}`, async () => {
        let batchCasadas = 0
        let batchRevisao = 0

        for (const inv of batch) {
          // Direção coerente: NF saída → empresa recebeu (inflow), NF entrada → empresa pagou (outflow)
          const txDirection = inv.tipo === 'saida' ? 'inflow' : 'outflow'

          // Nome da contraparte esperado na descrição do extrato bancário
          // Saída: quem pagou = destinatário; Entrada: quem emitiu = emitente
          const nfName = inv.tipo === 'saida'
            ? (inv.destinatarioNome ?? '')
            : (inv.emitenteNome ?? '')

          // Score composto:
          //   40% — pg_trgm similarity(nome_contraparte, tx.description)
          //   40% — match de valor binário (±0.5% tolerância)
          //   20% — proximidade de data linear (0d→1.0, 7d→0.0)
          const rows = await db.execute<{ id: string; score: string }>(sql`
            SELECT
              t.id,
              (
                similarity(t.description, ${nfName}) * 0.4
                + CASE
                    WHEN ABS(t.amount::numeric - ${inv.totalNf}::numeric) <= ${inv.totalNf}::numeric * 0.005
                    THEN 1.0
                    ELSE 0.0
                  END * 0.4
                + GREATEST(0.0, 1.0 - ABS(t.date::date - ${inv.dataEmissao}::date)::float8 / 7.0) * 0.2
              )::numeric(4,3) AS score
            FROM transactions t
            WHERE t.organization_id = ${organizationId}::uuid
              AND t.direction        = ${txDirection}
              AND t.amount::numeric BETWEEN ${inv.totalNf}::numeric * 0.995
                                        AND ${inv.totalNf}::numeric * 1.005
              AND t.date::date BETWEEN (${inv.dataEmissao}::date - INTERVAL '7 days')
                                   AND (${inv.dataEmissao}::date + INTERVAL '7 days')
              AND t.status           = 'confirmed'
              AND t.invoice_id       IS NULL
            ORDER BY score DESC
            LIMIT 1
          `)

          const match = rows[0]
          if (!match) continue

          const score = Number(match.score)

          if (score >= SCORE_AUTO) {
            // Casa automaticamente
            await db.update(invoices)
              .set({
                transactionId: match.id,
                status: 'casada',
                reconciliationScore: String(score.toFixed(2)),
                updatedAt: new Date(),
              })
              .where(eq(invoices.id, inv.id))

            // Atualiza a transaction: vincula invoice + seta data de competência real para o DRE
            await db.update(transactions)
              .set({
                invoiceId: inv.id,
                date: inv.dataEmissao,  // substitui data do extrato pela data da NF (competência)
                updatedAt: new Date(),
              })
              .where(eq(transactions.id, match.id))

            batchCasadas++
          } else if (score >= SCORE_REVIEW) {
            // Aguarda confirmação manual no painel /nfe
            await db.update(invoices)
              .set({
                status: 'pendente_revisao',
                reconciliationScore: String(score.toFixed(2)),
                updatedAt: new Date(),
              })
              .where(eq(invoices.id, inv.id))

            batchRevisao++
          }
          // score < SCORE_REVIEW → invoice fica 'nova' (AR ou AP em aberto)
        }

        return { casadas: batchCasadas, revisao: batchRevisao }
      })

      casadas += counts.casadas
      revisao += counts.revisao
    }

    return { processed: newInvoices.length, casadas, revisao }
  },
)
