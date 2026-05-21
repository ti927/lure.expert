import { PluggyClient } from 'pluggy-sdk'

// Singleton do cliente Pluggy.
//
// Uso apenas no servidor (server actions, server components, jobs Inngest).
// As credenciais (PLUGGY_CLIENT_ID/SECRET) NUNCA podem chegar ao browser —
// o widget de Connect no cliente usa um connect_token de curta duração
// gerado por createConnectToken().

let _client: PluggyClient | null = null

export function getPluggyClient(): PluggyClient {
  if (_client) return _client

  const clientId = process.env.PLUGGY_CLIENT_ID
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET

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
