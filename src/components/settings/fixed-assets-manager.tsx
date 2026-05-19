'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Package } from 'lucide-react'
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
import type { FixedAsset } from '@/db/schema'
import { createFixedAsset, updateFixedAsset, deleteFixedAsset } from '@/server/balance-sheet'

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  sold: 'Vendido',
  written_off: 'Baixado',
  disposed: 'Descartado',
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  sold: 'secondary',
  written_off: 'destructive',
  disposed: 'outline',
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
  name: string
  description: string
  acquisitionDate: string
  acquisitionValue: string
  currentValue: string
  depreciationMethod: string
  usefulLifeMonths: string
  monthlyDepreciation: string
  status: 'active' | 'sold' | 'written_off' | 'disposed'
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  acquisitionDate: '',
  acquisitionValue: '',
  currentValue: '',
  depreciationMethod: '',
  usefulLifeMonths: '',
  monthlyDepreciation: '',
  status: 'active',
}

function assetToForm(a: FixedAsset): FormState {
  return {
    name: a.name,
    description: a.description ?? '',
    acquisitionDate: a.acquisitionDate,
    acquisitionValue: a.acquisitionValue,
    currentValue: a.currentValue,
    depreciationMethod: a.depreciationMethod ?? '',
    usefulLifeMonths: a.usefulLifeMonths !== null && a.usefulLifeMonths !== undefined ? String(a.usefulLifeMonths) : '',
    monthlyDepreciation: a.monthlyDepreciation ?? '',
    status: a.status as FormState['status'],
  }
}

interface Props {
  items: FixedAsset[]
}

export function FixedAssetsManager({ items }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<FixedAsset | null>(null)

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(asset: FixedAsset) {
    setEditingId(asset.id)
    setForm(assetToForm(asset))
    setDialogOpen(true)
  }

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleSave() {
    startTransition(async () => {
      const input = {
        name: form.name,
        description: form.description || undefined,
        acquisitionDate: form.acquisitionDate,
        acquisitionValue: Number(form.acquisitionValue),
        currentValue: Number(form.currentValue),
        depreciationMethod: form.depreciationMethod || undefined,
        usefulLifeMonths: form.usefulLifeMonths ? Number(form.usefulLifeMonths) : undefined,
        monthlyDepreciation: form.monthlyDepreciation ? Number(form.monthlyDepreciation) : undefined,
        status: form.status,
      }
      const result = editingId
        ? await updateFixedAsset(editingId, input)
        : await createFixedAsset(input)

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(editingId ? 'Imobilizado atualizado.' : 'Imobilizado cadastrado.')
        setDialogOpen(false)
        router.refresh()
      }
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await deleteFixedAsset(deleteTarget.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Imobilizado removido.')
        setDeleteTarget(null)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Novo imobilizado
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Package className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Nenhum imobilizado cadastrado"
          description='Clique em "Novo imobilizado" para registrar bens como equipamentos, veículos e móveis.'
        />
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Nome</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Aquisição</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Vlr. Aquisição</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Vlr. Atual</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Deprec./mês</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((asset) => (
                <tr key={asset.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2.5">
                    <span className="font-medium">{asset.name}</span>
                    {asset.description && (
                      <p className="text-xs text-muted-foreground">{asset.description}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(asset.acquisitionDate)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(asset.acquisitionValue)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(asset.currentValue)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {asset.monthlyDepreciation ? fmt(asset.monthlyDepreciation) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant={STATUS_VARIANTS[asset.status]}>
                      {STATUS_LABELS[asset.status] ?? asset.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(asset)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(asset)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog criar/editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar imobilizado' : 'Novo imobilizado'}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label htmlFor="fa-name" className="text-xs mb-1 block">Nome *</Label>
                <Input id="fa-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex: Notebook Dell" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="fa-desc" className="text-xs mb-1 block">Descrição</Label>
                <Input id="fa-desc" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Detalhes opcionais" />
              </div>
              <div>
                <Label htmlFor="fa-date" className="text-xs mb-1 block">Data de aquisição *</Label>
                <Input id="fa-date" type="date" value={form.acquisitionDate} onChange={(e) => set('acquisitionDate', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="fa-status" className="text-xs mb-1 block">Status</Label>
                <Select value={form.status} onValueChange={(v) => set('status', v)}>
                  <SelectTrigger id="fa-status" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="sold">Vendido</SelectItem>
                    <SelectItem value="written_off">Baixado</SelectItem>
                    <SelectItem value="disposed">Descartado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="fa-acq-val" className="text-xs mb-1 block">Valor de aquisição (R$) *</Label>
                <Input id="fa-acq-val" type="number" step="0.01" min="0" value={form.acquisitionValue} onChange={(e) => set('acquisitionValue', e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <Label htmlFor="fa-cur-val" className="text-xs mb-1 block">Valor atual (R$) *</Label>
                <Input id="fa-cur-val" type="number" step="0.01" min="0" value={form.currentValue} onChange={(e) => set('currentValue', e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <Label htmlFor="fa-life" className="text-xs mb-1 block">Vida útil (meses)</Label>
                <Input id="fa-life" type="number" min="1" value={form.usefulLifeMonths} onChange={(e) => set('usefulLifeMonths', e.target.value)} placeholder="Ex: 60" />
              </div>
              <div>
                <Label htmlFor="fa-dep" className="text-xs mb-1 block">Depreciação mensal (R$)</Label>
                <Input id="fa-dep" type="number" step="0.01" min="0" value={form.monthlyDepreciation} onChange={(e) => set('monthlyDepreciation', e.target.value)} placeholder="0,00" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="fa-method" className="text-xs mb-1 block">Método de depreciação</Label>
                <Input id="fa-method" value={form.depreciationMethod} onChange={(e) => set('depreciationMethod', e.target.value)} placeholder="Ex: Linear" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={isPending || !form.name || !form.acquisitionDate || !form.acquisitionValue || !form.currentValue}>
              {editingId ? 'Salvar' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog excluir */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover imobilizado?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> será removido permanentemente do cadastro de imobilizado.
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
