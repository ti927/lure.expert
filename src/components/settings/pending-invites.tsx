'use client'

// Os convites pendentes DO usuário, com aceitar e recusar. Aparece em dois
// lugares: no /onboarding (usuário sem organização) e em /configuracoes
// (usuário convidado para uma segunda organização). Desde a 4.B, a organização
// aceita aparece no seletor do topo da sidebar.

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { aceitarConviteAction, recusarConviteAction, type ConvitePendente } from '@/server/members'
import { PAPEL_LABEL, type Papel } from '@/lib/members-types'

export function PendingInvites({ convites }: { convites: ConvitePendente[] }) {
  const router = useRouter()
  const [pendente, iniciar] = useTransition()

  function aceitar(c: ConvitePendente) {
    iniciar(async () => {
      // Sucesso redireciona para /dashboard dentro da própria action.
      const r = await aceitarConviteAction(c.membershipId)
      if (r?.erro) toast.error(r.erro)
    })
  }

  function recusar(c: ConvitePendente) {
    iniciar(async () => {
      const r = await recusarConviteAction(c.membershipId)
      if (r.erro) toast.error(r.erro)
      else toast.success(`Convite de ${c.organizationName} recusado.`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {convites.map((c) => (
        <div key={c.membershipId} className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted shrink-0">
              <Building2 className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{c.organizationName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Como {(PAPEL_LABEL[c.papel as Papel] ?? c.papel).toLowerCase()}
                {c.convidadoPor ? ` — convidado por ${c.convidadoPor}` : ''}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => recusar(c)} disabled={pendente}>
              Recusar
            </Button>
            <Button size="sm" onClick={() => aceitar(c)} disabled={pendente}>
              {pendente ? 'Aceitando...' : 'Aceitar'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
