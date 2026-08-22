'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { CellCombobox, CategoryCellCombobox } from '@/components/transacoes-shared/cell-combobox'
import type { CategoryItem, SimpleDimensionItem } from '@/components/transacoes-shared/types'
import { createRule, updateRule, type RuleInput } from '@/server/categorization-rules'

export interface RuleInitialValues {
  id?: string
  description: string
  accountId: string | null
  targetCategoryId: string | null
  targetCostCenterId: string | null
  targetBusinessUnitId: string | null
  targetLegalEntityId: string | null
  targetContactId: string | null
}

export interface AccountOption {
  accountId: string
  label: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  initial: RuleInitialValues
  categories: CategoryItem[]
  costCenters: SimpleDimensionItem[]
  businessUnits: SimpleDimensionItem[]
  legalEntities: SimpleDimensionItem[]
  contacts: SimpleDimensionItem[]
  accounts: AccountOption[]
  onSaved: () => void
}

export function RuleEditDialog({
  open, onOpenChange, mode, initial,
  categories, costCenters, businessUnits, legalEntities, contacts, accounts,
  onSaved,
}: Props) {
  const [description, setDescription] = useState(initial.description)
  const [accountId, setAccountId] = useState<string | null>(initial.accountId)
  const [targetCategoryId, setTargetCategoryId] = useState<string | null>(initial.targetCategoryId)
  const [targetCostCenterId, setTargetCostCenterId] = useState<string | null>(initial.targetCostCenterId)
  const [targetBusinessUnitId, setTargetBusinessUnitId] = useState<string | null>(initial.targetBusinessUnitId)
  const [targetLegalEntityId, setTargetLegalEntityId] = useState<string | null>(initial.targetLegalEntityId)
  const [targetContactId, setTargetContactId] = useState<string | null>(initial.targetContactId)
  const [isSaving, startTransition] = useTransition()

  useEffect(() => {
    if (open) {
      setDescription(initial.description)
      setAccountId(initial.accountId)
      setTargetCategoryId(initial.targetCategoryId)
      setTargetCostCenterId(initial.targetCostCenterId)
      setTargetBusinessUnitId(initial.targetBusinessUnitId)
      setTargetLegalEntityId(initial.targetLegalEntityId)
      setTargetContactId(initial.targetContactId)
    }
  }, [open, initial])

  const accountOptions: SimpleDimensionItem[] = accounts.map(a => ({ id: a.accountId, name: a.label }))

  const hasTarget = !!(targetCategoryId || targetCostCenterId || targetBusinessUnitId || targetLegalEntityId || targetContactId)
  const trimmedDesc = description.trim()
  const canSubmit = trimmedDesc.length > 0 && hasTarget

  function handleSubmit() {
    if (!canSubmit) return

    const input: RuleInput = {
      description: trimmedDesc,
      accountId,
      targetCategoryId,
      targetCostCenterId,
      targetBusinessUnitId,
      targetLegalEntityId,
      targetContactId,
    }

    startTransition(async () => {
      const result = mode === 'create'
        ? await createRule(input)
        : await updateRule(initial.id!, input)

      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success(mode === 'create' ? 'Regra criada.' : 'Regra atualizada.')
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Nova regra' : 'Editar regra'}</DialogTitle>
          <DialogDescription>
            Toda transação cuja descrição contenha o trecho abaixo (e da conta escolhida, se houver) receberá os alvos definidos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Descrição */}
          <div className="space-y-2">
            <Label htmlFor="rule-desc" className="text-xs">Descrição a casar</Label>
            <textarea
              id="rule-desc"
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, 200))}
              placeholder="Ex.: Pix enviado MARIA DE FATIMA"
              rows={2}
              className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            <p className="text-[11px] text-muted-foreground">
              Match por <span className="font-medium">substring case-insensitive</span> em <code className="text-[10px]">transactions.description</code>. {description.length}/200.
            </p>
          </div>

          {/* Conta */}
          <div className="space-y-2">
            <Label className="text-xs">Conta (opcional)</Label>
            <CellCombobox
              value={accountId}
              options={accountOptions}
              placeholder="Todas as contas"
              onValueChange={setAccountId}
            />
            <p className="text-[11px] text-muted-foreground">
              Sem conta, a regra é global. Com conta, só dispara para transações dessa conta específica.
            </p>
          </div>

          <div className="h-px bg-border my-1" />

          {/* Alvos */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2 col-span-2">
              <Label className="text-xs">Categoria-alvo</Label>
              <CategoryCellCombobox
                value={targetCategoryId}
                categories={categories}
                onValueChange={setTargetCategoryId}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Centro de custo</Label>
              <CellCombobox
                value={targetCostCenterId}
                options={costCenters}
                onValueChange={setTargetCostCenterId}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Unidade de negócio</Label>
              <CellCombobox
                value={targetBusinessUnitId}
                options={businessUnits}
                onValueChange={setTargetBusinessUnitId}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Entidade jurídica</Label>
              <CellCombobox
                value={targetLegalEntityId}
                options={legalEntities}
                onValueChange={setTargetLegalEntityId}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Contato</Label>
              <CellCombobox
                value={targetContactId}
                options={contacts}
                onValueChange={setTargetContactId}
              />
            </div>
          </div>

          {!hasTarget && (
            <p className="text-[11px] text-amber-600">
              Selecione pelo menos um alvo para salvar.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isSaving}>
            {isSaving ? 'Salvando…' : mode === 'create' ? 'Criar regra' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
