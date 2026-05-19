import { getDreData } from '@/server/dre'
import { EmptyState } from '@/components/states/empty-state'
import { BarChart3 } from 'lucide-react'

// Últimos 12 meses a partir de hoje
function defaultRange() {
  const to    = new Date()
  const from  = new Date()
  from.setMonth(from.getMonth() - 11)
  from.setDate(1)

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  return { from: fmt(from), to: fmt(to) }
}

export default async function DrePage() {
  const { from, to } = defaultRange()
  const data = await getDreData({ from, to })

  const hasData = data.rows.length > 0

  if (!hasData) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">DRE</h1>
          <p className="text-sm text-muted-foreground mt-1">Demonstrativo de Resultado do Exercício</p>
        </div>
        <EmptyState
          icon={<BarChart3 className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Sem dados para o período"
          description="Categorize suas transações para que o expert monte o demonstrativo automaticamente."
        />
      </div>
    )
  }

  // Validação temporária — substituída pelo DRE real na Sessão 5.A
  const lastMonth = data.subtotals.at(-1)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">DRE</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Demonstrativo de Resultado do Exercício · {from} até {to}
        </p>
      </div>

      {/* Diagnóstico de query — remove na Sessão 5.A */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm space-y-2">
        <p className="font-medium text-amber-800">Sessão 5.0 — validação de query</p>
        <p className="text-amber-700">
          {data.rows.length} linhas · {data.months.length} meses ({data.months[0]} → {data.months.at(-1)})
        </p>
        {lastMonth && (
          <div className="text-amber-700 space-y-1">
            <p className="font-medium">{lastMonth.month}:</p>
            <p>Receita bruta: R$ {lastMonth.receitaBruta.toFixed(2)}</p>
            <p>Receita líquida: R$ {lastMonth.receitaLiquida.toFixed(2)}</p>
            <p>Lucro bruto: R$ {lastMonth.lucroBruto.toFixed(2)}</p>
            <p>EBITDA: R$ {lastMonth.ebitda.toFixed(2)}</p>
            <p>Lucro líquido: R$ {lastMonth.lucroLiquido.toFixed(2)}</p>
          </div>
        )}
      </div>
    </div>
  )
}
