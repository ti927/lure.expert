'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/states/empty-state'
import type { EquityMovement } from '@/db/schema'
import { createEquityMovement, deleteEquityMovement } from '@/server/balance-sheet'

const TYPE_LABELS: Record<string, string> = {
  capital_contribution: 'Aporte de capital',
  capital_withdrawal: 'Retirada de capital',
  profit_distribution: 'Distribuição de lucros',
  reserve_transfer: 'Transferência para reserva',
  other: 'Outro',
}

function fmt(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (isNaN(n)) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

type FormState = {
  type: string
  amount: string
  direction: 'inflow' | 'outflow'
  date: string
  description: string
}

const EMPTY_FORM: FormState = {
  type: 'capital_contribution',
  amount: '',
  direction: 'inflow',
  date: '',
  description: '',
}

interface Props {
  items: EquityMovement[]
}

export function EquityMovementsManager({ items }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<EquityMovement | null>(null)

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleSave() {
    startTransition(async () => {
      const input = {
        type: form.type as 'capital_contribution' | 'capital_withdrawal' | 'profit_distribution' | 'reserve_transfer' | 'other',
        amount: Number(form.amount),
        direction: form.direction,
        date: form.date,
        description: form.description,
      }
      const result = await createEquityMovement(input)

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Movimentação registrada.')
        setDialogOpen(false)
        setForm(EMPTY_FORM)
        router.refresh()
      }
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await deleteEquityMovement(deleteTarget.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Movimentação removida.')
        setDeleteTarget(null)
        router.refresh()
      }
    })
  }

  const totalPL = items.reduce((acc, m) => {
    const v = Number(m.amount)
    return acc + (m.direction === 'inflow' ? v : -v)
  }, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button size="sm" onClick={() => { setForm(EMPTY_FORM); setDialogOpen(true) }}>
          <Plus className="h-4 w-4 mr-1" />
          Registrar movimentação
        </Button>
        {items.length > 0 && (
          <div className="text-sm">
            <span className="text-muted-foreground">Saldo de PL: </span>
            <span className={`font-semibold tabular-nums ${totalPL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {fmt(totalPL)}
            </span>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<TrendingUp className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Nenhuma movimentação de PL registrada"
          description="Registre aportes, retiradas e distribuições de lucro para compor o Patrimônio Líquido."
        />
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Data</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Tipo</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Descrição</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Valor</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((mov) => (
                <tr key={mov.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(mov.date)}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className="text-xs">{TYPE_LABELS[mov.type] ?? mov.type}</Badge>
                  </td>
                  <td className="px-3 py-2.5 max-w-[240px] truncate">{mov.description}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span className={mov.direction === 'inflow' ? 'text-emerald-600' : 'text-rose-600'}>
                      {mov.direction === 'inflow' ? '+' : '-'}{fmt(mov.amount)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(mov)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog registrar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar movimentação de PL</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label htmlFor="eq-type" className="text-xs mb-1 block">Tipo de movimentação</Label>
                <Select value={form.type} onValueChange={(v) => set('type', v)}>
                  <SelectTrigger id="eq-type" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="capital_contribution">Aporte de capital</SelectItem>
                    <SelectItem value="capital_withdrawal">Retirada de capital</SelectItem>
                    <SelectItem value="profit_distribution">Distribuição de lucros</SelectItem>
                    <SelectItem value="reserve_transfer">Transferência para reserva</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="eq-dir" className="text-xs mb-1 block">Direção</Label>
                <Select value={form.direction} onValueChange={(v) => set('direction', v)}>
                  <SelectTrigger id="eq-dir" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inflow">Entrada (aumenta PL)</SelectItem>
                    <SelectItem value="outflow">Saída (reduz PL)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="eq-date" className="text-xs mb-1 block">Data *</Label>
                <Input id="eq-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label htmlFor="eq-amount" className="text-xs mb-1 block">Valor (R$) *</Label>
                <Input id="eq-amount" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0,00" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="eq-desc" className="text-xs mb-1 block">Descrição *</Label>
                <Input id="eq-desc" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Ex: Aporte dos sócios — 1ª rodada" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={isPending || !form.date || !form.amount || !form.description}>
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog excluir */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover movimentação?</AlertDialogTitle>
            <AlertDialogDescription>
              A movimentação de <strong>{fmt(deleteTarget?.amount)}</strong> ({fmtDate(deleteTarget?.date)}) será removida permanentemente.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
