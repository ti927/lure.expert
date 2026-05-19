'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Landmark } from 'lucide-react'
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
import type { Loan } from '@/db/schema'
import { createLoan, updateLoan, deleteLoan } from '@/server/balance-sheet'

const TYPE_LABELS: Record<string, string> = {
  working_capital: 'Capital de giro',
  investment: 'Investimento',
  payroll: 'Folha de pagamento',
  partner_loan: 'Mútuo de sócio',
  other: 'Outro',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  paid_off: 'Quitado',
  in_default: 'Inadimplente',
  renegotiated: 'Renegociado',
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  paid_off: 'secondary',
  in_default: 'destructive',
  renegotiated: 'outline',
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
  lender: string
  type: string
  originalAmount: string
  currentBalance: string
  interestRateAnnual: string
  startDate: string
  endDate: string
  installmentAmount: string
  installmentCountTotal: string
  installmentCountPaid: string
  status: 'active' | 'paid_off' | 'in_default' | 'renegotiated'
}

const EMPTY_FORM: FormState = {
  name: '',
  lender: '',
  type: 'working_capital',
  originalAmount: '',
  currentBalance: '',
  interestRateAnnual: '',
  startDate: '',
  endDate: '',
  installmentAmount: '',
  installmentCountTotal: '',
  installmentCountPaid: '0',
  status: 'active',
}

function loanToForm(l: Loan): FormState {
  const rate = l.interestRateAnnual
    ? String(Number(l.interestRateAnnual) * 100)
    : ''
  return {
    name: l.name,
    lender: l.lender,
    type: l.type,
    originalAmount: l.originalAmount,
    currentBalance: l.currentBalance,
    interestRateAnnual: rate,
    startDate: l.startDate,
    endDate: l.endDate ?? '',
    installmentAmount: l.installmentAmount ?? '',
    installmentCountTotal: l.installmentCountTotal !== null && l.installmentCountTotal !== undefined ? String(l.installmentCountTotal) : '',
    installmentCountPaid: String(l.installmentCountPaid ?? 0),
    status: l.status as FormState['status'],
  }
}

interface Props {
  items: Loan[]
}

export function LoansManager({ items }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<Loan | null>(null)

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(loan: Loan) {
    setEditingId(loan.id)
    setForm(loanToForm(loan))
    setDialogOpen(true)
  }

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleSave() {
    startTransition(async () => {
      const input = {
        name: form.name,
        lender: form.lender,
        type: form.type as 'working_capital' | 'investment' | 'payroll' | 'partner_loan' | 'other',
        originalAmount: Number(form.originalAmount),
        currentBalance: Number(form.currentBalance),
        interestRateAnnual: form.interestRateAnnual ? Number(form.interestRateAnnual) : undefined,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        installmentAmount: form.installmentAmount ? Number(form.installmentAmount) : undefined,
        installmentCountTotal: form.installmentCountTotal ? Number(form.installmentCountTotal) : undefined,
        installmentCountPaid: Number(form.installmentCountPaid) || 0,
        status: form.status,
      }
      const result = editingId ? await updateLoan(editingId, input) : await createLoan(input)

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(editingId ? 'Empréstimo atualizado.' : 'Empréstimo cadastrado.')
        setDialogOpen(false)
        router.refresh()
      }
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await deleteLoan(deleteTarget.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Empréstimo removido.')
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
          Novo empréstimo
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Landmark className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Nenhum empréstimo cadastrado"
          description='Clique em "Novo empréstimo" para registrar financiamentos e mútuos.'
        />
      ) : (
        <div className="space-y-2">
          {items.map((loan) => {
            const paidPct =
              loan.installmentCountTotal && loan.installmentCountTotal > 0
                ? Math.round(((loan.installmentCountPaid ?? 0) / loan.installmentCountTotal) * 100)
                : null
            return (
              <div key={loan.id} className="rounded-lg border p-4 hover:bg-muted/20">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{loan.name}</span>
                      <Badge variant="outline" className="text-xs">{TYPE_LABELS[loan.type] ?? loan.type}</Badge>
                      <Badge variant={STATUS_VARIANTS[loan.status]}>
                        {STATUS_LABELS[loan.status] ?? loan.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{loan.lender}</p>
                    <div className="flex gap-4 mt-2 flex-wrap">
                      <div>
                        <p className="text-xs text-muted-foreground">Valor original</p>
                        <p className="text-sm font-medium tabular-nums">{fmt(loan.originalAmount)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Saldo devedor</p>
                        <p className="text-sm font-medium tabular-nums text-rose-600">{fmt(loan.currentBalance)}</p>
                      </div>
                      {loan.interestRateAnnual && (
                        <div>
                          <p className="text-xs text-muted-foreground">Taxa a.a.</p>
                          <p className="text-sm tabular-nums">
                            {(Number(loan.interestRateAnnual) * 100).toFixed(2).replace('.', ',')}%
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-muted-foreground">Início</p>
                        <p className="text-sm">{fmtDate(loan.startDate)}</p>
                      </div>
                      {loan.endDate && (
                        <div>
                          <p className="text-xs text-muted-foreground">Vencimento</p>
                          <p className="text-sm">{fmtDate(loan.endDate)}</p>
                        </div>
                      )}
                    </div>
                    {paidPct !== null && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>{loan.installmentCountPaid} de {loan.installmentCountTotal} parcelas pagas</span>
                          <span>{paidPct}%</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${paidPct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(loan)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(loan)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Dialog criar/editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar empréstimo' : 'Novo empréstimo'}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label htmlFor="ln-name" className="text-xs mb-1 block">Nome / Identificação *</Label>
                <Input id="ln-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex: CCB Itaú — jun/24" />
              </div>
              <div>
                <Label htmlFor="ln-lender" className="text-xs mb-1 block">Credor *</Label>
                <Input id="ln-lender" value={form.lender} onChange={(e) => set('lender', e.target.value)} placeholder="Ex: Banco Itaú" />
              </div>
              <div>
                <Label htmlFor="ln-type" className="text-xs mb-1 block">Tipo</Label>
                <Select value={form.type} onValueChange={(v) => set('type', v)}>
                  <SelectTrigger id="ln-type" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="working_capital">Capital de giro</SelectItem>
                    <SelectItem value="investment">Investimento</SelectItem>
                    <SelectItem value="payroll">Folha de pagamento</SelectItem>
                    <SelectItem value="partner_loan">Mútuo de sócio</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ln-orig" className="text-xs mb-1 block">Valor original (R$) *</Label>
                <Input id="ln-orig" type="number" step="0.01" min="0" value={form.originalAmount} onChange={(e) => set('originalAmount', e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <Label htmlFor="ln-bal" className="text-xs mb-1 block">Saldo devedor atual (R$) *</Label>
                <Input id="ln-bal" type="number" step="0.01" min="0" value={form.currentBalance} onChange={(e) => set('currentBalance', e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <Label htmlFor="ln-rate" className="text-xs mb-1 block">Taxa a.a. (%)</Label>
                <Input id="ln-rate" type="number" step="0.01" min="0" max="999" value={form.interestRateAnnual} onChange={(e) => set('interestRateAnnual', e.target.value)} placeholder="Ex: 18.50" />
              </div>
              <div>
                <Label htmlFor="ln-status" className="text-xs mb-1 block">Status</Label>
                <Select value={form.status} onValueChange={(v) => set('status', v)}>
                  <SelectTrigger id="ln-status" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="paid_off">Quitado</SelectItem>
                    <SelectItem value="in_default">Inadimplente</SelectItem>
                    <SelectItem value="renegotiated">Renegociado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ln-start" className="text-xs mb-1 block">Data de início *</Label>
                <Input id="ln-start" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ln-end" className="text-xs mb-1 block">Data de vencimento</Label>
                <Input id="ln-end" type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ln-inst-val" className="text-xs mb-1 block">Valor da parcela (R$)</Label>
                <Input id="ln-inst-val" type="number" step="0.01" min="0" value={form.installmentAmount} onChange={(e) => set('installmentAmount', e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <Label htmlFor="ln-inst-tot" className="text-xs mb-1 block">Total de parcelas</Label>
                <Input id="ln-inst-tot" type="number" min="1" value={form.installmentCountTotal} onChange={(e) => set('installmentCountTotal', e.target.value)} placeholder="Ex: 36" />
              </div>
              <div>
                <Label htmlFor="ln-inst-paid" className="text-xs mb-1 block">Parcelas pagas</Label>
                <Input id="ln-inst-paid" type="number" min="0" value={form.installmentCountPaid} onChange={(e) => set('installmentCountPaid', e.target.value)} placeholder="0" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={isPending || !form.name || !form.lender || !form.originalAmount || !form.currentBalance || !form.startDate}>
              {editingId ? 'Salvar' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog excluir */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover empréstimo?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> será removido permanentemente do cadastro.
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
