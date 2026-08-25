'use server'

import { z } from 'zod'
import { db } from '@/db'
import { organizations } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getAuthContext } from '@/lib/auth-context'
import { recusaDePapel } from '@/lib/members-types'

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
  const { organizationId, papel } = await getAuthContext()

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

  // Só a organização ATIVA — um orgId de outra organização do próprio usuário
  // também é recusado, porque o formulário só existe na tela da ativa.
  if (orgId !== organizationId) return { error: 'Acesso negado.' }

  // Ponto v1 da matriz (4.B): dados da empresa são do proprietário.
  const recusa = recusaDePapel(papel, 'owner', 'alterar os dados da empresa')
  if (recusa) return { error: recusa }

  // MERGE nos settings, não substituição: gravar `{ sector }` cru apagaria
  // `autoCategorize` — defeito latente desde a 1.7, achado nesta consolidação.
  const [atual] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
  const settings = (atual?.settings ?? {}) as Record<string, unknown>

  await db
    .update(organizations)
    .set({
      name,
      cnpj: cnpj || null,
      settings: { ...settings, sector: sector || null },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId))

  return { success: true }
}
