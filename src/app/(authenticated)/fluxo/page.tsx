import type { Metadata } from 'next'
import { getFluxoData } from '@/server/fluxo'

export const metadata: Metadata = { title: 'Fluxo de Caixa' }
import { FluxoClient } from './fluxo-client'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export default async function FluxoPage() {
  const data     = await getFluxoData()
  const mesAtual = format(new Date(), 'MMMM yyyy', { locale: ptBR })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Fluxo de Caixa</h1>
        <p className="text-sm text-muted-foreground mt-1 capitalize">
          {mesAtual} · projeção baseada em recorrências detectadas
        </p>
      </div>
      <FluxoClient data={data} />
    </div>
  )
}
