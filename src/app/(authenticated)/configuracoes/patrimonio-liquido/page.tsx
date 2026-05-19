import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, equityMovements } from '@/db/schema'
import { eq, and, isNotNull, desc } from 'drizzle-orm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EquityMovementsManager } from '@/components/settings/equity-movements-manager'

export const metadata: Metadata = { title: 'Patrimônio Líquido' }

export default async function PatrimonioLiquidoPage() {
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
    .from(equityMovements)
    .where(eq(equityMovements.organizationId, membership.organizationId))
    .orderBy(desc(equityMovements.date))

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Patrimônio Líquido</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Aportes de capital, retiradas de sócios e distribuição de lucros.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Movimentações de PL</CardTitle>
          <CardDescription>
            Registre cada aporte, retirada ou distribuição de lucro para compor o Patrimônio Líquido no Balanço Patrimonial.
            Movimentações são imutáveis — para corrigir, remova e registre novamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EquityMovementsManager items={items} />
        </CardContent>
      </Card>
    </div>
  )
}
