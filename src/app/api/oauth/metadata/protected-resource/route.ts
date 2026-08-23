// RFC 9728 — servido em /.well-known/oauth-protected-resource via rewrite.
//
// É o documento para o qual o 401 do servidor MCP aponta: o cliente bate sem
// token, recebe o `WWW-Authenticate`, lê isto e descobre onde se autorizar.

import { baseUrlDe, metadataDoRecurso } from '@/lib/oauth/metadata'
import { respostaMetadata, preflight } from '@/lib/oauth/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return respostaMetadata(metadataDoRecurso(baseUrlDe(req)))
}

export async function OPTIONS() {
  return preflight()
}
