'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, organizations } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'

async function getOrgId(): Promise<string> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [m] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!m) redirect('/onboarding')

  return m.organizationId
}

export async function getAutoCategorize(): Promise<boolean> {
  const orgId = await getOrgId()
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
  const s = (org?.settings ?? {}) as Record<string, unknown>
  return s.autoCategorize !== false
}

export async function setAutoCategorize(enabled: boolean): Promise<void> {
  const orgId = await getOrgId()
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
  const s = (org?.settings ?? {}) as Record<string, unknown>
  await db
    .update(organizations)
    .set({ settings: { ...s, autoCategorize: enabled }, updatedAt: new Date() })
    .where(eq(organizations.id, orgId))
}
