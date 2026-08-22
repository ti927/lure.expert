import type { Metadata } from 'next'
import { getFluxoData } from '@/server/fluxo'
import { getFluxoMensalData } from '@/server/fluxo-mensal'
import { getCostCenters, getBusinessUnits, getLegalEntities, getLeafCategories, getContactOptions } from '@/server/dimensions'
import { FluxoClient } from './fluxo-client'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export const metadata: Metadata = { title: 'Fluxo de Caixa' }

function defaultMensalRange() {
  const now = new Date()
  const y0 = now.getFullYear()
  const m0 = now.getMonth() // 0-indexed
  // 11 meses atrás (1º dia)
  let fy = y0, fm = m0 - 11
  if (fm < 0) { fm += 12; fy -= 1 }
  // último dia do mês atual
  const lastDay = new Date(y0, m0 + 1, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    from: `${fy}-${pad(fm + 1)}-01`,
    to:   `${y0}-${pad(m0 + 1)}-${pad(lastDay)}`,
  }
}

export default async function FluxoPage() {
  const { from, to } = defaultMensalRange()
  const mesAtual = format(new Date(), 'MMMM yyyy', { locale: ptBR })

  const [data, mensalData, costCenters, businessUnits, legalEntities, leafCategories, contactOptions] =
    await Promise.all([
      getFluxoData(),
      getFluxoMensalData({ from, to }),
      getCostCenters(),
      getBusinessUnits(),
      getLegalEntities(),
      getLeafCategories(),
      getContactOptions(),
    ])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Fluxo de Caixa</h1>
        <p className="text-sm text-muted-foreground mt-1 capitalize">
          {mesAtual} · projeção baseada em recorrências detectadas
        </p>
      </div>
      <FluxoClient
        data={data}
        initialMensal={mensalData}
        initialFrom={from}
        initialTo={to}
        costCenters={costCenters.filter(c => c.isActive)}
        businessUnits={businessUnits.filter(b => b.isActive)}
        legalEntities={legalEntities.filter(l => l.isActive)}
        leafCategories={leafCategories}
        contactOptions={contactOptions}
      />
    </div>
  )
}
