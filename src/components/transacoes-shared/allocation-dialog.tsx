'use client'

import { useEffect, useState, useTransition, useMemo } from 'react'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CellCombobox } from './cell-combobox'
import { AllocationTemplateBar } from './allocation-template-bar'
import type { SimpleDimensionItem } from './types'
import {
  toCents, splitEqually, remainingCents, pctOf, centsFromPct, applyProportion, reduceWeights,
} from '@/lib/allocation-math'
import {
  getAllocations, saveAllocations, removeAllocations, type AllocationPart,
} from '@/server/allocations'
import type { TemplateRow, TemplateLineInput } from '@/server/allocation-templates'

interface Parte {
  /** Chave estável de renderização — as partes não têm id até serem salvas. */
  key:            string
  /** A verdade do valor. Os dois campos de texto abaixo só o alimentam. */
  cents:          number
  valorTexto:     string
  pctTexto:       string
  costCenterId:   string | null
  businessUnitId: string | null
  legalEntityId:  string | null
  contactId:      string | null
}

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  transaction:  { id: string; description: string; amount: string | number } | null
  costCenters:   SimpleDimensionItem[]
  businessUnits: SimpleDimensionItem[]
  legalEntities: SimpleDimensionItem[]
  contacts:      SimpleDimensionItem[]
  onSaved:      () => void
}

const fmt = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let seq = 0
const novaKey = () => `p${++seq}`

function parteVazia(cents = 0): Parte {
  return {
    key: novaKey(), cents,
    valorTexto: cents ? fmt(cents) : '',
    pctTexto: '',
    costCenterId: null, businessUnitId: null, legalEntityId: null, contactId: null,
  }
}

export function AllocationDialog({
  open, onOpenChange, transaction,
  costCenters, businessUnits, legalEntities, contacts, onSaved,
}: Props) {
  const [partes, setPartes] = useState<Parte[]>([])
  const [tinhaRateio, setTinhaRateio] = useState(false)
  // Modelo de origem. Cai para null na primeira edição manual: o carimbo tem de
  // significar "saiu deste modelo como está", senão a contagem de uso da tela
  // de modelos vira um número que não quer dizer nada.
  const [modelo, setModelo] = useState<string | null>(null)
  const [isLoading, startLoading] = useTransition()
  const [isSaving, startSaving]   = useTransition()

  const totalCents = transaction ? toCents(transaction.amount) : 0
  const somaCents  = partes.reduce((a, p) => a + p.cents, 0)
  const faltam     = remainingCents(totalCents, partes.map(p => p.cents))

  useEffect(() => {
    if (!open || !transaction) { setPartes([]); setTinhaRateio(false); setModelo(null); return }
    startLoading(async () => {
      const existentes = await getAllocations(transaction.id)
      if (existentes.length > 0) {
        setTinhaRateio(true)
        setModelo(existentes[0].allocationTemplateId)
        setPartes(existentes.map(a => {
          const cents = toCents(a.amount)
          return {
            key: novaKey(), cents,
            valorTexto: fmt(cents),
            pctTexto: String(pctOf(cents, toCents(transaction.amount))).replace('.', ','),
            costCenterId: a.costCenterId, businessUnitId: a.businessUnitId,
            legalEntityId: a.legalEntityId, contactId: a.contactId,
          }
        }))
      } else {
        // Duas partes vazias é o começo mais comum, e já mostra a mecânica.
        setTinhaRateio(false)
        setModelo(null)
        setPartes([parteVazia(), parteVazia()])
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction?.id])

  /** Toda edição manual passa por aqui — e derruba o carimbo do modelo. */
  function patch(key: string, next: Partial<Parte>) {
    setModelo(null)
    setPartes(prev => prev.map(p => p.key === key ? { ...p, ...next } : p))
  }

  /**
   * Aplica um modelo: a proporção salva vira valores fechados no centavo para
   * ESTE lançamento. É `applyProportion` (maior resto) quem distribui a sobra,
   * o mesmo caminho do rateio em lote — nenhum centavo se perde no meio.
   */
  function aplicarModelo(t: TemplateRow) {
    const valores = applyProportion(totalCents, t.lines.map(l => l.weight))
    setPartes(t.lines.map((l, i) => {
      const cents = valores[i] ?? 0
      return {
        key: novaKey(), cents,
        valorTexto: fmt(cents),
        pctTexto: totalCents ? String(pctOf(cents, totalCents)).replace('.', ',') : '',
        costCenterId: l.costCenterId, businessUnitId: l.businessUnitId,
        legalEntityId: l.legalEntityId, contactId: l.contactId,
      }
    }))
    setModelo(t.id)
  }

  /** Digitou em reais: o valor manda, o percentual acompanha. */
  function mudouValor(key: string, texto: string) {
    const cents = toCents(texto)
    patch(key, {
      valorTexto: texto,
      cents,
      pctTexto: totalCents ? String(pctOf(cents, totalCents)).replace('.', ',') : '',
    })
  }

  /** Digitou em percentual: vira valor, e o valor é o que será gravado. */
  function mudouPct(key: string, texto: string) {
    const pct = Number(texto.replace(',', '.'))
    if (!Number.isFinite(pct)) { patch(key, { pctTexto: texto }); return }
    const cents = centsFromPct(pct, totalCents)
    patch(key, { pctTexto: texto, cents, valorTexto: fmt(cents) })
  }

  function dividirIgualmente() {
    setModelo(null)
    const valores = splitEqually(totalCents, partes.length || 1)
    setPartes(prev => prev.map((p, i) => ({
      ...p,
      cents: valores[i] ?? 0,
      valorTexto: fmt(valores[i] ?? 0),
      pctTexto: totalCents ? String(pctOf(valores[i] ?? 0, totalCents)).replace('.', ',') : '',
    })))
  }

  /** Joga o que falta nesta parte — o atalho que fecha a conta sem calculadora. */
  function receberResto(key: string) {
    const alvo = partes.find(p => p.key === key)
    if (!alvo) return
    const cents = alvo.cents + faltam
    if (cents <= 0) return
    patch(key, {
      cents, valorTexto: fmt(cents),
      pctTexto: totalCents ? String(pctOf(cents, totalCents)).replace('.', ',') : '',
    })
  }

  const semDimensao = useMemo(
    () => partes.some(p => !p.costCenterId && !p.businessUnitId && !p.legalEntityId && !p.contactId),
    [partes],
  )
  const podeSalvar = partes.length > 0 && faltam === 0 && partes.every(p => p.cents > 0)

  /**
   * As partes de agora em formato de modelo — os valores em centavos viram os
   * pesos. 7.200 : 4.800 e 60 : 40 descrevem a mesma divisão, então guardar os
   * centavos crus não perde nada e não arredonda nada; quem normaliza para
   * percentual é só a exibição.
   *
   * Menos de 2 partes ou soma que não fecha não descrevem divisão nenhuma, e
   * salvar isso como modelo daria um modelo que nunca aplica direito.
   */
  const linhasParaModelo: TemplateLineInput[] | null = useMemo(() => {
    if (partes.length < 2 || faltam !== 0 || partes.some(p => p.cents <= 0)) return null
    // Reduzido pelo MDC: 720000 : 480000 vira 3 : 2 sem perder nada, e é isso
    // que aparece no editor de modelos depois.
    const pesos = reduceWeights(partes.map(p => p.cents))
    return partes.map((p, i) => ({
      weight:         pesos[i],
      costCenterId:   p.costCenterId,
      businessUnitId: p.businessUnitId,
      legalEntityId:  p.legalEntityId,
      contactId:      p.contactId,
    }))
  }, [partes, faltam])

  function salvar() {
    if (!transaction) return
    const payload: AllocationPart[] = partes.map(p => ({
      amount:         p.cents / 100,
      costCenterId:   p.costCenterId,
      businessUnitId: p.businessUnitId,
      legalEntityId:  p.legalEntityId,
      contactId:      p.contactId,
      notes:          null,
    }))
    startSaving(async () => {
      const r = await saveAllocations(transaction.id, payload, modelo)
      if ('error' in r && r.error) { toast.error(r.error); return }
      toast.success(`Rateio salvo em ${payload.length} partes.`)
      onOpenChange(false)
      onSaved()
    })
  }

  function remover() {
    if (!transaction) return
    startSaving(async () => {
      const r = await removeAllocations(transaction.id)
      if ('error' in r && r.error) { toast.error(r.error); return }
      toast.success('Rateio removido. O lançamento volta a ser classificado direto.')
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="truncate">Ratear · {transaction?.description}</DialogTitle>
          <DialogDescription>
            As partes têm de somar exatamente {fmt(totalCents)}. A natureza do lançamento não se
            divide — só as dimensões.
          </DialogDescription>
        </DialogHeader>

        <AllocationTemplateBar
          applied={modelo}
          onApply={aplicarModelo}
          currentLines={linhasParaModelo}
        />

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="max-h-[55vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium w-28">Valor</th>
                  <th className="px-2 py-1.5 font-medium w-20">%</th>
                  <th className="px-2 py-1.5 font-medium">Centro de custo</th>
                  <th className="px-2 py-1.5 font-medium">Un. de negócio</th>
                  <th className="px-2 py-1.5 font-medium">Entidade</th>
                  <th className="px-2 py-1.5 font-medium">Contato</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {partes.map(p => (
                  <tr key={p.key} className="border-b last:border-0">
                    <td className="px-2 py-1">
                      <input
                        value={p.valorTexto}
                        onChange={e => mudouValor(p.key, e.target.value)}
                        onDoubleClick={() => receberResto(p.key)}
                        title="Duplo clique joga o que falta nesta parte"
                        inputMode="decimal"
                        placeholder="0,00"
                        className="w-full h-7 rounded border border-input px-1.5 text-right tabular-nums bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={p.pctTexto}
                        onChange={e => mudouPct(p.key, e.target.value)}
                        inputMode="decimal"
                        placeholder="0,00"
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
                        onClick={() => { setModelo(null); setPartes(prev => prev.filter(x => x.key !== p.key)) }}
                        disabled={partes.length <= 1}
                        className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/5 disabled:opacity-30"
                        aria-label="Remover parte"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm"
            onClick={() => { setModelo(null); setPartes(prev => [...prev, parteVazia()]) }}
            disabled={partes.length >= 50}>
            <Plus className="h-3.5 w-3.5 mr-1" />Adicionar parte
          </Button>
          <Button variant="outline" size="sm" onClick={dividirIgualmente} disabled={partes.length === 0}>
            Dividir igualmente
          </Button>

          <div className="ml-auto flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">
              Distribuído <span className="font-medium text-foreground tabular-nums">{fmt(somaCents)}</span>
            </span>
            <span className={cn(
              'font-medium tabular-nums',
              faltam === 0 ? 'text-emerald-600' : 'text-rose-600',
            )}>
              {faltam === 0 ? 'fecha certo' : faltam > 0 ? `faltam ${fmt(faltam)}` : `passou ${fmt(-faltam)}`}
            </span>
          </div>
        </div>

        {semDimensao && partes.length > 0 && (
          <p className="text-[11px] text-amber-600">
            Uma das partes está sem dimensão nenhuma — ela vai somar no total, mas não aparece em
            nenhum filtro.
          </p>
        )}

        <DialogFooter className="items-center">
          {tinhaRateio && (
            <Button variant="outline" size="sm" onClick={remover} disabled={isSaving}
              className="mr-auto text-destructive border-destructive/40 hover:bg-destructive/5">
              Remover rateio
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={salvar} disabled={!podeSalvar || isSaving}>
            {isSaving ? 'Salvando…' : 'Salvar rateio'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
