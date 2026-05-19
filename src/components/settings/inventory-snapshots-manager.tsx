'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2, BoxesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
import type { InventorySnapshot } from '@/db/schema'
import { createInventorySnapshot, deleteInventorySnapshot } from '@/server/balance-sheet'

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
  snapshotDate: string
  totalValue: string
  notes: string
}

const EMPTY_FORM: FormState = { snapshotDate: '', totalValue: '', notes: '' }

interface Props {
  items: InventorySnapshot[]
}

export function InventorySnapshotsManager({ items }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<InventorySnapshot | null>(null)

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleSave() {
    startTransition(async () => {
      const result = await createInventorySnapshot({
        snapshotDate: form.snapshotDate,
        totalValue: Number(form.totalValue),
        notes: form.notes || undefined,
      })

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Snapshot de estoque registrado.')
        setDialogOpen(false)
        setForm(EMPTY_FORM)
        router.refresh()
      }
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await deleteInventorySnapshot(deleteTarget.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Snapshot removido.')
        setDeleteTarget(null)
        router.refresh()
      }
    })
  }

  const latest = items[0]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button size="sm" onClick={() => { setForm(EMPTY_FORM); setDialogOpen(true) }}>
          <Plus className="h-4 w-4 mr-1" />
          Novo snapshot
        </Button>
        {latest && (
          <p className="text-xs text-muted-foreground">
            Último snapshot: <span className="font-medium text-foreground">{fmtDate(latest.snapshotDate)}</span>
            {' · '}
            <span className="font-medium tabular-nums text-foreground">{fmt(latest.totalValue)}</span>
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Snapshots de estoque são imutáveis. Para corrigir um valor, remova o snapshot incorreto e insira um novo.
      </p>

      {items.length === 0 ? (
        <EmptyState
          icon={<BoxesIcon className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Nenhum snapshot de estoque registrado"
          description="Registre o valor do estoque periodicamente para compor o Ativo Circulante no Balanço Patrimonial."
        />
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Data do snapshot</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Valor total</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Observações</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((snap, idx) => (
                <tr key={snap.id} className={`hover:bg-muted/20 ${idx === 0 ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''}`}>
                  <td className="px-3 py-2.5">
                    {fmtDate(snap.snapshotDate)}
                    {idx === 0 && (
                      <span className="ml-2 text-xs text-emerald-600 font-medium">mais recente</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">{fmt(snap.totalValue)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate">
                    {snap.notes || '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(snap)}
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

      {/* Dialog criar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo snapshot de estoque</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div>
              <Label htmlFor="sn-date" className="text-xs mb-1 block">Data do levantamento *</Label>
              <Input id="sn-date" type="date" value={form.snapshotDate} onChange={(e) => set('snapshotDate', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sn-val" className="text-xs mb-1 block">Valor total do estoque (R$) *</Label>
              <Input id="sn-val" type="number" step="0.01" min="0" value={form.totalValue} onChange={(e) => set('totalValue', e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <Label htmlFor="sn-notes" className="text-xs mb-1 block">Observações</Label>
              <Input id="sn-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Ex: Contagem física — responsável: João" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={isPending || !form.snapshotDate || !form.totalValue}>
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog excluir */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              O snapshot de <strong>{fmtDate(deleteTarget?.snapshotDate)}</strong> ({fmt(deleteTarget?.totalValue)}) será removido permanentemente.
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
