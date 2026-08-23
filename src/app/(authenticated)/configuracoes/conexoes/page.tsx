import type { Metadata } from 'next'
import { listarConexoes } from '@/server/oauth-connections'
import { OauthConnectionsList } from '@/components/settings/oauth-connections-list'

export const metadata: Metadata = { title: 'Conexões' }
export const dynamic = 'force-dynamic'

export default async function ConexoesPage() {
  const conexoes = await listarConexoes()

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Conexões</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Assistentes externos autorizados a acessar seus dados por você. A autorização é sua,
          não da empresa — e vale só para as empresas marcadas no momento em que você a concedeu.
        </p>
      </div>

      <OauthConnectionsList conexoes={conexoes} />
    </div>
  )
}
