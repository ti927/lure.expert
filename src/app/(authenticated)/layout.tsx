export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/layout/app-shell'
import { db } from '@/db'
import { memberships } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { getInvoicePendingCount } from '@/server/invoices'

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)

  if (!membership) redirect('/onboarding')

  const nfePendingCount = await getInvoicePendingCount().catch(() => 0)

  return (
    <AppShell user={{ id: user.id, email: user.email ?? '' }} nfePendingCount={nfePendingCount}>
      {children}
    </AppShell>
  )
}
