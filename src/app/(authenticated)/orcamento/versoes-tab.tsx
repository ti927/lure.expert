'use client'

import { useState, useTransition } from 'react'
import { Archive, Check, CheckCircle2, Copy, Loader2, Plus, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { fmtMoney } from '@/lib/format'
import { BUDGET_STATUS_LABELS, type BudgetVersionListItem } from '@/lib/budget-types'
import {
  createBudgetVersion, deleteBudgetVersion, duplicateBudgetVersion,
  setActiveBudgetVersion, updateBudgetVersionStatus,
} from '@/server/budget'

const inputCls =
  'w-full h-8 rounded-md border border-input px-2 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring'

const STATUS_STYLE: Record<string, string> = {
  rascunho:  'bg-slate-500/15 text-slate-600',
  aprovado:  'bg-emerald-500/15 text-emerald-700',
  arquivado: 'bg-amber-500/15 text-amber-600',
}

interface Props {
  versions: BudgetVersionListItem[]
  selectedId: string | null
  isPending: boolean
  onSelect: (id: string) => void
  onChanged: (nextId?: string) => void
}

export function VersoesTab({ versions, selectedId, isPending, onSelect, onChanged }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear() + 1))
  const [description, setDescription] = useState('')
  const [pendingDelete, setPendingDelete] = useState<BudgetVersionListItem | null>(null)
  const [duplicating, setDuplicating] = useState<BudgetVersionListItem | null>(null)
  const [dupName, setDupName] = useState('')
  const [dupYear, setDupYear] = useState('')
  const [isMutating, startMutation] = useTransition()

  function openCreate() {
    const nextYear = new Date().getFullYear() + 1
    setName(`Orçamento ${nextYear}`)
    setFiscalYear(String(nextYear))
    setDescription('')
    setCreateOpen(true)
  }

  function submitCreate() {
    const year = Number(fiscalYear)
    if (!name.trim()) { toast.error('Informe o nome da versão.'); return }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { toast.error('Exercício inválido.'); return }

    startMutation(async () => {
      const result = await createBudgetVersion({
        name: name.trim(),
        fiscalYear: year,
        description: description.trim() || null,
      })
      if ('error' in result && result.error) { toast.error(result.error); return }
      toast.success('Versão criada.')
      setCreateOpen(false)
      onChanged('id' in result ? result.id : undefined)
    })
  }

  function openDuplicate(v: BudgetVersionListItem) {
    // Padrão = revisão do mesmo exercício. Trocar o ano transforma em virada de
    // ano, e o aviso no diálogo diz o que acontece com as datas.
    setDupName(`${v.name} (cópia)`.slice(0, 120))
    setDupYear(String(v.fiscalYear))
    setDuplicating(v)
  }

  function submitDuplicate() {
    if (!duplicating) return
    const year = Number(dupYear)
    if (!dupName.trim()) { toast.error('Informe o nome da nova versão.'); return }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { toast.error('Exercício inválido.'); return }

    const source = duplicating
    startMutation(async () => {
      const result = await duplicateBudgetVersion(source.id, { name: dupName.trim(), fiscalYear: year })
      if ('error' in result && result.error) { toast.error(result.error); return }
      const series = 'series' in result ? result.series : 0
      toast.success(`Versão duplicada com ${series} ${series === 1 ? 'lançamento' : 'lançamentos'}.`)
      setDuplicating(null)
      onChanged('id' in result ? result.id : undefined)
    })
  }

  function activate(v: BudgetVersionListItem) {
    startMutation(async () => {
      const result = await setActiveBudgetVersion(v.id)
      if ('error' in result && result.error) { toast.error(result.error); return }
      toast.success(`"${v.name}" é a versão vigente de ${v.fiscalYear}.`)
      onChanged(v.id)
    })
  }

  function changeStatus(v: BudgetVersionListItem, status: 'rascunho' | 'aprovado' | 'arquivado') {
    startMutation(async () => {
      const result = await updateBudgetVersionStatus(v.id, status)
      if ('error' in result && result.error) { toast.error(result.error); return }
      toast.success(
        status === 'aprovado'  ? 'Versão aprovada.' :
        status === 'arquivado' ? 'Versão arquivada — passa a ser somente leitura.' :
                                 'Versão voltou para rascunho.',
      )
      onChanged()
    })
  }

  function confirmDelete() {
    if (!pendingDelete) return
    const target = pendingDelete
    startMutation(async () => {
      const result = await deleteBudgetVersion(target.id)
      if ('error' in result && result.error) { toast.error(result.error); return }
      toast.success('Versão excluída.')
      setPendingDelete(null)
      onChanged()
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-6 pb-3 flex items-center gap-3">
        <p className="text-xs text-muted-foreground">
          Cada versão é um exercício. Duplicar uma versão serve tanto para revisão quanto para cenário.
        </p>
        <Button size="sm" className="h-7 text-xs gap-1.5 ml-auto" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          Nova versão
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden px-6">
        <div className={cn('h-full overflow-auto border rounded-lg', isPending && 'opacity-50 pointer-events-none')}>
          <table className="w-full text-xs border-collapse [&_td]:border-r [&_th]:border-r [&_td]:border-border/20 [&_th]:border-border/20 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted border-b">
                <th className="text-left px-2 py-2 font-medium">Versão</th>
                <th className="text-left px-2 py-2 font-medium w-24">Exercício</th>
                <th className="text-left px-2 py-2 font-medium w-28">Status</th>
                <th className="text-right px-2 py-2 font-medium w-28">Lançamentos</th>
                <th className="text-right px-2 py-2 font-medium w-32">Entradas</th>
                <th className="text-right px-2 py-2 font-medium w-32">Saídas</th>
                <th className="text-right px-2 py-2 font-medium w-32">Líquido</th>
                <th className="w-40" />
              </tr>
            </thead>
            <tbody>
              {versions.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                    Nenhuma versão ainda. Crie a do próximo exercício para começar.
                  </td>
                </tr>
              )}

              {versions.map(v => {
                const net = v.totalInflow - v.totalOutflow
                return (
                  <tr
                    key={v.id}
                    className={cn('border-b hover:bg-muted/40 cursor-pointer', v.id === selectedId && 'bg-primary/5')}
                    onClick={() => onSelect(v.id)}
                  >
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        {v.isActive && <Star className="h-3 w-3 fill-primary text-primary shrink-0" />}
                        <span className="font-medium">{v.name}</span>
                      </div>
                      {v.description && <p className="text-[11px] text-muted-foreground truncate">{v.description}</p>}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{v.fiscalYear}</td>
                    <td className="px-2 py-2">
                      <span className={cn('text-[10px] rounded px-1.5 py-0.5', STATUS_STYLE[v.status])}>
                        {BUDGET_STATUS_LABELS[v.status]}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {v.seriesCount}
                      <span className="text-muted-foreground"> / {v.entryCount} ocorr.</span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{fmtMoney(v.totalInflow)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-rose-600">{fmtMoney(v.totalOutflow)}</td>
                    <td className={cn('px-2 py-2 text-right tabular-nums font-medium',
                      net >= 0 ? 'text-emerald-700' : 'text-rose-600')}>
                      {fmtMoney(net)}
                    </td>
                    <td className="px-1 py-2" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        {!v.isActive && v.status !== 'arquivado' && (
                          <button onClick={() => activate(v)} disabled={isMutating}
                            className="h-6 px-1.5 inline-flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-primary hover:bg-muted disabled:opacity-30"
                            title="Tornar vigente">
                            <Star className="h-3 w-3" /> Vigente
                          </button>
                        )}
                        <button onClick={() => openDuplicate(v)} disabled={isMutating}
                          className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
                          title="Duplicar versão">
                          <Copy className="h-3 w-3" />
                        </button>
                        {v.status === 'rascunho' && (
                          <button onClick={() => changeStatus(v, 'aprovado')} disabled={isMutating}
                            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-emerald-700 hover:bg-muted disabled:opacity-30"
                            title="Aprovar">
                            <CheckCircle2 className="h-3 w-3" />
                          </button>
                        )}
                        {v.status !== 'arquivado' ? (
                          <button onClick={() => changeStatus(v, 'arquivado')} disabled={isMutating}
                            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-amber-600 hover:bg-muted disabled:opacity-30"
                            title="Arquivar (vira somente leitura)">
                            <Archive className="h-3 w-3" />
                          </button>
                        ) : (
                          <button onClick={() => changeStatus(v, 'rascunho')} disabled={isMutating}
                            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
                            title="Desarquivar">
                            <Check className="h-3 w-3" />
                          </button>
                        )}
                        <button onClick={() => setPendingDelete(v)} disabled={isMutating}
                          className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted disabled:opacity-30"
                          title="Excluir versão">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nova versão */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova versão de orçamento</DialogTitle>
            <DialogDescription>
              O exercício é o ano civil. A primeira versão de um exercício já nasce vigente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="ver-name" className="text-xs">Nome</Label>
              <input id="ver-name" value={name} onChange={e => setName(e.target.value.slice(0, 120))}
                placeholder="Ex.: Orçamento 2027" className={inputCls} />
              <p className="text-[11px] text-muted-foreground">
                Use nomes que digam o papel da versão: &quot;Orçamento 2027&quot;, &quot;Revisão Jul&quot;, &quot;Cenário Pessimista&quot;.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ver-year" className="text-xs">Exercício</Label>
              <input id="ver-year" type="number" min={2000} max={2100} value={fiscalYear}
                onChange={e => setFiscalYear(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ver-desc" className="text-xs">Descrição (opcional)</Label>
              <input id="ver-desc" value={description} onChange={e => setDescription(e.target.value.slice(0, 500))}
                className={inputCls} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={isMutating}>Cancelar</Button>
            <Button onClick={submitCreate} disabled={isMutating || !name.trim()}>
              {isMutating ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Criando…</> : 'Criar versão'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicar versão */}
      <Dialog open={!!duplicating} onOpenChange={open => { if (!open) setDuplicating(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicar versão</DialogTitle>
            <DialogDescription>
              Copia os lançamentos de &quot;{duplicating?.name}&quot; — inclusive os valores ajustados à mão.
              Mesmo exercício é revisão ou cenário; exercício diferente é a virada de ano.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="dup-name" className="text-xs">Nome da nova versão</Label>
              <input id="dup-name" value={dupName} onChange={e => setDupName(e.target.value.slice(0, 120))}
                className={inputCls} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dup-year" className="text-xs">Exercício</Label>
              <input id="dup-year" type="number" min={2000} max={2100} value={dupYear}
                onChange={e => setDupYear(e.target.value)} className={inputCls} />
              {duplicating && Number(dupYear) !== duplicating.fiscalYear && Number.isInteger(Number(dupYear)) && (
                <p className="text-[11px] text-muted-foreground leading-snug">
                  As datas serão deslocadas em {Math.abs(Number(dupYear) - duplicating.fiscalYear)}
                  {Math.abs(Number(dupYear) - duplicating.fiscalYear) === 1 ? ' ano' : ' anos'}
                  {Number(dupYear) < duplicating.fiscalYear ? ' para trás' : ''}, mantendo dia, prazo de caixa e
                  os {duplicating.entryCount} valores como estão.
                </p>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              A nova versão nasce como rascunho e não assume a vigência de quem já está valendo.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicating(null)} disabled={isMutating}>Cancelar</Button>
            <Button onClick={submitDuplicate} disabled={isMutating || !dupName.trim()}>
              {isMutating ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Duplicando…</> : 'Duplicar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={open => { if (!open) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir versão?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{pendingDelete?.name}&quot; será removida com seus {pendingDelete?.seriesCount} lançamentos
              e {pendingDelete?.entryCount} ocorrências. Não há como desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={isMutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isMutating ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
