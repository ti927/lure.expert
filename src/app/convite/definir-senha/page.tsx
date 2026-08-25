// Onde o convidado NOVO cai depois do link do e-mail: `/auth/confirm` já criou
// a sessão via `verifyOtp`, falta a senha — usuário convidado nasce sem uma.
// Definida a senha, todos os convites pendentes dele são aceitos de uma vez
// (foi o clique naquele e-mail que os comprovou) e ele segue para o dashboard.
//
// Fora do route group `(authenticated)` de propósito: não há organização ativa
// ainda, e o AppShell pressupõe uma.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { convitesPendentesDoUsuario } from '@/lib/members'
import { DefinirSenhaForm } from './definir-senha-form'

export const metadata: Metadata = { title: 'Definir senha' }
export const dynamic = 'force-dynamic'

export default async function DefinirSenhaPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?error=' + encodeURIComponent('Este link expirou ou já foi usado. Peça um novo convite.'))

  const convites = await convitesPendentesDoUsuario(user.id)

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <DefinirSenhaForm
        email={user.email ?? ''}
        empresas={convites.map((c) => c.organizationName)}
      />
    </div>
  )
}
