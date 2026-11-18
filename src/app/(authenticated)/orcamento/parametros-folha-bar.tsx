'use client'

// Os parâmetros da folha da versão: modo de 13º/férias e dissídio. Grava a cada
// mudança — são três campos, e um botão "Salvar" só para eles seria esquecido.

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { parseAmount } from '@/lib/format'
import type { ModoProvisao } from '@/lib/payroll-types'
import type { QuadroDaVersao } from '@/lib/payroll-write'
import { saveParametrosFolha } from '@/server/payroll'
import { MESES_LONGOS, numParaCampo } from './folha-format'

const MODOS: { value: ModoProvisao; label: string; hint: string }[] = [
  { value: 'provisao', label: 'provisão mensal', hint: '1/12 do 13º e do terço de férias em cada mês ativo' },
  { value: 'pagamento', label: 'no pagamento', hint: '13º em dezembro e o terço no mês de férias' },
]

export function ParametrosFolhaBar({
  versionId, settings, editavel, onSaved,
}: {
  versionId: string
  settings: QuadroDaVersao['settings']
  editavel: boolean
  onSaved: () => void
}) {
  const [modo, setModo] = useState(settings.modoProvisao)
  const [mes, setMes] = useState(settings.dissidioMes ? String(settings.dissidioMes) : '')
  const [pct, setPct] = useState(numParaCampo(settings.dissidioPct))
  const [isSaving, startSaving] = useTransition()

  function gravar(next: { modo?: ModoProvisao; mes?: string; pct?: string }) {
    const m = next.mes ?? mes
    const p = next.pct ?? pct
    const pctNum = m === '' ? null : parseAmount(p)
    let dissidioMes: number | null = m === '' ? null : Number(m)
    let dissidioPct: number | null = pctNum
    if (m !== '' && pctNum === null) {
      // Mês sem percentual ainda não é dissídio. Mudança só de dissídio espera
      // o percentual; mudança de MODO grava já, com o dissídio que está salvo —
      // a tela nunca pode mostrar um modo que não é o gravado.
      if (!next.modo) return
      dissidioMes = settings.dissidioMes
      dissidioPct = settings.dissidioPct
    }
    startSaving(async () => {
      const r = await saveParametrosFolha(versionId, {
        modoProvisao: next.modo ?? modo,
        dissidioMes,
        dissidioPct,
      })
      if ('error' in r) {
        toast.error(r.error)
        if (next.modo) setModo(settings.modoProvisao)
        return
      }
      onSaved()
    })
  }

  const ro = !editavel || isSaving

  return (
    <div className="flex items-center gap-x-6 gap-y-2 flex-wrap text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">13º e férias:</span>
        {MODOS.map(m => (
          <label key={m.value} title={m.hint}
            className={cn('flex items-center gap-1.5 cursor-pointer', ro && 'cursor-default opacity-70')}>
            <input type="radio" name={`modo-${versionId}`} checked={modo === m.value} disabled={ro}
              onChange={() => { setModo(m.value); gravar({ modo: m.value }) }} />
            {m.label}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Dissídio:</span>
        <select value={mes} disabled={ro}
          className="h-7 rounded-md border border-input px-1.5 text-xs bg-background disabled:opacity-50"
          onChange={e => {
            setMes(e.target.value)
            if (e.target.value === '') setPct('')
            gravar({ mes: e.target.value, pct: e.target.value === '' ? '' : pct })
          }}>
          <option value="">sem dissídio</option>
          {MESES_LONGOS.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
        </select>
        {mes !== '' && (
          <span className="flex items-center gap-1">
            <input value={pct} disabled={ro} inputMode="decimal" placeholder="0"
              className="h-7 w-14 rounded-md border border-input px-1.5 text-xs text-right tabular-nums bg-background disabled:opacity-50"
              onChange={e => setPct(e.target.value)}
              onBlur={() => { if (parseAmount(pct) !== settings.dissidioPct || Number(mes) !== settings.dissidioMes) gravar({}) }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
            %
            {parseAmount(pct) === null && <span className="text-amber-600">informe o percentual</span>}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">só CLT</span>
      </div>

      {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
    </div>
  )
}
