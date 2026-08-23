// A decisão do formulário de consentimento.
//
// Route handler, e não server action, por um motivo só: o que esta rota faz de
// mais importante é um 303 para um endereço EXTERNO combinado com o cliente
// OAuth. Um handler emite esse redirecionamento nativamente; uma server action
// depende de o roteador do cliente traduzi-lo, e essa é a última tradução que
// convém introduzir no passo mais crítico do fluxo.
//
// Fica em `/oauth/*` e não em `/api/oauth/*` porque autentica por COOKIE. A
// separação vale como regra: `/oauth/*` é humano e passa pelo middleware;
// `/api/oauth/*` é máquina, não vê cookie nenhum e fica fora dele.

import { createClient } from '@/lib/supabase/server'
import { organizacoesDoUsuario } from '@/lib/query/scope'
import { lerPedido, urlDeErro, urlDeSucesso } from '@/lib/oauth/authorize-request'
import { baseUrlDe } from '@/lib/oauth/metadata'
import { origemPropria } from '@/lib/oauth/http'
import { criarCodigo, registrarEventoOauth } from '@/lib/oauth/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function paraUrl(url: string): Response {
  return new Response(null, { status: 303, headers: { Location: url, 'Cache-Control': 'no-store' } })
}

function textoSimples(mensagem: string, status: number): Response {
  return new Response(mensagem, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function POST(req: Request) {
  const base = baseUrlDe(req)

  // Esta rota autentica por cookie, então é passível de CSRF. Nenhuma das rotas
  // de `/api/oauth/*` precisa disto — lá a credencial vai no corpo, de propósito.
  if (!origemPropria(req, base)) {
    return textoSimples('Requisição de origem externa recusada.', 403)
  }

  const form = await req.formData()
  const campos: Record<string, string> = {}
  form.forEach((v, k) => {
    // `org` é multivalorado e sai por `getAll`; achatá-lo aqui perderia todas as
    // empresas menos a última.
    if (k !== 'org' && typeof v === 'string') campos[k] = v
  })

  // As MESMAS regras da tela. Reaproveitar em vez de reescrever é o que impede o
  // formulário de conceder algo que a página teria recusado.
  const leitura = await lerPedido(campos, base)
  if (leitura.status === 'fatal') return textoSimples(leitura.mensagem, 400)
  if (leitura.status === 'erro') return paraUrl(leitura.url)

  const { pedido } = leitura

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const qs = new URLSearchParams(campos)
    qs.delete('decisao')
    return paraUrl(`${base}/login?next=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`)
  }

  if (form.get('decisao') !== 'aprovar') {
    return paraUrl(urlDeErro(pedido.redirectUri, 'access_denied',
      'O usuário não autorizou o acesso.', pedido.state))
  }

  // O formulário PROPÕE organizações; quem DISPÕE é a membership viva. Confiar
  // no que voltou do navegador seria o mesmo erro do webhook SEFAZ, que resolve
  // a organização pelo CNPJ que vem na requisição.
  const permitidas = new Set((await organizacoesDoUsuario(user.id)).map(v => v.organizationId))
  const escolhidas = form.getAll('org').map(String).filter(id => permitidas.has(id))

  if (escolhidas.length === 0) {
    const qs = new URLSearchParams(campos)
    qs.delete('decisao')
    qs.set('erro', 'sem_empresa')
    return paraUrl(`${base}/oauth/authorize?${qs.toString()}`)
  }

  const codigo = await criarCodigo({
    clientId: pedido.clientId,
    userId: user.id,
    redirectUri: pedido.redirectUri,
    codeChallenge: pedido.codeChallenge,
    scopes: pedido.scopes,
    organizationIds: escolhidas,
    resource: pedido.resource,
  })

  await registrarEventoOauth({
    organizationIds: escolhidas,
    tipo: 'mcp_consent_granted',
    userId: user.id,
    clientId: pedido.clientId,
    clientName: pedido.clientName,
    scopes: pedido.scopes,
  })

  return paraUrl(urlDeSucesso(pedido.redirectUri, codigo, pedido.state))
}
