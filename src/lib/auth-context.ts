// Resolução do usuário logado + organização ativa + papel.
//
// A VERSÃO CANÔNICA, e desde a 4.B a única: as ~21 cópias locais que viviam em
// `src/server/` foram consolidadas aqui — com o seletor de organização, a
// pergunta "qual empresa esta pessoa está olhando?" precisa ter UMA resposta,
// senão uma tela troca de empresa e a outra não.
//
// Sem `'use server'`: a diretiva impede exportar qualquer coisa além de funções
// async, e este módulo é server-only por convenção — importa `next/headers`
// via o client Supabase, então nunca pode ser puxado por um client component.

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { resolverOrganizacaoAtiva } from '@/lib/members'

export { resolverOrganizacaoAtiva }

/** O cookie da organização ativa. Só `trocarOrganizacao` (server action) o escreve. */
export const ORG_COOKIE = 'lure_org'

export interface AuthContext {
  userId:         string
  organizationId: string
  /** O papel do usuário NA organização ativa: owner | admin | member | viewer. */
  papel:          string
}

/**
 * Redireciona para /login sem sessão e para /onboarding sem organização.
 *
 * O `db` do projeto conecta pela `DATABASE_URL` direta, num papel que ignora
 * RLS — o isolamento efetivo em runtime vem do `organizationId` devolvido aqui,
 * aplicado explicitamente em cada query.
 *
 * NÃO escreve o cookie (server component não pode): quem o escreve é a action
 * `trocarOrganizacao`. Cookie ausente ou inválido só significa "use o padrão".
 */
export async function getAuthContext(): Promise<AuthContext> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const cookieValue = cookies().get(ORG_COOKIE)?.value ?? null
  const ativa = await resolverOrganizacaoAtiva(user.id, cookieValue)
  if (!ativa) redirect('/onboarding')

  return { userId: user.id, organizationId: ativa.organizationId, papel: ativa.papel }
}
