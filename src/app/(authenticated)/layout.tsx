export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/layout/app-shell'
import { resolverOrganizacaoAtiva, ORG_COOKIE } from '@/lib/auth-context'
import { organizacoesComNome } from '@/lib/members'
import { getInvoicePendingCount } from '@/server/invoices'

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // A MESMA resolução de organização ativa que toda server action usa — o
  // layout não pode discordar das telas sobre qual empresa está aberta.
  const ativa = await resolverOrganizacaoAtiva(user.id, cookies().get(ORG_COOKIE)?.value)
  if (!ativa) redirect('/onboarding')

  const [organizacoes, nfePendingCount] = await Promise.all([
    organizacoesComNome(user.id),
    getInvoicePendingCount().catch(() => 0),
  ])

  return (
    <AppShell
      user={{ id: user.id, email: user.email ?? '' }}
      organizacoes={organizacoes}
      organizacaoAtivaId={ativa.organizationId}
      nfePendingCount={nfePendingCount}
    >
      {children}
    </AppShell>
  )
}
