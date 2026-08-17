// Resolução do usuário logado + organização ativa.
//
// Esta lógica está copiada em 8+ arquivos de `src/server/`. Este módulo é a
// versão canônica; a migração dos arquivos existentes é incremental (refactor
// horizontal de todos de uma vez é risco desnecessário). Por ora, quem usa é
// `src/server/budget.ts`.
//
// Sem `'use server'`: a diretiva impede exportar qualquer coisa além de funções
// async, e este módulo é server-only por convenção — importa `next/headers`
// via o client Supabase, então nunca pode ser puxado por um client component.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'

export interface AuthContext {
  userId:         string
  organizationId: string
}

/**
 * Redireciona para /login sem sessão e para /onboarding sem organização.
 *
 * O `db` do projeto conecta pela `DATABASE_URL` direta, num papel que ignora
 * RLS — o isolamento efetivo em runtime vem do `organizationId` devolvido aqui,
 * aplicado explicitamente em cada query.
 */
export async function getAuthContext(): Promise<AuthContext> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!membership) redirect('/onboarding')

  return { userId: user.id, organizationId: membership.organizationId }
}
