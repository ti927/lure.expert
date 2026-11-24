import type { Metadata } from 'next'
import { ErrorState } from '@/components/states/error-state'
import { getAnaliseFornecedores } from '@/server/fornecedores'
import { FornecedoresClient } from './fornecedores-client'

export const metadata: Metadata = { title: 'Fornecedores' }

const DATA = /^\d{4}-\d{2}-\d{2}$/

/** Hoje em Brasília, como YYYY-MM-DD. */
function hojeBR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/** Padrão: os 12 meses até hoje (do dia 1º de 11 meses atrás). */
function inicioPadrao(hoje: string): string {
  const [a, m] = hoje.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 - 11, 1))
  return d.toISOString().slice(0, 10)
}

export default async function FornecedoresPage({ searchParams }: { searchParams: { de?: string; ate?: string } }) {
  const hoje = hojeBR()
  const de = searchParams.de && DATA.test(searchParams.de) ? searchParams.de : inicioPadrao(hoje)
  const ate = searchParams.ate && DATA.test(searchParams.ate) ? searchParams.ate : hoje
  const r = await getAnaliseFornecedores({ de, ate })

  if ('error' in r) {
    return (
      <div className="p-6">
        <ErrorState title="Período inválido" description="A data inicial precisa ser anterior à final. Ajuste o período e tente de novo." />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <FornecedoresClient
        key={`${de}|${ate}`}
        periodo={{ de, ate }}
        hoje={hoje}
        lancamentos={r.lancamentos}
        mesaInicial={r.mesa}
        podeEditar={r.podeEditar}
      />
    </div>
  )
}
