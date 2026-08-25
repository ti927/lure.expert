// Cliente Supabase com a service role — o único caminho do app até a API
// administrativa do Auth (criar usuário convidado, por exemplo).
//
// Server-only por convenção, como `auth-context.ts`: a service role ignora RLS
// e NUNCA pode chegar ao navegador (regra do CLAUDE.md). Nenhum componente de
// cliente importa este módulo; se um dia importar, o segredo vaza no bundle.
//
// `sanitizeKey` pela mesma razão dos incidentes Anthropic e Pluggy: chave
// colada no painel da Vercel com BOM/zero-width quebra o header HTTP com um
// TypeError de ByteString que não aponta para a causa.

import { createClient as criarCliente, type SupabaseClient } from '@supabase/supabase-js'
import { sanitizeKey } from '@/lib/anthropic'

let cliente: SupabaseClient | null | undefined

/**
 * Devolve `null` em vez de lançar quando `SUPABASE_SERVICE_ROLE_KEY` não
 * existe: só o fluxo de convite precisa dela, e um `throw` na importação
 * derrubaria páginas que nunca a usam. Quem chama traduz o `null` num erro
 * acionável ("configure a variável").
 */
export function supabaseAdmin(): SupabaseClient | null {
  if (cliente !== undefined) return cliente
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = sanitizeKey(process.env.SUPABASE_SERVICE_ROLE_KEY)
  cliente = url && chave
    ? criarCliente(url, chave, { auth: { autoRefreshToken: false, persistSession: false } })
    : null
  return cliente
}
