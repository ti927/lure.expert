'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { AlertCircle, Download, FileText, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { fmtMoney, monthLabel } from '@/lib/format'
import { BUDGET_CSV, buildBudgetTemplateCsv, downloadCsv } from '@/lib/csv-templates'
import type { BudgetVersionListItem } from '@/lib/budget-types'
import type { BudgetCsvParseResult } from '@/lib/budget-import'
import { importBudgetCsv, previewBudgetCsv } from '@/server/budget'

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  version:      BudgetVersionListItem
  onSaved:      () => void
}

export function ImportCsvDialog({ open, onOpenChange, version, onSaved }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState<string | null>(null)
  const [csvText, setCsvText]   = useState<string | null>(null)
  const [preview, setPreview]   = useState<BudgetCsvParseResult | null>(null)
  const [existing, setExisting] = useState<{ series: number; total: number }>({ series: 0, total: 0 })
  const [replaceExisting, setReplace] = useState(false)

  const [isPreviewing, startPreview] = useTransition()
  const [isCommitting, startCommit]  = useTransition()

  useEffect(() => {
    if (open) return
    setFileName(null); setCsvText(null); setPreview(null); setReplace(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [open])

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      setFileName(file.name)
      setCsvText(text)
      setPreview(null)
      startPreview(async () => {
        const result = await previewBudgetCsv(version.id, text)
        if ('error' in result) { toast.error(result.error); return }
        setPreview(result.preview)
        setExisting(result.existing)
      })
    }
    reader.onerror = () => toast.error('Não foi possível ler o arquivo.')
    reader.readAsText(file, 'utf-8')
  }

  function commit() {
    if (!csvText) return
    startCommit(async () => {
      const result = await importBudgetCsv(version.id, csvText, { replaceExisting })
      if ('error' in result && result.error) { toast.error(result.error); return }
      const created = 'series' in result ? result.series : 0
      const skipped = 'skipped' in result ? result.skipped : 0
      toast.success(
        `${created} ${created === 1 ? 'lançamento importado' : 'lançamentos importados'}`
        + (skipped > 0 ? ` — ${skipped} ${skipped === 1 ? 'linha ficou' : 'linhas ficaram'} de fora por erro.` : '.'),
      )
      onOpenChange(false)
      onSaved()
    })
  }

  const canCommit = !!preview && !preview.fileError && preview.valid > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Importar planilha</DialogTitle>
          <DialogDescription>
            Uma linha por lançamento, doze colunas de meses. As colunas de mês são sempre do
            exercício de {version.fiscalYear} — a coluna &quot;mar&quot; é março de {version.fiscalYear}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto space-y-3 pr-1">
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">Modelo de planilha</p>
              <p className="text-[11px] text-muted-foreground">
                CSV separado por ponto-e-vírgula. Obrigatórias: <code className="font-mono">categoria</code> e
                as doze colunas de mês. Opcionais: <code className="font-mono">{BUDGET_CSV.optional.join(', ')}</code>.
              </p>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs shrink-0"
              onClick={() => downloadCsv(BUDGET_CSV.filename, buildBudgetTemplateCsv())}>
              <Download className="h-3.5 w-3.5 mr-1" />
              Baixar modelo
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs"
              onClick={() => fileInputRef.current?.click()} disabled={isPreviewing || isCommitting}>
              <Upload className="h-3.5 w-3.5 mr-1" />
              Escolher arquivo
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            {fileName && <span className="text-xs text-muted-foreground truncate">{fileName}</span>}
            {isPreviewing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>

          <p className="text-[11px] text-muted-foreground leading-snug">
            A coluna <code className="font-mono">categoria</code> aceita o código (3.2.01) ou o nome da natureza
            filho. Sem a coluna <code className="font-mono">tipo</code>, entrada ou saída vem do tipo da
            categoria. Meses em branco viram zero, e os do começo e do fim são aparados — quem só tem valor
            em nov e dez gera um lançamento de duas ocorrências, não de doze.
          </p>

          {preview?.fileError && (
            <div className="flex gap-2 p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-900">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-medium">Arquivo inválido</p>
                <p className="mt-1">{preview.fileError}</p>
              </div>
            </div>
          )}

          {preview && !preview.fileError && (
            <>
              <div className="flex items-center gap-4 text-xs flex-wrap">
                <span className="text-muted-foreground">
                  <span className="tabular-nums font-medium text-emerald-700">{preview.valid}</span> a importar
                  {preview.invalid > 0 && (
                    <> · <span className="tabular-nums font-medium text-rose-600">{preview.invalid}</span> com erro</>
                  )}
                </span>
                <span className="text-muted-foreground">
                  Entradas <span className="tabular-nums font-medium text-emerald-700">{fmtMoney(preview.totals.inflow)}</span>
                </span>
                <span className="text-muted-foreground">
                  Saídas <span className="tabular-nums font-medium text-rose-600">{fmtMoney(preview.totals.outflow)}</span>
                </span>
              </div>

              {existing.series > 0 && (
                <label className="flex items-start gap-2 rounded-md border border-input px-2.5 py-2 cursor-pointer hover:bg-muted/50">
                  <input type="checkbox" checked={replaceExisting} className="mt-0.5"
                    onChange={e => setReplace(e.target.checked)} />
                  <span className="text-[11px] leading-snug">
                    <span className="font-medium">
                      Substituir a importação anterior ({existing.series} {existing.series === 1 ? 'lançamento' : 'lançamentos'})
                    </span>
                    <span className="block text-muted-foreground">
                      {replaceExisting
                        ? 'Só o que veio de planilha é removido. Lançamentos manuais e copiados do realizado ficam.'
                        : 'Sem marcar, os novos somam-se aos que já vieram de planilha — e o orçado conta duas vezes.'}
                    </span>
                  </span>
                </label>
              )}

              {preview.rows.length > 0 && (
                <div className="border rounded-lg overflow-auto max-h-[45vh]">
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="border-b">
                        <th className="text-left px-2 py-1.5 font-medium w-12">Linha</th>
                        <th className="text-left px-2 py-1.5 font-medium">Lançamento</th>
                        <th className="text-left px-2 py-1.5 font-medium">Categoria</th>
                        <th className="text-left px-2 py-1.5 font-medium w-20">Início</th>
                        <th className="text-left px-2 py-1.5 font-medium w-16">Ocorr.</th>
                        <th className="text-right px-2 py-1.5 font-medium w-28">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map(r => (
                        <tr key={r.line} className={cn('border-b last:border-b-0', r.status === 'invalid' && 'bg-rose-50')}>
                          <td className="px-2 py-1 tabular-nums text-muted-foreground">{r.line}</td>
                          <td className="px-2 py-1">
                            <span className={r.direction === 'inflow' ? 'text-emerald-700' : 'text-rose-600'}>
                              {r.direction === 'inflow' ? '+ ' : '− '}
                            </span>
                            {r.description}
                            {r.dimensionLabel && (
                              <span className="text-muted-foreground"> · {r.dimensionLabel}</span>
                            )}
                            {r.status === 'invalid' && (
                              <p className="text-rose-700">{r.message}</p>
                            )}
                          </td>
                          <td className="px-2 py-1 text-muted-foreground truncate">{r.categoryLabel}</td>
                          <td className="px-2 py-1 tabular-nums">{r.startMonth ? monthLabel(r.startMonth) : '—'}</td>
                          <td className="px-2 py-1 tabular-nums">{r.occurrences > 0 ? `${r.occurrences}×` : '—'}</td>
                          <td className="px-2 py-1 text-right tabular-nums font-medium">
                            {r.status === 'ok' ? fmtMoney(r.total) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCommitting}>Cancelar</Button>
          <Button onClick={commit} disabled={!canCommit || isCommitting || isPreviewing}>
            {isCommitting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Importando…</>
              : preview && preview.valid > 0
                ? `Importar ${preview.valid} ${preview.valid === 1 ? 'lançamento' : 'lançamentos'}`
                : 'Importar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
