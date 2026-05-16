'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { organizations, memberships } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { redirect } from 'next/navigation'

const schema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres').max(200),
  cnpj: z.string().optional(),
  sector: z.string().optional(),
})

export type UpdateOrgState = { success?: boolean; error?: string | null }

export async function updateOrganization(
  _prevState: UpdateOrgState,
  formData: FormData,
): Promise<UpdateOrgState> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const parsed = schema.safeParse({
    orgId: formData.get('orgId'),
    name: formData.get('name'),
    cnpj: formData.get('cnpj') || undefined,
    sector: formData.get('sector') || undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { orgId, name, cnpj, sector } = parsed.data

  // Confirma que o usuário é membro desta organização antes de atualizar
  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.organizationId, orgId),
        isNotNull(memberships.acceptedAt),
      ),
    )
    .limit(1)

  if (!membership) return { error: 'Acesso negado.' }

  await db
    .update(organizations)
    .set({
      name,
      cnpj: cnpj || null,
      settings: { sector: sector || null },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId))

  return { success: true }
}
