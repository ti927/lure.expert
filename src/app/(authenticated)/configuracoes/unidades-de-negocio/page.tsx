import type { Metadata } from 'next'
import { db } from '@/db'
import { businessUnits } from '@/db/schema'
import { getAuthContext } from '@/lib/auth-context'

export const metadata: Metadata = { title: 'Unidades de Negócio' }
import { eq } from 'drizzle-orm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DimensionManager } from '@/components/settings/dimension-manager'
import { CsvImportButton } from '@/components/settings/csv-import-button'
import {
  createBusinessUnit,
  updateBusinessUnit,
  toggleBusinessUnitActive,
  deleteBusinessUnit,
  getBusinessUnitLinkedCount,
} from '@/server/dimensions'

export default async function UnidadesDeNegocioPage() {
  const { organizationId } = await getAuthContext()

  const items = await db
    .select()
    .from(businessUnits)
    .where(eq(businessUnits.organizationId, organizationId))

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
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Unidades de negócio</CardTitle>
              <CardDescription className="mt-1.5">
                Cada lançamento pode ser atribuído a uma unidade para análise segmentada.
              </CardDescription>
            </div>
            <CsvImportButton kind="unidades-de-negocio" />
          </div>
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
