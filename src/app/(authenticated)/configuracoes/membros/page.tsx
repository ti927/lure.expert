import type { Metadata } from 'next'
import { getMembros } from '@/server/members'
import { MembersManager } from '@/components/settings/members-manager'

export const metadata: Metadata = { title: 'Membros' }
export const dynamic = 'force-dynamic'

export default async function MembrosPage() {
  const dados = await getMembros()

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Membros</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Quem acessa esta organização e com qual papel. Convide pelo e-mail — quem não tem
          conta recebe um link para criar a senha.
        </p>
      </div>

      <MembersManager {...dados} />
    </div>
  )
}
