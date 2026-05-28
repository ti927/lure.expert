import { PluggyClient } from 'pluggy-sdk'

// Singleton do cliente Pluggy.
//
// Uso apenas no servidor (server actions, server components, jobs Inngest).
// As credenciais (PLUGGY_CLIENT_ID/SECRET) NUNCA podem chegar ao browser —
// o widget de Connect no cliente usa um connect_token de curta duração
// gerado por createConnectToken().

let _client: PluggyClient | null = null

// Remove BOM (U+FEFF), zero-width (U+200B..U+200D), NBSP e qualquer whitespace
// nas pontas da credencial. O painel da Vercel às vezes deixa passar esses
// caracteres quando o valor é colado de um editor com BOM ou de uma página web.
// Um único caractere invisível no PLUGGY_CLIENT_ID faz a Pluggy responder
// 400 "clientId must be a UUID" — o erro chega como HTTPError do got dentro do
// build minificado, difícil de rastrear. Usa code points (sem invisíveis no fonte).
function sanitizeSecret(raw: string | undefined): string {
  if (!raw) return ''
  const isJunk = (ch: string): boolean => {
    const code = ch.charCodeAt(0)
    return (
      code <= 0x20 ||      // controle + espaço
      code === 0xa0 ||     // NBSP
      code === 0xfeff ||   // BOM / ZWNBSP
      code === 0x200b ||   // zero-width space
      code === 0x200c ||   // zero-width non-joiner
      code === 0x200d      // zero-width joiner
    )
  }
  let start = 0
  let end = raw.length
  while (start < end && isJunk(raw[start])) start++
  while (end > start && isJunk(raw[end - 1])) end--
  return raw.slice(start, end)
}

export function getPluggyClient(): PluggyClient {
  if (_client) return _client

  const clientId = sanitizeSecret(process.env.PLUGGY_CLIENT_ID)
  const clientSecret = sanitizeSecret(process.env.PLUGGY_CLIENT_SECRET)

  if (!clientId || !clientSecret) {
    throw new Error(
      'PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET precisam estar definidos no ambiente.',
    )
  }

  _client = new PluggyClient({ clientId, clientSecret })
  return _client
}

export const PLUGGY_ENVIRONMENT =
  (process.env.PLUGGY_ENVIRONMENT as 'sandbox' | 'production' | undefined) ?? 'sandbox'

// Conectores genéricos do Pluggy (MeuPluggy, Sandbox) onde connector.isSandbox
// vem inconsistente. Quando o conector tem um desses nomes, forçamos o badge
// sandbox no UI. Não bloqueamos esses conectores — no plano trial da Pluggy,
// MeuPluggy é o único que funciona em sandbox.
const GENERIC_CONNECTOR_NAMES = ['MeuPluggy', 'Sandbox']

export function isGenericPluggyConnector(name: string): boolean {
  return GENERIC_CONNECTOR_NAMES.includes(name)
}

/**
 * Gera um connect_token de curta duração para o widget no browser.
 * Pode ser amarrado a um itemId existente (modo "atualizar credenciais")
 * ou criar item novo quando itemId for omitido.
 *
 * O webhookUrl é onde o Pluggy avisa quando o item passa por mudanças
 * (CONNECTING → UPDATING → UPDATED / LOGIN_ERROR). Implementado na próxima sessão.
 */
export async function createConnectToken(params?: {
  itemId?: string
  webhookUrl?: string
  clientUserId?: string
}) {
  const client = getPluggyClient()
  return client.createConnectToken(params?.itemId, {
    webhookUrl: params?.webhookUrl,
    clientUserId: params?.clientUserId,
  })
}
