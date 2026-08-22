'use client'

import { useEffect, useState, useTransition, useMemo } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { SimpleDimensionItem } from './types'
import { WeightRowsEditor, novaLinhaPeso, type WeightRow } from './weight-rows-editor'
import { AllocationTemplateBar } from './allocation-template-bar'
import {
  previewBatchAllocation, applyBatchAllocation, type BatchPreviewRow,
} from '@/server/allocations'
import type { TemplateRow, TemplateLineInput } from '@/server/allocation-templates'

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

export function BatchAllocationDialog({
  open, onOpenChange, selectedIds,
  costCenters, businessUnits, legalEntities, contacts, onSaved,
}: Props) {
  const [pesos, setPesos] = useState<WeightRow[]>([])
  const [preview, setPreview] = useState<BatchPreviewRow[] | null>(null)
  const [jaRateados, setJaRateados] = useState(0)
  // Modelo de origem; cai na primeira edição, como no diálogo individual.
  const [modelo, setModelo] = useState<string | null>(null)
  const [isBusy, startBusy] = useTransition()

  useEffect(() => {
    if (!open) { setPesos([]); setPreview(null); setJaRateados(0); setModelo(null); return }
    setPesos([novaLinhaPeso(60), novaLinhaPeso(40)])
    setPreview(null)
    setModelo(null)
  }, [open])

  const somaPesos = pesos.reduce((a, p) => a + (Number.isFinite(p.weight) ? p.weight : 0), 0)

  /** Qualquer mexida invalida a prévia e o carimbo do modelo. */
  function mudouPesos(rows: WeightRow[]) {
    setPesos(rows)
    setPreview(null)
    setModelo(null)
  }

  function aplicarModelo(t: TemplateRow) {
    setPesos(t.lines.map(l => ({
      ...novaLinhaPeso(l.weight),
      costCenterId: l.costCenterId, businessUnitId: l.businessUnitId,
      legalEntityId: l.legalEntityId, contactId: l.contactId,
    })))
    setPreview(null)
    setModelo(t.id)
  }

  const linhasParaModelo: TemplateLineInput[] | null = useMemo(() => {
    if (pesos.length < 2 || pesos.some(p => !(p.weight > 0))) return null
    return pesos.map(p => ({
      weight: p.weight,
      costCenterId: p.costCenterId, businessUnitId: p.businessUnitId,
      legalEntityId: p.legalEntityId, contactId: p.contactId,
    }))
  }, [pesos])

  const paraServidor = () => pesos.map(p => ({
    weight: p.weight, costCenterId: p.costCenterId, businessUnitId: p.businessUnitId,
    legalEntityId: p.legalEntityId, contactId: p.contactId,
  }))

  function gerarPrevia() {
    startBusy(async () => {
      const r = await previewBatchAllocation(selectedIds, paraServidor())
      if ('error' in r) { toast.error(r.error); return }
      setPreview(r.rows)
      setJaRateados(r.jaRateados)
    })
  }

  function aplicar() {
    startBusy(async () => {
      const r = await applyBatchAllocation(selectedIds, paraServidor(), modelo)
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

        <AllocationTemplateBar
          applied={modelo}
          onApply={aplicarModelo}
          currentLines={linhasParaModelo}
        />

        <WeightRowsEditor
          rows={pesos}
          onChange={mudouPesos}
          costCenters={costCenters}
          businessUnits={businessUnits}
          legalEntities={legalEntities}
          contacts={contacts}
        />

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
