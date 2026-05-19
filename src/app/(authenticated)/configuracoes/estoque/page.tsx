import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, inventorySnapshots } from '@/db/schema'
import { eq, and, isNotNull, desc } from 'drizzle-orm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InventorySnapshotsManager } from '@/components/settings/inventory-snapshots-manager'

export const metadata: Metadata = { title: 'Estoque' }

export default async function EstoquePage() {
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
    .from(inventorySnapshots)
    .where(eq(inventorySnapshots.organizationId, membership.organizationId))
    .orderBy(desc(inventorySnapshots.snapshotDate))

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Estoque</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Levantamentos periódicos do valor do estoque para o Balanço Patrimonial.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Snapshots de estoque</CardTitle>
          <CardDescription>
            O snapshot mais recente é usado como valor do Ativo Circulante — Estoque no Balanço Patrimonial.
            Registre mensalmente para manter o BP atualizado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InventorySnapshotsManager items={items} />
        </CardContent>
      </Card>
    </div>
  )
}
