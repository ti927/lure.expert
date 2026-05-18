import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, legalEntities } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DimensionManager } from '@/components/settings/dimension-manager'
import { CsvImportButton } from '@/components/settings/csv-import-button'
import {
  createLegalEntity,
  updateLegalEntity,
  toggleLegalEntityActive,
  deleteLegalEntity,
  getLegalEntityLinkedCount,
} from '@/server/dimensions'

export default async function EntidadesJuridicasPage() {
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
    .from(legalEntities)
    .where(eq(legalEntities.organizationId, membership.organizationId))

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Entidades jurídicas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Classifique lançamentos por CNPJ — matriz, filiais ou empresas do grupo.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Entidades jurídicas</CardTitle>
              <CardDescription className="mt-1.5">
                Cada lançamento pode ser vinculado a uma pessoa jurídica para análise consolidada ou por entidade.
              </CardDescription>
            </div>
            <CsvImportButton kind="entidades-juridicas" />
          </div>
        </CardHeader>
        <CardContent>
          <DimensionManager
            items={items}
            title="Entidades jurídicas"
            singularLabel="Entidade jurídica"
            showCnpj
            onCreate={createLegalEntity}
            onUpdate={updateLegalEntity}
            onToggleActive={toggleLegalEntityActive}
            onDelete={deleteLegalEntity}
            getLinkedCount={getLegalEntityLinkedCount}
          />
        </CardContent>
      </Card>
    </div>
  )
}
