import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Usuário já tem organização — vai pro dashboard
  const [existing] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)

  if (existing) redirect('/dashboard')

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      {children}
    </div>
  )
}
