'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { fmtMoney, monthLabel } from '@/lib/format'
import {
  AMOUNT_MODE_LABELS,
  BUDGET_REGIMES, BUDGET_REGIME_LABELS,
  COPY_SHAPES, COPY_SHAPE_LABELS, COPY_SHAPE_HINTS,
  COPY_GRANULARITIES, COPY_GRANULARITY_LABELS, COPY_GRANULARITY_HINTS,
  type BudgetRegime, type BudgetVersionListItem,
  type CopyShape, type CopyGranularity, type CopyActualsPreview,
} from '@/lib/budget-types'
import { copyActualsToBudget, previewCopyActuals } from '@/server/budget'

const inputCls =
  'w-full h-8 rounded-md border border-input px-2 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring'

/** Linha de opções mutuamente exclusivas com a explicação da escolhida embaixo. */
function Choice<T extends string>({
  label, value, options, labels, hint, onChange,
}: {
  label:   string
  value:   T
  options: readonly T[]
  labels:  Record<T, string>
  hint?:   Record<T, string>
  onChange: (v: T) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-1">
        {options.map(o => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={cn(
              'flex-1 h-8 rounded-md border text-xs transition-colors px-2',
              value === o ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-input hover:bg-muted',
            )}
          >
            {labels[o]}
          </button>
        ))}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground leading-snug">{hint[value]}</p>}
    </div>
  )
}

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  version:      BudgetVersionListItem
  onSaved:      () => void
}

export function CopyActualsDialog({ open, onOpenChange, version, onSaved }: Props) {
  const priorYear = version.fiscalYear - 1

  const [sourceFrom, setSourceFrom]   = useState(`${priorYear}-01`)
  const [sourceTo, setSourceTo]       = useState(`${priorYear}-12`)
  const [regime, setRegime]           = useState<BudgetRegime>('competencia')
  const [shape, setShape]             = useState<CopyShape>('mensal')
  const [granularity, setGranularity] = useState<CopyGranularity>('categoria')
  const [byContact, setByContact]     = useState(false)
  const [pct, setPct]                 = useState('0')
  const [replaceExisting, setReplace] = useState(false)

  const [preview, setPreview] = useState<CopyActualsPreview | null>(null)
  const [isPending, startTransition] = useTransition()

  // Ao reabrir, volta ao padrão — uma prévia velha descrevendo outros
  // parâmetros é pior do que prévia nenhuma.
  useEffect(() => {
    if (!open) return
    setSourceFrom(`${priorYear}-01`)
    setSourceTo(`${priorYear}-12`)
    setRegime('competencia')
    setShape('mensal')
    setGranularity('categoria')
    setByContact(false)
    setPct('0')
    setReplace(false)
    setPreview(null)
  }, [open, priorYear])

  const buildInput = useCallback(() => ({
    versionId:     version.id,
    sourceFrom,
    sourceTo,
    regime,
    shape,
    granularity,
    includeContact: byContact,
    adjustmentPct: Number(pct.replace(',', '.')) || 0,
    replaceExisting,
  }), [version.id, sourceFrom, sourceTo, regime, shape, granularity, byContact, pct, replaceExisting])

  /** Qualquer mudança de parâmetro invalida a prévia. */
  function change<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPreview(null) }
  }

  function loadPreview() {
    const value = Number(pct.replace(',', '.'))
    if (!Number.isFinite(value)) { toast.error('Percentual inválido.'); return }

    startTransition(async () => {
      const result = await previewCopyActuals(buildInput())
      if ('error' in result) { toast.error(result.error); return }
      setPreview(result.preview)
      if (result.preview.rows.length === 0) {
        toast.error('Não há realizado categorizado nesse período.')
      }
    })
  }

  function commit() {
    startTransition(async () => {
      const result = await copyActualsToBudget(buildInput())
      if ('error' in result && result.error) { toast.error(result.error); return }
      const created = 'series' in result ? result.series : 0
      const replaced = 'replaced' in result ? result.replaced : 0
      toast.success(
        `${created} ${created === 1 ? 'lançamento criado' : 'lançamentos criados'}`
        + (replaced > 0 ? ` — ${replaced} da cópia anterior ${replaced === 1 ? 'foi substituído' : 'foram substituídos'}.` : '.'),
      )
      onOpenChange(false)
      onSaved()
    })
  }

  const netSource = preview ? preview.sourceTotals.inflow - preview.sourceTotals.outflow : 0
  const netTarget = preview ? preview.targetTotals.inflow - preview.targetTotals.outflow : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Copiar do realizado</DialogTitle>
          <DialogDescription>
            Transforma o histórico em previsão para {version.name}. Cada mês de origem vira o mês de
            mesmo número do exercício de {version.fiscalYear}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto space-y-4 pr-1">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cp-from" className="text-xs">De</Label>
              <input id="cp-from" type="month" value={sourceFrom} className={inputCls}
                onChange={e => change(setSourceFrom)(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-to" className="text-xs">Até</Label>
              <input id="cp-to" type="month" value={sourceTo} className={inputCls}
                onChange={e => change(setSourceTo)(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-pct" className="text-xs">Ajuste sobre o realizado (%)</Label>
              <input id="cp-pct" type="number" step="0.1" value={pct} className={inputCls}
                onChange={e => change(setPct)(e.target.value)} />
            </div>
          </div>

          <Choice
            label="Regime"
            value={regime}
            options={BUDGET_REGIMES}
            labels={BUDGET_REGIME_LABELS}
            onChange={change(setRegime)}
          />
          <p className="text-[11px] text-muted-foreground -mt-2 leading-snug">
            {regime === 'competencia'
              ? 'Lê o realizado pela data de competência, como a DRE. Os lançamentos nascem sem prazo de caixa — ajuste depois se o recebimento demora.'
              : 'Lê o realizado pela data de caixa, como o fluxo. Competência e caixa do orçado nascem na mesma data.'}
          </p>

          <Choice
            label="Formato"
            value={shape}
            options={COPY_SHAPES}
            labels={COPY_SHAPE_LABELS}
            hint={COPY_SHAPE_HINTS}
            onChange={change(setShape)}
          />

          <Choice
            label="Detalhamento"
            value={granularity}
            options={COPY_GRANULARITIES}
            labels={COPY_GRANULARITY_LABELS}
            hint={COPY_GRANULARITY_HINTS}
            onChange={change(setGranularity)}
          />

          {/* Fora do "Detalhamento" de propósito: a carteira é ordem de grandeza
              maior que as outras dimensões, e abrir por ela troca um lançamento
              por categoria por um por contraparte. */}
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={byContact}
              onChange={e => { setByContact(e.target.checked); setPreview(null) }}
              className="mt-0.5 rounded border-input"
            />
            <span>
              Abrir por contato
              <span className="block text-[11px] text-muted-foreground">
                Cria um lançamento por contraparte. Bom para orçar cliente a cliente;
                numa carteira grande, gera muita linha.
              </span>
            </span>
          </label>

          {preview && (
            <div className="space-y-3 border-t pt-3">
              {/* ── Totais ── */}
              <div className="flex items-center gap-4 text-xs flex-wrap">
                <span className="text-muted-foreground">
                  <span className="tabular-nums font-medium text-foreground">{preview.rows.length}</span>
                  {preview.rows.length === 1 ? ' lançamento' : ' lançamentos'} em {preview.monthsInSource}
                  {preview.monthsInSource === 1 ? ' mês' : ' meses'} de origem
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  Realizado <span className="tabular-nums font-medium text-foreground">{fmtMoney(netSource)}</span>
                  <ArrowRight className="h-3 w-3" />
                  Orçado <span className={cn('tabular-nums font-semibold',
                    netTarget >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{fmtMoney(netTarget)}</span>
                </span>
              </div>

              {/* ── O que fica de fora ── */}
              {(preview.semCategoria.count > 0 || preview.inativas.count > 0) && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 space-y-1">
                  {preview.semCategoria.count > 0 && (
                    <p className="text-[11px] text-amber-700 flex items-start gap-1.5">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>
                        {preview.semCategoria.count} {preview.semCategoria.count === 1 ? 'lançamento' : 'lançamentos'} do
                        período, somando {fmtMoney(preview.semCategoria.total)}, {preview.semCategoria.count === 1 ? 'está' : 'estão'} sem
                        categoria e não {preview.semCategoria.count === 1 ? 'entra' : 'entram'} na cópia. Classifique em
                        Transações para que o orçado reflita o ano inteiro.
                      </span>
                    </p>
                  )}
                  {preview.inativas.count > 0 && (
                    <p className="text-[11px] text-amber-700 flex items-start gap-1.5">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>
                        {fmtMoney(preview.inativas.total)} em categorias desativadas ficaram de fora — um lançamento
                        nelas não poderia ser editado depois.
                      </span>
                    </p>
                  )}
                </div>
              )}

              {/* ── Cópia anterior ── */}
              {preview.existingCopied.series > 0 && (
                <label className="flex items-start gap-2 rounded-md border border-input px-2.5 py-2 cursor-pointer hover:bg-muted/50">
                  <input type="checkbox" checked={replaceExisting} className="mt-0.5"
                    onChange={e => setReplace(e.target.checked)} />
                  <span className="text-[11px] leading-snug">
                    <span className="font-medium">
                      Substituir as {preview.existingCopied.series} cópias anteriores desta versão
                    </span>
                    <span className="block text-muted-foreground">
                      {replaceExisting
                        ? `As ${preview.existingCopied.series} serão removidas antes. Lançamentos criados à mão não são tocados.`
                        : 'Sem marcar, os novos lançamentos somam-se aos que já existem — e o orçado conta duas vezes.'}
                    </span>
                  </span>
                </label>
              )}

              {/* ── A lista ── */}
              {preview.rows.length > 0 && (
                <div className="border rounded-lg overflow-auto max-h-64">
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="border-b">
                        <th className="text-left px-2 py-1.5 font-medium">Lançamento</th>
                        <th className="text-left px-2 py-1.5 font-medium w-20">Início</th>
                        <th className="text-left px-2 py-1.5 font-medium w-16">Ocorr.</th>
                        <th className="text-left px-2 py-1.5 font-medium w-24">Modo</th>
                        <th className="text-right px-2 py-1.5 font-medium w-28">Realizado</th>
                        <th className="text-right px-2 py-1.5 font-medium w-28">Orçado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r, i) => (
                        <tr key={`${r.description}-${r.direction}-${i}`} className="border-b last:border-b-0">
                          <td className="px-2 py-1">
                            <span className={r.direction === 'inflow' ? 'text-emerald-700' : 'text-rose-600'}>
                              {r.direction === 'inflow' ? '+ ' : '− '}
                            </span>
                            {r.description}
                          </td>
                          <td className="px-2 py-1 tabular-nums">{monthLabel(r.startMonth)}</td>
                          <td className="px-2 py-1 tabular-nums">{r.occurrences}×</td>
                          <td className="px-2 py-1 text-muted-foreground">{AMOUNT_MODE_LABELS[r.amountMode]}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{fmtMoney(r.sourceTotal)}</td>
                          <td className="px-2 py-1 text-right tabular-nums font-medium">{fmtMoney(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancelar</Button>
          {!preview ? (
            <Button onClick={loadPreview} disabled={isPending}>
              {isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Calculando…</> : 'Ver prévia'}
            </Button>
          ) : (
            <Button onClick={commit} disabled={isPending || preview.rows.length === 0}>
              {isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Criando…</>
                : `Criar ${preview.rows.length} ${preview.rows.length === 1 ? 'lançamento' : 'lançamentos'}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
