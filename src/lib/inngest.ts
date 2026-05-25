import { Inngest } from 'inngest'

export const inngest = new Inngest({ id: 'lure-expert' })

// Inngest impõe 256KB por evento. Cada UUID JSON-encoded ocupa ~39 bytes,
// então 3000 IDs ≈ 117KB — sob o limite com margem confortável pra
// envelope de evento + metadata. Para uploads de 7000+ linhas viram
// 3 eventos sequenciais; a função categorize-transactions tem
// concurrency:1 por org, então os eventos são processados em fila.
const EVENT_ID_CHUNK = 3000

export async function sendCategorizationEvents(
  transactionIds: string[],
  organizationId: string,
  forceRun?: boolean,
) {
  for (let i = 0; i < transactionIds.length; i += EVENT_ID_CHUNK) {
    const slice = transactionIds.slice(i, i + EVENT_ID_CHUNK)
    await inngest.send({
      name: 'transaction/batch-inserted',
      data: { transactionIds: slice, organizationId, ...(forceRun ? { forceRun: true } : {}) },
    })
  }
}
