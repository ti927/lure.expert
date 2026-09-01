'use server'

import { db } from '@/db'
import { organizations } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getAuthContext } from '@/lib/auth-context'
import {
  agendaDeSyncSchema, lerAgenda, descreverAgenda, CHAVE_DE_AGENDA,
  type AgendaDeSync,
} from '@/lib/sync-schedule'

export async function getAutoCategorize(): Promise<boolean> {
  const { organizationId } = await getAuthContext()
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
  const s = (org?.settings ?? {}) as Record<string, unknown>
  return s.autoCategorize !== false
}

export async function setAutoCategorize(enabled: boolean): Promise<void> {
  const { organizationId } = await getAuthContext()
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
  const s = (org?.settings ?? {}) as Record<string, unknown>
  await db
    .update(organizations)
    .set({ settings: { ...s, autoCategorize: enabled }, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId))
}

// ─── Agenda de sincronização dos bancos ──────────────────────────────────────
// A regra e o texto vivem em `@/lib/sync-schedule`, que o CRON também importa —
// a tela e o despacho leem a mesma agenda pela mesma função. Sem papel exigido,
// para ficar coerente com `setAutoCategorize`, que é o irmão no mesmo card.

export async function getAgendaDeSync(): Promise<AgendaDeSync> {
  const { organizationId } = await getAuthContext()
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
  return lerAgenda(org?.settings)
}

export async function setAgendaDeSync(
  agenda: AgendaDeSync,
): Promise<{ error: string } | { success: true; descricao: string }> {
  const parsed = agendaDeSyncSchema.safeParse(agenda)
  if (!parsed.success) {
    return { error: parsed.error.issues.map(i => i.message).join(' ') }
  }

  const { organizationId } = await getAuthContext()
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)

  // Merge, nunca substituição: o `settings` carrega `autoCategorize` junto, e
  // trocar o objeto inteiro apagaria a preferência do vizinho — foi exatamente
  // o defeito que a 4.B achou em `updateOrganization`.
  const s = (org?.settings ?? {}) as Record<string, unknown>
  await db
    .update(organizations)
    .set({ settings: { ...s, [CHAVE_DE_AGENDA]: parsed.data }, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId))

  revalidatePath('/configuracoes')
  return { success: true, descricao: descreverAgenda(parsed.data) }
}
