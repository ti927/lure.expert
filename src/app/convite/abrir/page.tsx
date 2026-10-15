// Onde cai o link de convite COPIADO pela tela de membros (e mandado por
// WhatsApp, por exemplo). Não consome o token: só o clique em "Continuar" leva
// a `/auth/confirm`, que roda o `verifyOtp`.
//
// Existe porque o WhatsApp — e os antivírus de e-mail — abrem o endereço para
// montar a pré-visualização. Se o link apontasse direto para `/auth/confirm`,
// essa visita automática gastaria o token e a pessoa encontraria "link
// expirado" no primeiro clique. Um formulário GET não é seguido por quem só lê
// a página.
//
// Pública e fora do `(authenticated)`: quem chega aqui ainda não tem sessão.

import type { Metadata } from 'next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Convite', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default function AbrirConvitePage({
  searchParams,
}: {
  searchParams: { token_hash?: string; type?: string }
}) {
  const tokenHash = searchParams.token_hash
  const valido = Boolean(tokenHash) && searchParams.type === 'invite'

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-md">
        <CardHeader className="space-y-1">
          <div className="mb-2 text-2xl font-bold text-primary">lure.expert</div>
          <CardTitle className="text-xl">Você foi convidado</CardTitle>
          <CardDescription>
            {valido
              ? 'Continue para criar a sua senha e acessar a empresa.'
              : 'Este link está incompleto. Peça um novo link a quem convidou você.'}
          </CardDescription>
        </CardHeader>
        {valido && (
          <CardContent>
            <form action="/auth/confirm" method="get">
              <input type="hidden" name="token_hash" value={tokenHash} />
              <input type="hidden" name="type" value="invite" />
              <input type="hidden" name="next" value="/convite/definir-senha" />
              <Button type="submit" className="w-full">Continuar</Button>
            </form>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
