'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { UserPlus, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { convidarMembro, alterarPapel, removerMembro, type MembrosDaTela } from '@/server/members'
import { PAPEIS, PAPEL_LABEL, PAPEL_DESCRICAO, podeGerirMembros, type Papel } from '@/lib/members-types'

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })

export function MembersManager({ membros, meuPapel, meuUserId }: MembrosDaTela) {
  const router = useRouter()
  const [pendente, iniciar] = useTransition()
  const possoGerir = podeGerirMembros(meuPapel)

  // Convite
  const [convidando, setConvidando] = useState(false)
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<Papel>('member')

  // Remoção
  const [alvoRemocao, setAlvoRemocao] = useState<(typeof membros)[number] | null>(null)

  // admin não concede owner; owner concede qualquer papel
  const papeisAtribuiveis = PAPEIS.filter((p) => meuPapel === 'owner' || p !== 'owner')

  function podeMexerEm(m: (typeof membros)[number]): boolean {
    if (!possoGerir) return false
    if (m.userId === meuUserId) return false
    if (meuPapel === 'admin' && m.papel === 'owner') return false
    return true
  }

  function enviarConvite() {
    iniciar(async () => {
      const r = await convidarMembro({ email, papel })
      if (r.erro) {
        toast.error(r.erro)
        return
      }
      if (r.usuarioJaExistia && r.avisoErro) {
        // O convite existe; só o aviso falhou — a pessoa ainda o vê ao entrar.
        toast.warning(`Convite criado, mas o aviso por e-mail não saiu: ${r.avisoErro} A pessoa verá o convite ao entrar no lure.expert.`)
      } else {
        toast.success(
          r.usuarioJaExistia
            ? `${email} já tem conta — enviamos um aviso por e-mail, e o convite aparece quando a pessoa entrar.`
            : `Convite enviado por e-mail para ${email}.`,
        )
      }
      setConvidando(false)
      setEmail('')
      setPapel('member')
      router.refresh()
    })
  }

  function mudarPapel(m: (typeof membros)[number], novo: string) {
    iniciar(async () => {
      const r = await alterarPapel(m.membershipId, novo)
      if (r.erro) toast.error(r.erro)
      else toast.success(`${m.email} agora é ${PAPEL_LABEL[novo as Papel].toLowerCase()}.`)
      router.refresh()
    })
  }

  function confirmarRemocao() {
    const alvo = alvoRemocao
    if (!alvo) return
    iniciar(async () => {
      const r = await removerMembro(alvo.membershipId)
      if (r.erro) toast.error(r.erro)
      else {
        toast.success(
          alvo.aceitoEm
            ? `${alvo.email} foi removido da organização.`
            : `O convite de ${alvo.email} foi cancelado.`,
        )
      }
      setAlvoRemocao(null)
      router.refresh()
    })
  }

  return (
    <>
      {possoGerir && (
        <div className="flex justify-end">
          <Button onClick={() => setConvidando(true)} disabled={pendente}>
            <UserPlus className="mr-2 h-4 w-4" strokeWidth={1.5} />
            Convidar
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {membros.map((m) => {
          const souEu = m.userId === meuUserId
          const editavel = podeMexerEm(m)
          return (
            <div key={m.membershipId} className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted shrink-0 text-sm font-medium text-muted-foreground uppercase">
                  {m.email.charAt(0)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{m.email}</p>
                    {souEu && <Badge variant="secondary">você</Badge>}
                    {!m.aceitoEm && (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                        Convite pendente
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {m.aceitoEm
                      ? `Membro desde ${dataCurta(m.aceitoEm)}`
                      : `Convidado em ${dataCurta(m.criadoEm)}${m.convidadoPor ? ` por ${m.convidadoPor}` : ''}`}
                  </p>
                </div>

                {editavel ? (
                  <Select value={m.papel} onValueChange={(v) => mudarPapel(m, v)} disabled={pendente}>
                    <SelectTrigger className="w-[150px] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {papeisAtribuiveis.map((p) => (
                        <SelectItem key={p} value={p}>{PAPEL_LABEL[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {PAPEL_LABEL[m.papel as Papel] ?? m.papel}
                  </span>
                )}

                {editavel && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setAlvoRemocao(m)}
                    disabled={pendente}
                  >
                    {m.aceitoEm ? 'Remover' : 'Cancelar convite'}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Convidar */}
      <Dialog open={convidando} onOpenChange={(aberto) => !aberto && setConvidando(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar membro</DialogTitle>
            <DialogDescription>
              Quem já tem conta no lure.expert vê o convite ao entrar; quem não tem recebe um
              e-mail para criar a senha.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="convite-email">E-mail</Label>
              <Input
                id="convite-email"
                type="email"
                placeholder="pessoa@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="convite-papel">Papel</Label>
              <Select value={papel} onValueChange={(v) => setPapel(v as Papel)}>
                <SelectTrigger id="convite-papel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {papeisAtribuiveis.map((p) => (
                    <SelectItem key={p} value={p}>{PAPEL_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{PAPEL_DESCRICAO[papel]}</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConvidando(false)} disabled={pendente}>
              Cancelar
            </Button>
            <Button onClick={enviarConvite} disabled={pendente || !email}>
              {pendente ? 'Convidando...' : 'Convidar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remover / cancelar convite */}
      <AlertDialog open={alvoRemocao !== null} onOpenChange={(aberto) => !aberto && setAlvoRemocao(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {alvoRemocao?.aceitoEm ? `Remover ${alvoRemocao?.email}?` : `Cancelar o convite de ${alvoRemocao?.email}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {alvoRemocao?.aceitoEm
                ? 'A pessoa perde o acesso a esta organização imediatamente. Nada do que ela fez é desfeito — lançamentos, classificações e regras permanecem.'
                : 'O link do e-mail deixa de valer para esta organização. Você pode convidar de novo depois.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendente}>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarRemocao} disabled={pendente}>
              {pendente ? 'Removendo...' : alvoRemocao?.aceitoEm ? 'Remover' : 'Cancelar convite'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
