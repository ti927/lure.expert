import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { UploadForm } from './upload-form'

export default async function UploadPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!membership) redirect('/onboarding')

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Enviar arquivo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Extratos, relatórios, notas fiscais e outros documentos financeiros
        </p>
      </div>
      <UploadForm orgId={membership.organizationId} />
    </div>
  )
}
