'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { CellCombobox, CategoryCellCombobox } from '@/components/transacoes-shared/cell-combobox'
import type { CategoryItem, SimpleDimensionItem } from '@/components/transacoes-shared/types'
import { createBudgetSeries, updateBudgetSeries } from '@/server/budget'
import {
  AMOUNT_MODES, AMOUNT_MODE_LABELS, AMOUNT_MODE_HINTS, INTERVAL_OPTIONS, intervalLabel,
  type AmountMode, type BudgetSeriesInput, type BudgetSeriesListItem,
} from '@/lib/budget-types'
import { expandSeries, fitsInFiscalYear, type RecurrenceInput } from '@/lib/budget-recurrence'
import { fmtMoney, monthLabel, dateLabel } from '@/lib/format'

const inputCls =
  'w-full h-8 rounded-md border border-input px-2 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring'

function parseNum(s: string): number | null {
  if (s.trim() === '') return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  versionId: string
  fiscalYear: number
  initial?: BudgetSeriesListItem
  leafCategories: CategoryItem[]
  costCenters: SimpleDimensionItem[]
  businessUnits: SimpleDimensionItem[]
  legalEntities: SimpleDimensionItem[]
  contactOptions: SimpleDimensionItem[]
  onSaved: () => void
}

export function SeriesDialog({
  open, onOpenChange, mode, versionId, fiscalYear, initial,
  leafCategories, costCenters, businessUnits, legalEntities, contactOptions,
  onSaved,
}: Props) {
  const [description, setDescription] = useState('')
  const [direction, setDirection] = useState<'inflow' | 'outflow'>('outflow')
  const [directionTouched, setDirectionTouched] = useState(false)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [costCenterId, setCostCenterId] = useState<string | null>(null)
  const [businessUnitId, setBusinessUnitId] = useState<string | null>(null)
  const [legalEntityId, setLegalEntityId] = useState<string | null>(null)
  const [contactId, setContactId] = useState<string | null>(null)

  const [startMonth, setStartMonth] = useState(`${fiscalYear}-01`)
  const [occurrences, setOccurrences] = useState('12')
  const [intervalMonths, setIntervalMonths] = useState('1')
  const [dayOfMonth, setDayOfMonth] = useState('1')
  const [cashLagDays, setCashLagDays] = useState('0')

  const [amountMode, setAmountMode] = useState<AmountMode>('fixo')
  const [baseAmount, setBaseAmount] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [adjustmentPct, setAdjustmentPct] = useState('5')   // exibido em %, gravado como fração
  const [adjustmentEvery, setAdjustmentEvery] = useState('12')
  const [seasonal, setSeasonal] = useState<string[]>([])
  const [notes, setNotes] = useState('')

  const [isSaving, startTransition] = useTransition()

  // Reidrata o formulário a cada abertura
  useEffect(() => {
    if (!open) return
    if (initial) {
      setDescription(initial.description)
      setDirection(initial.direction)
      setDirectionTouched(true)
      setCategoryId(initial.categoryId)
      setCostCenterId(initial.costCenterId)
      setBusinessUnitId(initial.businessUnitId)
      setLegalEntityId(initial.legalEntityId)
      setContactId(initial.contactId)
      setStartMonth(initial.startMonth)
      setOccurrences(String(initial.occurrences))
      setIntervalMonths(String(initial.intervalMonths))
      setDayOfMonth(String(initial.dayOfMonth))
      setCashLagDays(String(initial.cashLagDays))
      setAmountMode(initial.amountMode)
      setBaseAmount(initial.baseAmount === null ? '' : String(initial.baseAmount))
      setTotalAmount(initial.totalAmount === null ? '' : String(initial.totalAmount))
      setAdjustmentPct(initial.adjustmentRate === null ? '5' : String(initial.adjustmentRate * 100))
      setAdjustmentEvery(String(initial.adjustmentEvery))
      setSeasonal(initial.seasonalAmounts?.map(String) ?? [])
      setNotes(initial.notes ?? '')
    } else {
      setDescription('')
      setDirection('outflow')
      setDirectionTouched(false)
      setCategoryId(null)
      setCostCenterId(null)
      setBusinessUnitId(null)
      setLegalEntityId(null)
      setContactId(null)
      setStartMonth(`${fiscalYear}-01`)
      setOccurrences('12')
      setIntervalMonths('1')
      setDayOfMonth('1')
      setCashLagDays('0')
      setAmountMode('fixo')
      setBaseAmount('')
      setTotalAmount('')
      setAdjustmentPct('5')
      setAdjustmentEvery('12')
      setSeasonal([])
      setNotes('')
    }
  }, [open, initial, fiscalYear])

  const nOcc = Math.min(12, Math.max(1, Math.trunc(parseNum(occurrences) ?? 0) || 0))

  // O array sazonal acompanha a quantidade de ocorrências
  useEffect(() => {
    if (amountMode !== 'sazonal') return
    setSeasonal(prev => {
      if (prev.length === nOcc) return prev
      const next = Array.from({ length: nOcc }, (_, i) => prev[i] ?? '')
      return next
    })
  }, [amountMode, nOcc])

  // Entrada ou saída deduzida da categoria — o usuário pode sobrescrever
  function pickCategory(id: string | null) {
    setCategoryId(id)
    if (!id || directionTouched) return
    const cat = leafCategories.find(c => c.id === id)
    if (cat) setDirection(cat.type === 'receita_operacional' ? 'inflow' : 'outflow')
  }

  const recurrence: RecurrenceInput = useMemo(() => ({
    startMonth,
    occurrences: nOcc,
    intervalMonths: Math.max(1, Math.trunc(parseNum(intervalMonths) ?? 1)),
    dayOfMonth: Math.min(31, Math.max(1, Math.trunc(parseNum(dayOfMonth) ?? 1))),
    cashLagDays: Math.max(0, Math.trunc(parseNum(cashLagDays) ?? 0)),
    amountMode,
    baseAmount: parseNum(baseAmount),
    totalAmount: parseNum(totalAmount),
    adjustmentRate: amountMode === 'reajuste' ? (parseNum(adjustmentPct) ?? 0) / 100 : null,
    adjustmentEvery: Math.max(1, Math.trunc(parseNum(adjustmentEvery) ?? 1)),
    seasonalAmounts: amountMode === 'sazonal' ? seasonal.map(s => parseNum(s) ?? 0) : null,
  }), [startMonth, nOcc, intervalMonths, dayOfMonth, cashLagDays, amountMode,
       baseAmount, totalAmount, adjustmentPct, adjustmentEvery, seasonal])

  // Preview ao vivo — é o que torna os 4 modos compreensíveis no formulário
  const preview = useMemo(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth) || nOcc < 1) return []
    try { return expandSeries(recurrence) } catch { return [] }
  }, [recurrence, startMonth, nOcc])

  const previewTotal = preview.reduce((acc, e) => acc + e.amount, 0)
  const horizon = useMemo(
    () => fitsInFiscalYear({ startMonth, intervalMonths: recurrence.intervalMonths, occurrences: nOcc }, fiscalYear),
    [startMonth, recurrence.intervalMonths, nOcc, fiscalYear],
  )

  const hasAmount =
    amountMode === 'parcelado' ? parseNum(totalAmount) !== null
    : amountMode === 'sazonal' ? seasonal.length === nOcc && seasonal.every(s => parseNum(s) !== null)
    : parseNum(baseAmount) !== null

  const canSubmit =
    description.trim().length > 0 &&
    !!categoryId &&
    nOcc >= 1 &&
    hasAmount &&
    horizon.ok &&
    !isSaving

  function handleSubmit() {
    if (!canSubmit || !categoryId) return

    const input: BudgetSeriesInput = {
      versionId,
      description: description.trim(),
      direction,
      categoryId,
      costCenterId,
      businessUnitId,
      legalEntityId,
      contactId,
      startMonth,
      occurrences: nOcc,
      intervalMonths: recurrence.intervalMonths,
      dayOfMonth: recurrence.dayOfMonth,
      cashLagDays: recurrence.cashLagDays,
      amountMode,
      baseAmount: amountMode === 'fixo' || amountMode === 'reajuste' ? parseNum(baseAmount) : null,
      totalAmount: amountMode === 'parcelado' ? parseNum(totalAmount) : null,
      adjustmentRate: recurrence.adjustmentRate,
      adjustmentEvery: recurrence.adjustmentEvery,
      seasonalAmounts: recurrence.seasonalAmounts,
      notes: notes.trim() || null,
    }

    startTransition(async () => {
      const result = mode === 'create'
        ? await createBudgetSeries(input)
        : await updateBudgetSeries(initial!.id, input)

      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }
      toast.success(mode === 'create'
        ? `Lançamento criado com ${preview.length} ocorrência${preview.length > 1 ? 's' : ''}.`
        : 'Lançamento atualizado.')
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Novo lançamento orçado' : 'Editar lançamento'}</DialogTitle>
          <DialogDescription>
            Exercício de {fiscalYear}. A competência alimenta a DRE orçada; a data de caixa alimenta o fluxo projetado.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 py-1">
          {/* ── Formulário ── */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="serie-desc" className="text-xs">Descrição</Label>
              <input
                id="serie-desc"
                value={description}
                onChange={e => setDescription(e.target.value.slice(0, 200))}
                placeholder="Ex.: Aluguel da matriz"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label className="text-xs">Categoria (natureza filho)</Label>
                <CategoryCellCombobox
                  value={categoryId}
                  categories={leafCategories}
                  onValueChange={pickCategory}
                />
              </div>

              <div className="space-y-2 col-span-2">
                <Label className="text-xs">Tipo</Label>
                <div className="flex gap-2">
                  {([
                    { v: 'inflow' as const,  label: 'Entrada', Icon: ArrowUpRight,   on: 'border-emerald-600 bg-emerald-50 text-emerald-700' },
                    { v: 'outflow' as const, label: 'Saída',   Icon: ArrowDownLeft,  on: 'border-rose-600 bg-rose-50 text-rose-700' },
                  ]).map(({ v, label, Icon, on }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => { setDirection(v); setDirectionTouched(true) }}
                      className={cn(
                        'flex-1 h-8 rounded-md border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors',
                        direction === v ? on : 'border-input text-muted-foreground hover:bg-muted',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Centro de custo</Label>
                <CellCombobox value={costCenterId} options={costCenters} onValueChange={setCostCenterId} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Unidade de negócio</Label>
                <CellCombobox value={businessUnitId} options={businessUnits} onValueChange={setBusinessUnitId} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Entidade jurídica</Label>
                <CellCombobox value={legalEntityId} options={legalEntities} onValueChange={setLegalEntityId} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Contato</Label>
                <CellCombobox value={contactId} options={contactOptions} onValueChange={setContactId} />
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Repetição */}
            <div className="grid grid-cols-4 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Mês inicial</Label>
                <input type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Ocorrências</Label>
                <input type="number" min={1} max={12} value={occurrences} onChange={e => setOccurrences(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Periodicidade</Label>
                <select
                  value={intervalMonths}
                  onChange={e => setIntervalMonths(e.target.value)}
                  className={cn(inputCls, 'cursor-pointer')}
                >
                  {INTERVAL_OPTIONS.map(m => (
                    <option key={m} value={m}>{intervalLabel(m)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Dia do mês</Label>
                <input type="number" min={1} max={31} value={dayOfMonth} onChange={e => setDayOfMonth(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label className="text-xs">Prazo até o caixa (dias)</Label>
                <input type="number" min={0} max={365} value={cashLagDays} onChange={e => setCashLagDays(e.target.value)} className={inputCls} />
                <p className="text-[11px] text-muted-foreground">
                  0 = o dinheiro entra ou sai na própria data de competência.
                </p>
              </div>
            </div>

            {!horizon.ok && (
              <p className="text-[11px] text-amber-600 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                {horizon.message}
              </p>
            )}

            <div className="h-px bg-border" />

            {/* Valor */}
            <div className="space-y-2">
              <Label className="text-xs">Como o valor varia</Label>
              <div className="grid grid-cols-4 gap-1.5">
                {AMOUNT_MODES.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAmountMode(m)}
                    className={cn(
                      'h-8 rounded-md border text-[11px] font-medium px-1 transition-colors',
                      amountMode === m
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-input text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {AMOUNT_MODE_LABELS[m]}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{AMOUNT_MODE_HINTS[amountMode]}</p>
            </div>

            {(amountMode === 'fixo' || amountMode === 'reajuste') && (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Valor (R$)</Label>
                  <input type="number" min={0} step="0.01" placeholder="0,00" value={baseAmount}
                    onChange={e => setBaseAmount(e.target.value)} className={inputCls} />
                </div>
                {amountMode === 'reajuste' && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-xs">Reajuste (%)</Label>
                      <input type="number" step="0.01" value={adjustmentPct}
                        onChange={e => setAdjustmentPct(e.target.value)} className={inputCls} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">A cada N ocorrências</Label>
                      <input type="number" min={1} value={adjustmentEvery}
                        onChange={e => setAdjustmentEvery(e.target.value)} className={inputCls} />
                    </div>
                  </>
                )}
              </div>
            )}

            {amountMode === 'parcelado' && (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Valor total (R$)</Label>
                  <input type="number" min={0} step="0.01" placeholder="0,00" value={totalAmount}
                    onChange={e => setTotalAmount(e.target.value)} className={inputCls} />
                </div>
                <div className="col-span-2 flex items-end">
                  <p className="text-[11px] text-muted-foreground pb-2">
                    Dividido em {nOcc} parcela{nOcc > 1 ? 's' : ''}. A última absorve a sobra de centavos, então a soma bate exatamente com o total.
                  </p>
                </div>
              </div>
            )}

            {amountMode === 'sazonal' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Valor de cada ocorrência (R$)</Label>
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline"
                    onClick={() => {
                      const first = seasonal.find(s => parseNum(s) !== null)
                      if (first) setSeasonal(Array.from({ length: nOcc }, () => first))
                    }}
                  >
                    Repetir o primeiro em todos
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: nOcc }, (_, i) => (
                    <div key={i} className="space-y-1">
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {preview[i] ? monthLabel(preview[i].competenceDate) : `#${i + 1}`}
                      </p>
                      <input
                        type="number" min={0} step="0.01" placeholder="0,00"
                        value={seasonal[i] ?? ''}
                        onChange={e => setSeasonal(prev => {
                          const next = [...prev]
                          next[i] = e.target.value
                          return next
                        })}
                        className={inputCls}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="serie-notes" className="text-xs">Observação (opcional)</Label>
              <input id="serie-notes" value={notes} onChange={e => setNotes(e.target.value.slice(0, 500))} className={inputCls} />
            </div>
          </div>

          {/* ── Preview ao vivo ── */}
          <div className="lg:border-l lg:pl-5 space-y-2">
            <div className="flex items-baseline justify-between">
              <Label className="text-xs">Ocorrências geradas</Label>
              <span className="text-[11px] text-muted-foreground tabular-nums">{preview.length}</span>
            </div>

            {preview.length === 0 ? (
              <p className="text-[11px] text-muted-foreground py-4">
                Preencha mês inicial e quantidade para ver as ocorrências.
              </p>
            ) : (
              <>
                <div className="max-h-[46vh] overflow-auto border rounded-lg">
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-muted border-b">
                        <th className="text-left font-medium px-2 py-1.5">Competência</th>
                        <th className="text-left font-medium px-2 py-1.5">Caixa</th>
                        <th className="text-right font-medium px-2 py-1.5">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map(e => (
                        <tr key={e.sequence} className="border-b last:border-b-0">
                          <td className="px-2 py-1 tabular-nums">{dateLabel(e.competenceDate)}</td>
                          <td className={cn(
                            'px-2 py-1 tabular-nums',
                            e.cashDate.slice(0, 4) !== String(fiscalYear) && 'text-amber-600',
                          )}>
                            {dateLabel(e.cashDate)}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(e.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-baseline justify-between px-1">
                  <span className="text-[11px] text-muted-foreground">Total do ano</span>
                  <span className={cn(
                    'text-sm font-semibold tabular-nums',
                    direction === 'inflow' ? 'text-emerald-700' : 'text-rose-600',
                  )}>
                    {direction === 'inflow' ? '' : '−'}{fmtMoney(previewTotal)}
                  </span>
                </div>

                {preview.some(e => e.cashDate.slice(0, 4) !== String(fiscalYear)) && (
                  <p className="text-[11px] text-amber-600">
                    Parte do caixa cai fora de {fiscalYear} (em âmbar). É esperado quando há prazo — a competência continua no exercício.
                  </p>
                )}
              </>
            )}

            {mode === 'edit' && initial && initial.adjustedCount > 0 && (
              <p className="text-[11px] text-amber-600 flex items-start gap-1.5 pt-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                {initial.adjustedCount} ocorrência{initial.adjustedCount > 1 ? 's foram ajustadas' : ' foi ajustada'} à mão e
                {initial.adjustedCount > 1 ? ' serão sobrescritas' : ' será sobrescrita'} ao salvar. Os três escopos de edição
                chegam na próxima sessão.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isSaving ? 'Salvando…' : mode === 'create' ? `Criar ${preview.length} ocorrência${preview.length > 1 ? 's' : ''}` : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
