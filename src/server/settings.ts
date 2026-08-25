'use server'

import { db } from '@/db'
import { organizations } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getAuthContext } from '@/lib/auth-context'

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
