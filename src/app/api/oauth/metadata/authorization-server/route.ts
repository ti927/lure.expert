// RFC 8414 — servido em /.well-known/oauth-authorization-server via rewrite.
//
// É o primeiro documento que o claude.ai busca. Se ele não abrir, nada do resto
// chega a ser tentado.

import { baseUrlDe, metadataDoServidor } from '@/lib/oauth/metadata'
import { respostaMetadata, preflight } from '@/lib/oauth/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return respostaMetadata(metadataDoServidor(baseUrlDe(req)))
}

export async function OPTIONS() {
  return preflight()
}
