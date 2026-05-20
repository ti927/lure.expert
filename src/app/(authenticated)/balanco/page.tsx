import type { Metadata } from 'next'
import { getBpAllDates } from '@/server/balance-sheet'
import { BalancoClient } from './balanco-client'

export const metadata: Metadata = { title: 'Balanço Patrimonial' }

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).toISOString().split('T')[0]
}

function defaultRange() {
  const now = new Date()
  const toYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const fromDate = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1)
  const fromYM = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`
  return { fromYM, toYM }
}

export default async function BalancoPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string }
}) {
  const { fromYM: defaultFrom, toYM: defaultTo } = defaultRange()
  const fromYM = searchParams.from ?? defaultFrom
  const toYM   = searchParams.to   ?? defaultTo

  const fromDate = `${fromYM}-01`
  const toDate   = lastDayOfMonth(toYM)

  const data = await getBpAllDates(fromDate, toDate)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Balanço Patrimonial</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visão consolidada de Ativos, Passivos e Patrimônio Líquido a partir dos relatórios importados.
        </p>
      </div>

      <BalancoClient
        data={data}
        defaultFrom={fromYM}
        defaultTo={toYM}
        hasUrlParams={Boolean(searchParams.from || searchParams.to)}
      />
    </div>
  )
}
