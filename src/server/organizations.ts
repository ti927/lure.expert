'use server'

// A organização ativa: listar as do usuário e trocar a atual.
//
// O cookie `lure_org` PROPÕE; a membership aceita DISPÕE — `trocarOrganizacao`
// valida o vínculo antes de gravar, e `resolverOrganizacaoAtiva` revalida em
// TODA requisição (cookie de organização de onde o usuário saiu cai no
// fallback em silêncio). Gravar cookie só pode acontecer aqui, em server
// action — server component não escreve cookie.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { eq, and, isNotNull } from 'drizzle-orm'
import { db } from '@/db'
import { memberships } from '@/db/schema'
import { createClient } from '@/lib/supabase/server'
import { ORG_COOKIE } from '@/lib/auth-context'
import { organizacoesComNome } from '@/lib/members'

export interface OrganizacaoDoUsuario {
  id: string
  nome: string
  papel: string
}

/** As organizações com vínculo ACEITO, na ordem estável do fallback. */
export async function getOrganizacoesDoUsuario(): Promise<OrganizacaoDoUsuario[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return organizacoesComNome(user.id)
}

/**
 * Troca a organização ativa e leva ao dashboard — a tela atual pode não fazer
 * sentido na organização nova (um `/upload/[id]/review` de outra empresa, por
 * exemplo), então recomeçar do dashboard é o único destino sempre válido.
 */
export async function trocarOrganizacao(organizationId: string): Promise<{ erro?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  if (!z.string().uuid().safeParse(organizationId).success) {
    return { erro: 'Organização não encontrada.' }
  }

  const [vinculo] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(
      eq(memberships.userId, user.id),
      eq(memberships.organizationId, organizationId),
      isNotNull(memberships.acceptedAt),
    ))
    .limit(1)
  // Mesma resposta para "não existe" e "não é sua": nada de oráculo de ids.
  if (!vinculo) return { erro: 'Organização não encontrada.' }

  cookies().set(ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
