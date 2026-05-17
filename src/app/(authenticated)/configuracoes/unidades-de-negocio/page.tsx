import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, businessUnits } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DimensionManager } from '@/components/settings/dimension-manager'
import {
  createBusinessUnit,
  updateBusinessUnit,
  toggleBusinessUnitActive,
  deleteBusinessUnit,
  getBusinessUnitLinkedCount,
} from '@/server/dimensions'

export default async function UnidadesDeNegocioPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!membership) redirect('/onboarding')

  const items = await db
    .select()
    .from(businessUnits)
    .where(eq(businessUnits.organizationId, membership.organizationId))

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Unidades de negócio</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Classifique lançamentos por unidade operacional — restaurante, hotel, eventos, etc.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Unidades de negócio</CardTitle>
          <CardDescription>
            Cada lançamento pode ser atribuído a uma unidade para análise segmentada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DimensionManager
            items={items}
            title="Unidades de negócio"
            singularLabel="Unidade de negócio"
            onCreate={createBusinessUnit}
            onUpdate={updateBusinessUnit}
            onToggleActive={toggleBusinessUnitActive}
            onDelete={deleteBusinessUnit}
            getLinkedCount={getBusinessUnitLinkedCount}
          />
        </CardContent>
      </Card>
    </div>
  )
}
