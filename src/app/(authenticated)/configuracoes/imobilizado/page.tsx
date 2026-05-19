import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, fixedAssets } from '@/db/schema'
import { eq, and, isNotNull, desc } from 'drizzle-orm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FixedAssetsManager } from '@/components/settings/fixed-assets-manager'

export const metadata: Metadata = { title: 'Imobilizado' }

export default async function ImobilizadoPage() {
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
    .from(fixedAssets)
    .where(eq(fixedAssets.organizationId, membership.organizationId))
    .orderBy(desc(fixedAssets.acquisitionDate))

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Imobilizado</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bens de uso da empresa — equipamentos, veículos, móveis e imóveis.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Ativos imobilizados</CardTitle>
          <CardDescription>
            Registre o valor atual e a depreciação mensal de cada bem para compor o Ativo Não-Circulante no Balanço Patrimonial.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FixedAssetsManager items={items} />
        </CardContent>
      </Card>
    </div>
  )
}
