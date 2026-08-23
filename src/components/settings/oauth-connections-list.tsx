'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plug, Building2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/states/empty-state'
import { revogarConexao, type ConexaoListada } from '@/server/oauth-connections'

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })

const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'ainda não usou'

export function OauthConnectionsList({ conexoes }: { conexoes: ConexaoListada[] }) {
  const [alvo, setAlvo] = useState<ConexaoListada | null>(null)
  const [pendente, iniciar] = useTransition()

  if (conexoes.length === 0) {
    return (
      <EmptyState
        icon={<Plug className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
        title="Nenhum aplicativo conectado"
        description="Quando você conectar o lure.expert a um assistente externo, a autorização aparece aqui — com as empresas que ela alcança e o botão para desfazê-la."
      />
    )
  }

  function confirmar() {
    if (!alvo) return
    const id = alvo.id
    const nome = alvo.clientName
    iniciar(async () => {
      const r = await revogarConexao(id)
      if (r.erro) toast.error(r.erro)
      else toast.success(`${nome} desconectado. Os tokens dele deixaram de valer.`)
      setAlvo(null)
    })
  }

  return (
    <>
      <div className="space-y-3">
        {conexoes.map(c => (
          <div key={c.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start gap-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted shrink-0">
                <Plug className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{c.clientName}</p>
                  <p className="text-xs text-muted-foreground">
                    Autorizado em {dataCurta(c.criadoEm)}
                  </p>
                </div>

                <ul className="space-y-1">
                  {c.escopos.map(e => (
                    <li key={e.chave} className="flex gap-2 text-xs text-muted-foreground">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                      <span>{e.descricao}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {c.empresas.join(', ')}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Último uso: {quando(c.ultimoUsoEm)}
                  </span>
                </div>
              </div>

              <Button variant="outline" size="sm" onClick={() => setAlvo(c)} disabled={pendente}>
                Desconectar
              </Button>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={alvo !== null} onOpenChange={aberto => !aberto && setAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar {alvo?.clientName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Os tokens deste aplicativo param de valer imediatamente, mesmo os que ainda estariam
              no prazo. Nada do que ele já fez é desfeito — lançamentos classificados, rateios e
              orçamentos permanecem como estão. Para reconectar, será preciso autorizar de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendente}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmar} disabled={pendente}>
              {pendente ? 'Desconectando...' : 'Desconectar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
