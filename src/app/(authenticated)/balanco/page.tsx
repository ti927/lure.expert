import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBpData } from '@/server/balance-sheet'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BalancoClient } from './balanco-client'

export const metadata: Metadata = { title: 'Balanço Patrimonial' }

function todayIso() {
  return new Date().toISOString().split('T')[0]
}

export default async function BalancoPage({
  searchParams,
}: {
  searchParams: { date?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const date = searchParams.date ?? ''
  const data = date ? await getBpData(date) : null

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Balanço Patrimonial</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visão consolidada de Ativos, Passivos e Patrimônio Líquido a partir dos relatórios importados.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Posição patrimonial</CardTitle>
          <CardDescription>
            Selecione a data de referência para ver o BP mais recente até essa data.
            Os dados vêm dos relatórios de BP importados em{' '}
            <a href="/upload" className="underline underline-offset-2">Enviar arquivo</a>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BalancoClient
            initialData={data}
            initialDate={date || todayIso()}
          />
        </CardContent>
      </Card>
    </div>
  )
}
