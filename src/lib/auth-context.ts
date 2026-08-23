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
import { eq, and, isNotNull, asc } from 'drizzle-orm'

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

  // `orderBy` explícito: `.limit(1)` sem ordem deixa o Postgres escolher, e um
  // usuário com duas organizações receberia uma arbitrária — que poderia mudar
  // entre requisições. Hoje todo usuário tem exatamente uma, então isto é
  // defesa contra o dia em que convites existirem (Fase 4), não correção de bug
  // ativo. As outras 21 cópias desta lógica em `src/server/` continuam sem a
  // ordem; elas serão consolidadas aqui quando a organização ativa entrar.
  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .orderBy(asc(memberships.createdAt), asc(memberships.organizationId))
    .limit(1)
  if (!membership) redirect('/onboarding')

  return { userId: user.id, organizationId: membership.organizationId }
}
