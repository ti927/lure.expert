'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  ADJUSTABLE_FIELD_LABELS, EDIT_SCOPE_LABELS, type SeriesUpdatePreview,
} from '@/lib/budget-types'

// Confirmação two-phase: a própria action de salvar devolve `{ needsConfirm }`
// em vez de executar, o cliente abre este diálogo e re-submete com
// `overwriteAdjusted`. Evita uma segunda action e um round-trip de preview.

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  preview: SeriesUpdatePreview | null
  isSaving: boolean
  onConfirm: () => void
}

export function ScopeConfirmDialog({ open, onOpenChange, preview, isSaving, onConfirm }: Props) {
  // Nasce sempre desmarcado, a cada abertura.
  const [overwrite, setOverwrite] = useState(false)
  useEffect(() => { if (open) setOverwrite(false) }, [open])

  if (!preview) return null

  const hasConflicts = preview.conflicts.length > 0
  const canConfirm = !hasConflicts || overwrite

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirmar alteração</DialogTitle>
          <DialogDescription>
            Escopo: <span className="font-medium text-foreground">{EDIT_SCOPE_LABELS[preview.scope]}</span>
            {preview.affectedCount > 0 && ` · ${preview.affectedCount} ocorrência${preview.affectedCount > 1 ? 's' : ''} afetada${preview.affectedCount > 1 ? 's' : ''}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1 text-xs">
          {preview.forcedFullScope && (
            <p className="text-muted-foreground">
              Você mudou a periodicidade, o mês inicial ou a quantidade de ocorrências — isso vale
              necessariamente para a série inteira, então o escopo foi ajustado para
              <span className="font-medium text-foreground"> toda a série</span>.
            </p>
          )}

          {preview.removed.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1">
              <p className="font-medium text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                {preview.removed.length} ocorrência{preview.removed.length > 1 ? 's somem' : ' some'} do orçamento
              </p>
              <p className="text-muted-foreground">
                {preview.removed.map(r => r.month).join(', ')}
              </p>
              {preview.removed.some(r => (r.fields?.length ?? 0) > 0) && (
                <p className="text-amber-700">
                  Destas, {preview.removed.filter(r => (r.fields?.length ?? 0) > 0).length} tinham ajuste manual.
                </p>
              )}
            </div>
          )}

          {preview.appended > 0 && (
            <p className="text-muted-foreground">
              {preview.appended} ocorrência{preview.appended > 1 ? 's novas serão criadas' : ' nova será criada'} a
              partir da regra.
            </p>
          )}

          {preview.dateShift && (
            <p className="text-muted-foreground">
              As datas de competência <span className="font-medium text-foreground">e de caixa</span> serão
              recalculadas. As ocorrências mantêm a identidade — nada é apagado e recriado.
            </p>
          )}

          {hasConflicts && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-2">
              <p className="font-medium text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                {preview.conflicts.length} ocorrência{preview.conflicts.length > 1 ? 's foram ajustadas' : ' foi ajustada'} à mão
              </p>
              <ul className="space-y-0.5 text-muted-foreground max-h-40 overflow-auto">
                {preview.conflicts.map(c => (
                  <li key={c.sequence}>
                    <span className="tabular-nums font-medium text-foreground">{c.month}</span>
                    {' — '}
                    {(c.fields ?? []).map(f => ADJUSTABLE_FIELD_LABELS[f]).join(', ')}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                Sem confirmar, esses campos são preservados e o restante é atualizado normalmente.
              </p>
              <div className="flex items-start gap-2 pt-1">
                <Checkbox
                  id="overwrite-adjusted"
                  checked={overwrite}
                  onCheckedChange={v => setOverwrite(v === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="overwrite-adjusted" className={cn('text-xs leading-snug cursor-pointer',
                  overwrite ? 'text-foreground' : 'text-muted-foreground')}>
                  Sobrescrever os ajustes manuais também
                </Label>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancelar</Button>
          <Button onClick={onConfirm} disabled={!canConfirm || isSaving}>
            {isSaving ? 'Aplicando…' : hasConflicts && overwrite ? 'Aplicar e sobrescrever' : 'Aplicar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
