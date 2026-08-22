'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CellCombobox } from './cell-combobox'
import type { SimpleDimensionItem } from './types'
import { formatProportion } from '@/lib/allocation-math'

/**
 * Uma linha de proporção: peso relativo + as quatro dimensões.
 *
 * `texto` existe separado de `weight` porque o campo precisa aceitar estados
 * intermediários de digitação ("33," antes do resto) sem que o número por trás
 * vire NaN e derrube a soma exibida.
 */
export interface WeightRow {
  key:            string
  weight:         number
  texto:          string
  costCenterId:   string | null
  businessUnitId: string | null
  legalEntityId:  string | null
  contactId:      string | null
}

let seq = 0
export function novaLinhaPeso(weight = 0): WeightRow {
  return {
    key: `w${++seq}`, weight, texto: weight ? String(weight) : '',
    costCenterId: null, businessUnitId: null, legalEntityId: null, contactId: null,
  }
}

interface Props {
  rows:     WeightRow[]
  onChange: (rows: WeightRow[]) => void
  costCenters:   SimpleDimensionItem[]
  businessUnits: SimpleDimensionItem[]
  legalEntities: SimpleDimensionItem[]
  contacts:      SimpleDimensionItem[]
  maxRows?: number
  /** Mínimo de linhas; abaixo dele o botão de remover fica desabilitado. */
  minRows?: number
}

/**
 * Editor de proporção compartilhado pelo rateio em lote e pelo editor de
 * modelos — nos dois casos o que se descreve é a mesma coisa: como dividir um
 * valor que ainda não se conhece.
 */
export function WeightRowsEditor({
  rows, onChange, costCenters, businessUnits, legalEntities, contacts,
  maxRows = 50, minRows = 1,
}: Props) {
  const pesos = rows.map(r => (Number.isFinite(r.weight) ? r.weight : 0))
  const soma = pesos.reduce((a, w) => a + w, 0)

  const patch = (key: string, next: Partial<WeightRow>) =>
    onChange(rows.map(r => (r.key === key ? { ...r, ...next } : r)))

  return (
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
          {rows.map(r => (
            <tr key={r.key} className="border-b last:border-0">
              <td className="px-2 py-1">
                <input
                  value={r.texto}
                  onChange={e => {
                    const n = Number(e.target.value.replace(',', '.'))
                    patch(r.key, { texto: e.target.value, weight: Number.isFinite(n) ? n : 0 })
                  }}
                  inputMode="decimal"
                  className="w-full h-7 rounded border border-input px-1.5 text-right tabular-nums bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </td>
              <td className="px-1 py-1">
                <CellCombobox value={r.costCenterId} options={costCenters}
                  onValueChange={v => patch(r.key, { costCenterId: v })} />
              </td>
              <td className="px-1 py-1">
                <CellCombobox value={r.businessUnitId} options={businessUnits}
                  onValueChange={v => patch(r.key, { businessUnitId: v })} />
              </td>
              <td className="px-1 py-1">
                <CellCombobox value={r.legalEntityId} options={legalEntities}
                  onValueChange={v => patch(r.key, { legalEntityId: v })} />
              </td>
              <td className="px-1 py-1">
                <CellCombobox value={r.contactId} options={contacts}
                  onValueChange={v => patch(r.key, { contactId: v })} />
              </td>
              <td className="px-1 py-1 text-center">
                <button
                  onClick={() => onChange(rows.filter(x => x.key !== r.key))}
                  disabled={rows.length <= minRows}
                  className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-30"
                  aria-label="Remover parte"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={rows.length >= maxRows}
          onClick={() => onChange([...rows, novaLinhaPeso()])}>
          <Plus className="h-3.5 w-3.5 mr-1" />Adicionar parte
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {soma > 0
            ? <>Proporção <span className="font-medium text-foreground tabular-nums">{formatProportion(pesos)}</span> — os pesos são relativos, não precisam somar 100</>
            : 'Preencha os pesos'}
        </span>
      </div>
    </div>
  )
}
