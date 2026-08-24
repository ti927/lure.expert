'use client'

/**
 * Contas manuais — as que não vêm de conexão bancária.
 *
 * Antes desta seção, "conta" só existia como efeito colateral do sync do Pluggy:
 * `/contas` lista `data_sources` com `provider='pluggy'`, e as contas de cada
 * conexão são um array JSON dentro dela que só o sync escreve. Caixa, conta
 * corrente que o Open Finance não alcança e conta declarada num arquivo
 * importado não tinham como existir — e 7.762 de 7.762 lançamentos importados
 * estavam sem conta nenhuma.
 *
 * Elas não têm logo, badge nem botão de sincronizar, e isso é honesto: não há
 * o que sincronizar. O que elas têm é nome, tipo, número e contagem de uso.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Wallet, Plus, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { createManualAccount, deleteManualAccount } from '@/server/connections'
import { TIPOS_DE_CONTA, ROTULO_DE_CONTA, type TipoDeConta } from '@/lib/import-contract'
import type { ContaManualComUso } from '@/lib/accounts'

export function ManualAccounts({ contas }: { contas: ContaManualComUso[] }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<TipoDeConta>('CHECKING_ACCOUNT')
  const [numero, setNumero] = useState('')
  const [salvando, startSalvar] = useTransition()
  const [apagandoId, setApagandoId] = useState<string | null>(null)

  function criar() {
    startSalvar(async () => {
      const result = await createManualAccount({
        nome: nome.trim(), tipo, numero: numero.trim() || null,
      })
      if ('error' in result) { toast.error(result.error); return }
      toast.success('Conta criada.')
      setAberto(false); setNome(''); setNumero(''); setTipo('CHECKING_ACCOUNT')
      router.refresh()
    })
  }

  function apagar(dataSourceId: string) {
    setApagandoId(dataSourceId)
    startSalvar(async () => {
      const result = await deleteManualAccount(dataSourceId)
      setApagandoId(null)
      if ('error' in result) { toast.error(result.error, { duration: 8000 }); return }
      toast.success('Conta apagada.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-foreground">Contas manuais</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Caixa, contas que o Open Finance não alcança, e contas declaradas em arquivos importados.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />Criar conta
        </Button>
      </div>

      {contas.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Nenhuma conta manual. Você também pode criar uma informando a conta ao revisar um arquivo importado.
        </p>
      ) : (
        <div className="grid gap-2">
          {contas.map(c => (
            <div key={c.dataSourceId} className="flex items-center justify-between rounded-lg border bg-card px-4 py-2.5">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                  <Wallet className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-sm font-medium">{c.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROTULO_DE_CONTA[c.tipo]}
                    {c.numero ? ` • ${c.numero}` : ''}
                    {' · '}
                    <span className="tabular-nums">{c.lancamentos}</span> lançamento{c.lancamentos === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost" size="sm"
                className="text-muted-foreground hover:text-destructive"
                disabled={salvando && apagandoId === c.dataSourceId}
                onClick={() => apagar(c.dataSourceId)}
                aria-label={`Apagar ${c.nome}`}
                // A recusa quando há lançamento vem do servidor, com o número na
                // mensagem — desabilitar aqui esconderia o motivo.
                title={c.lancamentos > 0
                  ? `${c.lancamentos} lançamento${c.lancamentos === 1 ? '' : 's'} usam esta conta`
                  : 'Apagar conta'}
              >
                {salvando && apagandoId === c.dataSourceId
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Trash2 className="h-4 w-4" />}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Criar conta manual</DialogTitle>
            <DialogDescription>
              Para dinheiro que não passa por conexão bancária — caixa, uma conta que o Open Finance
              não alcança, ou o cartão cujo extrato você importa por arquivo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ma-nome">Nome</Label>
              <Input
                id="ma-nome" value={nome} onChange={e => setNome(e.target.value)}
                placeholder="Caixa, Bradesco PJ, Cartão Amex…" autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ma-tipo">Tipo</Label>
                <select
                  id="ma-tipo" value={tipo} onChange={e => setTipo(e.target.value as TipoDeConta)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {TIPOS_DE_CONTA.map(t => <option key={t} value={t}>{ROTULO_DE_CONTA[t]}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ma-numero">Número <span className="text-muted-foreground">(opcional)</span></Label>
                <Input id="ma-numero" value={numero} onChange={e => setNumero(e.target.value)} placeholder="12345-6" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button onClick={criar} disabled={salvando || !nome.trim()}>
              {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
