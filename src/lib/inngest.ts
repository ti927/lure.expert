import { Inngest } from 'inngest'

// Mesma sanitização de [src/lib/anthropic.ts](src/lib/anthropic.ts) — chaves
// copiadas pra Vercel via editores Windows às vezes vêm com BOM/zero-width
// e quebram o construtor de headers do undici.
function sanitizeKey(raw: string | undefined): string {
  if (!raw) return ''
  let s = raw
  while (s.length > 0) {
    const code = s.charCodeAt(0)
    if (code === 0xFEFF || code === 0x200B || code <= 0x20) {
      s = s.slice(1)
    } else break
  }
  return s.trim()
}

const eventKey = sanitizeKey(process.env.INNGEST_EVENT_KEY)
const signingKey = sanitizeKey(process.env.INNGEST_SIGNING_KEY)

export const inngest = new Inngest({
  id: 'lure-expert',
  ...(eventKey ? { eventKey } : {}),
  ...(signingKey ? { signingKey } : {}),
})

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
