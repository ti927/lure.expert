import type { Metadata } from 'next'
import { getAuthContext } from '@/lib/auth-context'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AllocationTemplateManager } from '@/components/settings/allocation-template-manager'
import { listAllocationTemplates } from '@/server/allocation-templates'
import {
  getCostCenters, getBusinessUnits, getLegalEntities, getContactOptions,
} from '@/server/dimensions'

export const metadata: Metadata = { title: 'Modelos de Rateio' }

export default async function ModelosDeRateioPage() {
  await getAuthContext()

  // Inclui arquivados: é esta tela que os reativa.
  const [templates, ccs, bus, les, cts] = await Promise.all([
    listAllocationTemplates(true),
    getCostCenters(),
    getBusinessUnits(),
    getLegalEntities(),
    getContactOptions(),
  ])

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Modelos de rateio</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Divisões que você repete, salvas para reaplicar em um clique.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Modelos</CardTitle>
          <CardDescription className="mt-1.5">
            Um modelo guarda a <strong>proporção</strong>, não os valores — por isso serve para
            lançamentos de qualquer tamanho. Ao aplicar, os centavos são fechados para o lançamento
            em questão, e a soma das partes bate exatamente com ele.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AllocationTemplateManager
            templates={templates}
            costCenters={ccs.filter(c => c.isActive)}
            businessUnits={bus.filter(c => c.isActive)}
            legalEntities={les.filter(c => c.isActive)}
            contacts={cts}
          />
        </CardContent>
      </Card>
    </div>
  )
}
