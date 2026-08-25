import type { Metadata } from 'next'
import { db } from '@/db'
import { costCenters } from '@/db/schema'
import { getAuthContext } from '@/lib/auth-context'

export const metadata: Metadata = { title: 'Centros de Custo' }
import { eq } from 'drizzle-orm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DimensionManager } from '@/components/settings/dimension-manager'
import { CsvImportButton } from '@/components/settings/csv-import-button'
import {
  createCostCenter,
  updateCostCenter,
  toggleCostCenterActive,
  deleteCostCenter,
  getCostCenterLinkedCount,
} from '@/server/dimensions'

export default async function CentrosDeCustoPage() {
  const { organizationId } = await getAuthContext()

  const items = await db
    .select()
    .from(costCenters)
    .where(eq(costCenters.organizationId, organizationId))

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Centros de custo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Classifique lançamentos por departamento ou setor da empresa.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Centros de custo</CardTitle>
              <CardDescription className="mt-1.5">
                Cada lançamento pode ser atribuído a um centro de custo para análise por área.
              </CardDescription>
            </div>
            <CsvImportButton kind="centros-de-custo" />
          </div>
        </CardHeader>
        <CardContent>
          <DimensionManager
            items={items}
            title="Centros de custo"
            singularLabel="Centro de custo"
            onCreate={createCostCenter}
            onUpdate={updateCostCenter}
            onToggleActive={toggleCostCenterActive}
            onDelete={deleteCostCenter}
            getLinkedCount={getCostCenterLinkedCount}
          />
        </CardContent>
      </Card>
    </div>
  )
}
