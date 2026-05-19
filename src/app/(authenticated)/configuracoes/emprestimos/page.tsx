import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, loans } from '@/db/schema'
import { eq, and, isNotNull, desc } from 'drizzle-orm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoansManager } from '@/components/settings/loans-manager'

export const metadata: Metadata = { title: 'Empréstimos' }

export default async function EmprestimosPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!membership) redirect('/onboarding')

  const items = await db
    .select()
    .from(loans)
    .where(eq(loans.organizationId, membership.organizationId))
    .orderBy(desc(loans.startDate))

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Empréstimos e financiamentos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Capital de giro, CCB, BNDES, mútuos de sócios e demais passivos financeiros.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Passivos financeiros</CardTitle>
          <CardDescription>
            Registre o saldo devedor atual de cada empréstimo para compor o Passivo Circulante e Não-Circulante no Balanço Patrimonial.
            A separação entre curto e longo prazo é feita pela data de vencimento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoansManager items={items} />
        </CardContent>
      </Card>
    </div>
  )
}
