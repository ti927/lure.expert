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
 * Não têm botão de sincronizar, e isso é honesto: não há o que sincronizar.
 * Desde 20/out têm o resto do que uma conexão tem — logo e badge — e mais o que
 * uma conexão não tem: nome, tipo e número EDITÁVEIS. Renomear propaga aos
 * lançamentos e mantém a identidade (`editarContaManual`, em `lib/accounts.ts`).
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import { Wallet, Plus, Trash2, Loader2, Pencil, Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  createManualAccount, deleteManualAccount, updateManualAccount, updateConnectionCustomization,
  type ContaManualNaTela,
} from '@/server/connections'
import { TIPOS_DE_CONTA, ROTULO_DE_CONTA, temSaldoCorrido, type TipoDeConta } from '@/lib/import-contract'
import { LogoEditor } from './logo-editor'

export function ManualAccounts({ contas, orgId }: { contas: ContaManualNaTela[]; orgId: string }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<TipoDeConta>('CHECKING_ACCOUNT')
  const [numero, setNumero] = useState('')
  const [salvando, startSalvar] = useTransition()
  const [apagandoId, setApagandoId] = useState<string | null>(null)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const editando = contas.find(c => c.dataSourceId === editandoId) ?? null

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
                {c.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.logoUrl} alt="" className="h-8 w-8 rounded border bg-muted object-contain" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                    <Wallet className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    {c.nome}
                    {c.badge && (
                      <span className="inline-flex items-center rounded px-1 py-0 text-[10px] font-medium bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                        {c.badge}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ROTULO_DE_CONTA[c.tipo]}
                    {c.numero ? ` • ${c.numero}` : ''}
                    {' · '}
                    <span className="tabular-nums">{c.lancamentos}</span> lançamento{c.lancamentos === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
              {/* Conta com saldo confere pelo saldo corrido; cartão de crédito, pela fatura. */}
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-primary gap-1.5"
                title={temSaldoCorrido(c.tipo)
                  ? 'Conferir o saldo desta conta com o extrato do banco'
                  : 'Conferir as faturas deste cartão com as do banco'}>
                <Link href={`/contas/${encodeURIComponent(c.accountId)}`}>
                  <Scale className="h-4 w-4" />{temSaldoCorrido(c.tipo) ? 'Conferir saldo' : 'Conferir faturas'}
                </Link>
              </Button>
              <Button
                variant="ghost" size="sm"
                className="text-muted-foreground hover:text-primary"
                onClick={() => setEditandoId(c.dataSourceId)}
                aria-label={`Editar ${c.nome}`}
                title="Editar nome, tipo, número, badge e logo"
              >
                <Pencil className="h-4 w-4" />
              </Button>
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

      {editando && (
        <EditarContaManualDialog
          key={editando.dataSourceId}
          conta={editando}
          orgId={orgId}
          onClose={() => setEditandoId(null)}
        />
      )}
    </div>
  )
}

function EditarContaManualDialog({
  conta, orgId, onClose,
}: { conta: ContaManualNaTela; orgId: string; onClose: () => void }) {
  const router = useRouter()
  const [nome, setNome] = useState(conta.nome)
  const [tipo, setTipo] = useState<TipoDeConta>(conta.tipo)
  const [numero, setNumero] = useState(conta.numero ?? '')
  const [badge, setBadge] = useState(conta.badge)
  const [salvando, startSalvar] = useTransition()
  const [enviandoLogo, setEnviandoLogo] = useState(false)

  const mudouCadastro = nome.trim() !== conta.nome || tipo !== conta.tipo
    || (numero.trim() || null) !== conta.numero
  const mudouBadge = badge.trim() !== conta.badge

  function salvar() {
    startSalvar(async () => {
      let atualizados = 0
      if (mudouCadastro) {
        const r = await updateManualAccount(conta.dataSourceId, {
          nome: nome.trim(), tipo, numero: numero.trim() || null,
        })
        if ('error' in r) { toast.error(r.error, { duration: 8000 }); return }
        atualizados = r.lancamentosAtualizados
      }
      if (mudouBadge) {
        const r = await updateConnectionCustomization(conta.dataSourceId, {
          customLabel: null, customBadge: badge.trim() || null,
        })
        if ('error' in r) { toast.error(r.error); return }
      }
      toast.success(atualizados > 0
        ? `Conta atualizada, junto com ${atualizados} lançamento${atualizados === 1 ? '' : 's'}.`
        : 'Conta atualizada.')
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar conta</DialogTitle>
          <DialogDescription>
            Mudar nome, tipo ou número atualiza também os {conta.lancamentos} lançamento
            {conta.lancamentos === 1 ? '' : 's'} desta conta. Planilhas com o nome antigo continuam
            caindo nela.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <LogoEditor
            dataSourceId={conta.dataSourceId}
            orgId={orgId}
            currentLogoUrl={conta.logoUrl}
            hasCustomLogo={conta.temLogoProprio}
            disabled={salvando}
            onBusyChange={setEnviandoLogo}
          />
          <div className="space-y-1.5">
            <Label htmlFor="ea-nome">Nome</Label>
            <Input id="ea-nome" value={nome} onChange={e => setNome(e.target.value)} maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ea-tipo">Tipo</Label>
              <select
                id="ea-tipo" value={tipo} onChange={e => setTipo(e.target.value as TipoDeConta)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {TIPOS_DE_CONTA.map(t => <option key={t} value={t}>{ROTULO_DE_CONTA[t]}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ea-numero">Número <span className="text-muted-foreground">(opcional)</span></Label>
              <Input id="ea-numero" value={numero} onChange={e => setNumero(e.target.value)} maxLength={60} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ea-badge">Badge <span className="text-muted-foreground">(opcional)</span></Label>
            <Input id="ea-badge" value={badge} onChange={e => setBadge(e.target.value)} placeholder="ex: AVD, Matriz" maxLength={20} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando || enviandoLogo}>Cancelar</Button>
          <Button
            onClick={salvar}
            disabled={salvando || enviandoLogo || !nome.trim() || (!mudouCadastro && !mudouBadge)}
          >
            {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
