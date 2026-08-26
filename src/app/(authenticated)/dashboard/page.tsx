import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Visão Geral' }

import { Button } from '@/components/ui/button'
import { getEstadoDoPainel } from '@/server/dashboards'
import { getCostCenters, getBusinessUnits, getLegalEntities, getLeafCategories, getContactOptions } from '@/server/dimensions'
import { DashboardGrid } from '@/components/dashboard/dashboard-grid'
import { signOut } from './actions'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'

function isValidMonth(s?: string): s is string {
  return !!s && /^\d{4}-\d{2}$/.test(s)
}

// A rota não mudou de caminho na 5.C — mudou de natureza. `page.tsx` é
// carregador: resolve o painel (o gravado, ou o padrão VIRTUAL de quem não tem
// nenhum), executa os blocos no servidor e entrega tudo pronto para a grade.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { month?: string; painel?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const monthParam = isValidMonth(searchParams.month) ? searchParams.month : undefined

  const [estado, costCenters, businessUnits, legalEntities, leafCategories, contactOptions] =
    await Promise.all([
      getEstadoDoPainel(searchParams.painel, monthParam),
      getCostCenters(),
      getBusinessUnits(),
      getLegalEntities(),
      getLeafCategories(),
      getContactOptions(),
    ])

  const baseDate = monthParam
    ? new Date(Number(monthParam.slice(0, 4)), Number(monthParam.slice(5, 7)) - 1, 1)
    : new Date()
  const selectedMonth = monthParam ?? format(baseDate, 'yyyy-MM')
  const mesAtual = format(baseDate, 'MMMM yyyy', { locale: ptBR })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Visão Geral</h1>
          <p className="text-sm text-muted-foreground mt-1 capitalize">
            {user?.email} · {mesAtual}
          </p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
            Sair
          </Button>
        </form>
      </div>

      <DashboardGrid
        estado={estado}
        selectedMonth={selectedMonth}
        monthRange={{
          from:  format(startOfMonth(baseDate), 'yyyy-MM-dd'),
          to:    format(endOfMonth(baseDate),   'yyyy-MM-dd'),
          label: mesAtual,
        }}
        leafCategories={leafCategories}
        costCenters={costCenters.filter(c => c.isActive)}
        businessUnits={businessUnits.filter(b => b.isActive)}
        legalEntities={legalEntities.filter(l => l.isActive)}
        contactOptions={contactOptions}
      />
    </div>
  )
}
