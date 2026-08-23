// A tela de consentimento.
//
// Página autenticada normal, e três coisas saem de graça disso: a sessão já
// existe (nada de um segundo sistema de login), `redirect('/login')` é legal
// aqui porque é página e não resposta JSON-RPC, e o multi-select das
// organizações lê a mesma `memberships` que o resto do app.
//
// Fora do route group `(authenticated)` de propósito: aquele layout embrulha
// tudo no AppShell, e barra lateral com navegação numa tela de consentimento
// convida o usuário a sair pelo meio de um fluxo de autorização.

export const dynamic = 'force-dynamic'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { inArray } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { organizations } from '@/db/schema'
import { organizacoesDoUsuario } from '@/lib/query/scope'
import { lerPedido } from '@/lib/oauth/authorize-request'
import { baseUrlDe } from '@/lib/oauth/metadata'
import { ESCOPO_DESCRICAO } from '@/lib/oauth/clients'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-lg">{children}</div>
    </main>
  )
}

function Recusa({ mensagem }: { mensagem: string }) {
  return (
    <Moldura>
      <Card>
        <CardHeader>
          <div className="mb-2 text-xl font-bold text-primary">lure.expert</div>
          <CardTitle className="text-lg">Não foi possível autorizar</CardTitle>
          <CardDescription>{mensagem}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nada foi concedido. Você pode fechar esta janela e tentar conectar novamente
            pelo aplicativo de origem.
          </p>
        </CardContent>
      </Card>
    </Moldura>
  )
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const base = baseUrlDe(headers())
  const leitura = await lerPedido(searchParams, base)

  // Erro no par (cliente, redirect): não redireciona. Mostrar é a única saída
  // segura — mandar de volta para um destino não provado é o ataque.
  if (leitura.status === 'fatal') return <Recusa mensagem={leitura.mensagem} />
  if (leitura.status === 'erro') redirect(leitura.url)

  const { pedido } = leitura

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // Volta para cá DEPOIS do login, com o pedido inteiro — sem isso, quem chega
    // sem sessão perde os parâmetros do claude.ai no caminho e cai no dashboard
    // sem entender por que a conexão não fechou.
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(searchParams)) {
      if (typeof v === 'string') qs.set(k, v)
      else if (Array.isArray(v) && v[0]) qs.set(k, v[0])
    }
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`)
  }

  const vinculos = await organizacoesDoUsuario(user.id)
  if (vinculos.length === 0) {
    return <Recusa mensagem="Sua conta ainda não tem empresa. Conclua o cadastro antes de conectar um aplicativo." />
  }

  const nomes = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(inArray(organizations.id, vinculos.map(v => v.organizationId)))

  const porId = new Map(nomes.map(n => [n.id, n.name]))
  const lista = vinculos.map(v => ({
    id: v.organizationId,
    nome: porId.get(v.organizationId) ?? 'Empresa sem nome',
    papel: v.role,
  }))

  const hostDeRetorno = new URL(pedido.redirectUri).host

  return (
    <Moldura>
      <Card>
        <CardHeader>
          <div className="mb-2 text-xl font-bold text-primary">lure.expert</div>
          <CardTitle className="text-lg">
            Conectar <span className="text-primary">{pedido.clientName}</span>
          </CardTitle>
          <CardDescription>
            Um aplicativo externo está pedindo acesso aos seus dados financeiros. Ele devolverá
            a resposta para <span className="font-medium text-foreground">{hostDeRetorno}</span>.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form method="POST" action="/oauth/authorize/decidir" className="space-y-6">
            {searchParams.erro === 'sem_empresa' ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                Marque ao menos uma empresa para autorizar o acesso.
              </p>
            ) : null}

            <input type="hidden" name="client_id"     value={pedido.clientId} />
            <input type="hidden" name="redirect_uri"  value={pedido.redirectUri} />
            <input type="hidden" name="code_challenge" value={pedido.codeChallenge} />
            <input type="hidden" name="code_challenge_method" value="S256" />
            <input type="hidden" name="response_type" value="code" />
            <input type="hidden" name="scope"         value={pedido.scopes.join(' ')} />
            <input type="hidden" name="resource"      value={pedido.resource} />
            {pedido.state ? <input type="hidden" name="state" value={pedido.state} /> : null}

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">O que ele poderá fazer</h2>
              <p className="text-xs text-muted-foreground">
                O aplicativo pediu estas permissões. Você pode conceder menos do que ele pediu —
                a leitura é o mínimo para a conexão existir.
              </p>
              <div className="space-y-1 rounded-md border p-3">
                {pedido.scopes.map(e => (
                  <label
                    key={e}
                    className={`flex gap-3 rounded px-2 py-1.5 ${e === 'leitura' ? '' : 'cursor-pointer hover:bg-muted'}`}
                  >
                    <input
                      type="checkbox"
                      name="escopo"
                      value={e}
                      defaultChecked
                      // Leitura não se desmarca: sem ela não há conexão, e um
                      // consentimento vazio seria uma conexão que não faz nada.
                      disabled={e === 'leitura'}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary disabled:opacity-60"
                    />
                    <span className="text-sm text-muted-foreground">
                      {ESCOPO_DESCRICAO[e]}
                      {e === 'escrita' ? (
                        <span className="block text-xs">
                          Toda alteração continua passando por uma prévia que você aprova na conversa.
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Em quais empresas</h2>
              <p className="text-xs text-muted-foreground">
                O acesso vale apenas para o que você marcar aqui. As demais permanecem
                invisíveis para este aplicativo.
              </p>
              <div className="space-y-1 rounded-md border p-3">
                {lista.map((o, i) => (
                  <label key={o.id} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-muted">
                    <input
                      type="checkbox"
                      name="org"
                      value={o.id}
                      defaultChecked={lista.length === 1 || i === 0}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span className="text-sm">{o.nome}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{o.papel}</span>
                  </label>
                ))}
              </div>
            </section>

            <p className="text-xs text-muted-foreground">
              Você pode desconectar quando quiser em Configurações · Conexões. Toda ação que
              alterar dados continuará pedindo confirmação antes de ser aplicada.
            </p>

            <div className="flex gap-3">
              <Button type="submit" name="decisao" value="negar" variant="outline" className="flex-1">
                Cancelar
              </Button>
              <Button type="submit" name="decisao" value="aprovar" className="flex-1">
                Autorizar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </Moldura>
  )
}
