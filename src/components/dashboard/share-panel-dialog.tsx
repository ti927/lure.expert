'use client'

// Com quem o painel é compartilhado — a tela do enforcement que a 4.B deixou
// declarado para a Fase 5.
//
// Dois escopos: a organização inteira, ou pessoas específicas. Cada linha tem a
// permissão (ler/editar) e o botão de remover. Só o dono chega aqui.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Building2, User, Trash2, Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  compartilharPainelAction, removerCompartilhamentoAction, getMembrosParaCompartilhar,
} from '@/server/dashboards'
import { PAPEL_LABEL, type Papel } from '@/lib/members-types'
import type { CompartilhamentoDoPainel } from '@/lib/dashboard/store'

type Membro = { userId: string; email: string; papel: string }

export function SharePanelDialog({
  open, onOpenChange, painelId, compartilhamentos,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  painelId: string
  compartilhamentos: CompartilhamentoDoPainel[]
}) {
  const router = useRouter()
  const [pendente, iniciar] = useTransition()
  const [membros, setMembros] = useState<Membro[]>([])
  const [alvo, setAlvo] = useState<string>('')
  const [permissao, setPermissao] = useState<'ler' | 'editar'>('ler')

  useEffect(() => {
    if (!open) return
    getMembrosParaCompartilhar().then(setMembros).catch(() => setMembros([]))
  }, [open])

  const daOrganizacao = compartilhamentos.find(c => c.escopo === 'organizacao')
  const pessoas = compartilhamentos.filter(c => c.escopo === 'usuarios')
  const jaCompartilhado = new Set(pessoas.map(p => p.userId))
  const disponiveis = membros.filter(m => !jaCompartilhado.has(m.userId))

  function acao(fn: () => Promise<unknown>, sucesso: string) {
    iniciar(async () => {
      const r = await fn()
      const erro = r && typeof r === 'object' && 'erro' in r ? String(r.erro) : null
      if (erro) toast.error(erro)
      else { toast.success(sucesso); router.refresh() }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Compartilhar painel</DialogTitle>
          <DialogDescription>
            Quem recebe com permissão de leitura vê o painel; com edição, pode reorganizar os
            blocos. Apagar e recompartilhar continuam sendo só seus.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* A organização inteira */}
          <div className="flex items-center gap-3 rounded-md border p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
              <Building2 className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Toda a empresa</p>
              <p className="text-xs text-muted-foreground">
                {daOrganizacao
                  ? `Compartilhado — permissão de ${daOrganizacao.permissao === 'editar' ? 'edição' : 'leitura'}`
                  : 'Ninguém além de você vê este painel'}
              </p>
            </div>
            {daOrganizacao ? (
              <div className="flex items-center gap-1 shrink-0">
                <Select
                  value={daOrganizacao.permissao}
                  onValueChange={(v: 'ler' | 'editar') =>
                    acao(() => compartilharPainelAction(painelId, { escopo: 'organizacao' }, v), 'Permissão atualizada.')}
                >
                  <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ler">Ler</SelectItem>
                    <SelectItem value="editar">Editar</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost" size="sm" className="px-2 text-rose-600" disabled={pendente}
                  onClick={() => acao(() => removerCompartilhamentoAction(painelId, daOrganizacao.id), 'Compartilhamento removido.')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm" variant="outline" disabled={pendente}
                onClick={() => acao(() => compartilharPainelAction(painelId, { escopo: 'organizacao' }, 'ler'), 'Painel compartilhado com a empresa.')}
              >
                Compartilhar
              </Button>
            )}
          </div>

          {/* Pessoas */}
          {pessoas.length > 0 && (
            <div className="space-y-2">
              {pessoas.map(p => (
                <div key={p.id} className="flex items-center gap-3 rounded-md border p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
                    <User className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{p.email ?? 'Membro'}</p>
                  </div>
                  <Select
                    value={p.permissao}
                    onValueChange={(v: 'ler' | 'editar') =>
                      acao(() => compartilharPainelAction(painelId, { escopo: 'usuarios', userId: p.userId! }, v), 'Permissão atualizada.')}
                  >
                    <SelectTrigger className="h-8 w-28 text-xs shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ler">Ler</SelectItem>
                      <SelectItem value="editar">Editar</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost" size="sm" className="px-2 text-rose-600 shrink-0" disabled={pendente}
                    onClick={() => acao(() => removerCompartilhamentoAction(painelId, p.id), 'Compartilhamento removido.')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Adicionar pessoa */}
          {disponiveis.length > 0 && (
            <div className="flex items-center gap-2 border-t pt-4">
              <Select value={alvo} onValueChange={setAlvo}>
                <SelectTrigger className="h-9 flex-1 text-sm">
                  <SelectValue placeholder="Escolher pessoa..." />
                </SelectTrigger>
                <SelectContent>
                  {disponiveis.map(m => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.email}
                      <span className="text-xs text-muted-foreground ml-2">
                        {PAPEL_LABEL[m.papel as Papel] ?? m.papel}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={permissao} onValueChange={(v: 'ler' | 'editar') => setPermissao(v)}>
                <SelectTrigger className="h-9 w-28 text-sm shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ler">Ler</SelectItem>
                  <SelectItem value="editar">Editar</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm" disabled={!alvo || pendente} className="shrink-0"
                onClick={() => {
                  const escolhido = alvo
                  setAlvo('')
                  acao(() => compartilharPainelAction(painelId, { escopo: 'usuarios', userId: escolhido }, permissao), 'Painel compartilhado.')
                }}
              >
                {pendente ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Adicionar'}
              </Button>
            </div>
          )}

          {membros.length === 0 && (
            <p className="text-xs text-muted-foreground border-t pt-4">
              Esta empresa não tem outros membros ativos. Convide alguém em Configurações → Membros.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
