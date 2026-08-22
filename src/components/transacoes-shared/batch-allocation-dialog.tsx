'use client'

import { useEffect, useState, useTransition } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CellCombobox } from './cell-combobox'
import type { SimpleDimensionItem } from './types'
import {
  previewBatchAllocation, applyBatchAllocation,
  type AllocationWeight, type BatchPreviewRow,
} from '@/server/allocations'

interface Peso extends AllocationWeight { key: string; texto: string }

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  selectedIds:  string[]
  costCenters:   SimpleDimensionItem[]
  businessUnits: SimpleDimensionItem[]
  legalEntities: SimpleDimensionItem[]
  contacts:      SimpleDimensionItem[]
  onSaved:      () => void
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let seq = 0
const novoPeso = (weight = 50): Peso => ({
  key: `w${++seq}`, weight, texto: String(weight),
  costCenterId: null, businessUnitId: null, legalEntityId: null, contactId: null,
})

export function BatchAllocationDialog({
  open, onOpenChange, selectedIds,
  costCenters, businessUnits, legalEntities, contacts, onSaved,
}: Props) {
  const [pesos, setPesos] = useState<Peso[]>([])
  const [preview, setPreview] = useState<BatchPreviewRow[] | null>(null)
  const [jaRateados, setJaRateados] = useState(0)
  const [isBusy, startBusy] = useTransition()

  useEffect(() => {
    if (!open) { setPesos([]); setPreview(null); setJaRateados(0); return }
    setPesos([novoPeso(60), novoPeso(40)])
    setPreview(null)
  }, [open])

  const somaPesos = pesos.reduce((a, p) => a + (Number.isFinite(p.weight) ? p.weight : 0), 0)

  function patch(key: string, next: Partial<Peso>) {
    setPesos(prev => prev.map(p => p.key === key ? { ...p, ...next } : p))
    setPreview(null)
  }

  function gerarPrevia() {
    startBusy(async () => {
      const r = await previewBatchAllocation(selectedIds, pesos.map(p => ({
        weight: p.weight, costCenterId: p.costCenterId, businessUnitId: p.businessUnitId,
        legalEntityId: p.legalEntityId, contactId: p.contactId,
      })))
      if ('error' in r) { toast.error(r.error); return }
      setPreview(r.rows)
      setJaRateados(r.jaRateados)
    })
  }

  function aplicar() {
    startBusy(async () => {
      const r = await applyBatchAllocation(selectedIds, pesos.map(p => ({
        weight: p.weight, costCenterId: p.costCenterId, businessUnitId: p.businessUnitId,
        legalEntityId: p.legalEntityId, contactId: p.contactId,
      })))
      if ('error' in r && r.error) { toast.error(r.error); return }
      toast.success(`Rateio aplicado a ${'aplicados' in r ? r.aplicados : 0} lançamentos.`)
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Ratear {selectedIds.length} lançamentos</DialogTitle>
          <DialogDescription>
            Lançamentos de valores diferentes só podem dividir a mesma proporção. A prévia mostra os
            valores que cada um receberá, já fechados no centavo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-medium w-20">Peso</th>
                <th className="px-2 py-1.5 font-medium">Centro de custo</th>
                <th className="px-2 py-1.5 font-medium">Un. de negócio</th>
                <th className="px-2 py-1.5 font-medium">Entidade</th>
                <th className="px-2 py-1.5 font-medium">Contato</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {pesos.map(p => (
                <tr key={p.key} className="border-b last:border-0">
                  <td className="px-2 py-1">
                    <input
                      value={p.texto}
                      onChange={e => {
                        const n = Number(e.target.value.replace(',', '.'))
                        patch(p.key, { texto: e.target.value, weight: Number.isFinite(n) ? n : 0 })
                      }}
                      inputMode="decimal"
                      className="w-full h-7 rounded border border-input px-1.5 text-right tabular-nums bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <CellCombobox value={p.costCenterId} options={costCenters}
                      onValueChange={v => patch(p.key, { costCenterId: v })} />
                  </td>
                  <td className="px-1 py-1">
                    <CellCombobox value={p.businessUnitId} options={businessUnits}
                      onValueChange={v => patch(p.key, { businessUnitId: v })} />
                  </td>
                  <td className="px-1 py-1">
                    <CellCombobox value={p.legalEntityId} options={legalEntities}
                      onValueChange={v => patch(p.key, { legalEntityId: v })} />
                  </td>
                  <td className="px-1 py-1">
                    <CellCombobox value={p.contactId} options={contacts}
                      onValueChange={v => patch(p.key, { contactId: v })} />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <button
                      onClick={() => { setPesos(prev => prev.filter(x => x.key !== p.key)); setPreview(null) }}
                      disabled={pesos.length <= 1}
                      className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-30"
                      aria-label="Remover"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setPesos(prev => [...prev, novoPeso(0)]); setPreview(null) }}>
              <Plus className="h-3.5 w-3.5 mr-1" />Adicionar parte
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              Os pesos são relativos — {pesos.map(p => p.weight).join(' : ')} soma {somaPesos}
              {somaPesos !== 100 && ' (não precisa dar 100)'}
            </span>
          </div>
        </div>

        {preview && (
          <div className="border-t pt-2 space-y-2">
            {jaRateados > 0 && (
              <p className="text-[11px] text-amber-600">
                {jaRateados} {jaRateados === 1 ? 'lançamento já tem rateio e será substituído' : 'lançamentos já têm rateio e serão substituídos'}.
              </p>
            )}
            <div className="max-h-[40vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-1.5 font-medium">Lançamento</th>
                    <th className="px-2 py-1.5 font-medium text-right w-28">Valor</th>
                    {pesos.map((p, i) => (
                      <th key={p.key} className="px-2 py-1.5 font-medium text-right w-28">Parte {i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map(r => (
                    <tr key={r.transactionId} className="border-b last:border-0">
                      <td className="px-2 py-1 truncate max-w-[240px]" title={r.description}>{r.description}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(r.amount)}</td>
                      {r.parts.map((v, i) => (
                        <td key={i} className="px-2 py-1 text-right tabular-nums">{fmt(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isBusy}>Cancelar</Button>
          {!preview ? (
            <Button size="sm" onClick={gerarPrevia} disabled={isBusy || somaPesos <= 0}>
              {isBusy ? 'Calculando…' : 'Ver prévia'}
            </Button>
          ) : (
            <Button size="sm" onClick={aplicar} disabled={isBusy}>
              {isBusy ? 'Aplicando…' : `Aplicar a ${preview.length} lançamentos`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
