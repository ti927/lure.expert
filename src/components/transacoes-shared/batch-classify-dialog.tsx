'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { batchClassifyTransactions } from '@/server/transactions'
import { BatchCombobox } from './cell-combobox'
import { CATEGORY_TYPE_LABELS } from './types'
import type { CategoryItem, SimpleDimensionItem, BatchFormState, GroupedDimensionOption, DimensionOption } from './types'

interface BatchClassifyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedIds: string[]
  categories: CategoryItem[]
  costCenters: SimpleDimensionItem[]
  businessUnits: SimpleDimensionItem[]
  legalEntities: SimpleDimensionItem[]
  onSuccess?: (updated: number) => void
}

export function BatchClassifyDialog({
  open,
  onOpenChange,
  selectedIds,
  categories,
  costCenters,
  businessUnits,
  legalEntities,
  onSuccess,
}: BatchClassifyDialogProps) {
  const [batchForm, setBatchForm] = useState<BatchFormState>({
    categoryId: '', costCenterId: '', businessUnitId: '', legalEntityId: '',
  })
  const [isBatching, setIsBatching] = useState(false)

  // Categorias: filtra apenas folhas e agrupa por tipo
  const parentIds = new Set(categories.map(c => c.parentId).filter(Boolean) as string[])
  const leafCategories = categories.filter(c => !parentIds.has(c.id))
  const allCategoryOptions: DimensionOption[] = leafCategories.map(c => ({
    id: c.id,
    label: c.code ? `${c.code} – ${c.name}` : c.name,
  }))
  const groupedCategories: GroupedDimensionOption[] = Object.entries(
    leafCategories.reduce((acc, c) => {
      if (!acc[c.type]) acc[c.type] = []
      acc[c.type].push({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name })
      return acc
    }, {} as Record<string, DimensionOption[]>)
  ).map(([type, items]) => ({ type, items }))

  // Sentinel: '' = não alterar; '__null__' = gravar NULL; uuid = setar valor
  function resolveField(v: string): string | null | undefined {
    if (v === '') return undefined
    if (v === '__null__') return null
    return v || undefined
  }

  async function handleBatchClassify() {
    const payload = {
      categoryId:     resolveField(batchForm.categoryId),
      costCenterId:   resolveField(batchForm.costCenterId),
      businessUnitId: resolveField(batchForm.businessUnitId),
      legalEntityId:  resolveField(batchForm.legalEntityId),
    }
    if (Object.values(payload).every(v => v === undefined)) {
      toast.error('Selecione ao menos uma dimensão.')
      return
    }
    setIsBatching(true)
    try {
      const result = await batchClassifyTransactions(selectedIds, payload)
      if (result && 'error' in result) {
        toast.error(result.error)
      } else if (result?.updated !== undefined) {
        toast.success(`${result.updated} transaç${result.updated !== 1 ? 'ões' : 'ão'} classificada${result.updated !== 1 ? 's' : ''}.`)
        onOpenChange(false)
        setBatchForm({ categoryId: '', costCenterId: '', businessUnitId: '', legalEntityId: '' })
        onSuccess?.(result.updated)
      }
    } catch {
      toast.error('Erro ao classificar. Tente novamente.')
    } finally {
      setIsBatching(false)
    }
  }

  // Silencia warning de variável não utilizada caso onSuccess seja undefined
  void CATEGORY_TYPE_LABELS

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Classificar {selectedIds.length} transaç{selectedIds.length !== 1 ? 'ões' : 'ão'} em lote</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Selecione as dimensões que deseja aplicar. Campos em branco não serão alterados.</p>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Categoria</p>
            <BatchCombobox value={batchForm.categoryId} options={allCategoryOptions} placeholder="Não alterar" onValueChange={v => setBatchForm(prev => ({ ...prev, categoryId: v }))} grouped={groupedCategories} />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Centro de custo</p>
            <BatchCombobox value={batchForm.costCenterId} options={costCenters.map(c => ({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name }))} placeholder="Não alterar" onValueChange={v => setBatchForm(prev => ({ ...prev, costCenterId: v }))} />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Unidade de negócio</p>
            <BatchCombobox value={batchForm.businessUnitId} options={businessUnits.map(c => ({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name }))} placeholder="Não alterar" onValueChange={v => setBatchForm(prev => ({ ...prev, businessUnitId: v }))} />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Entidade jurídica</p>
            <BatchCombobox value={batchForm.legalEntityId} options={legalEntities.map(c => ({ id: c.id, label: c.name }))} placeholder="Não alterar" onValueChange={v => setBatchForm(prev => ({ ...prev, legalEntityId: v }))} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
          <Button size="sm" onClick={handleBatchClassify} disabled={isBatching}>{isBatching ? 'Classificando...' : 'Classificar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
