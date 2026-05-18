'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Upload, Download, AlertCircle, CheckCircle2, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { downloadTemplate, TEMPLATES, type DimensionKind } from '@/lib/csv-templates'
import type {
  PreviewResult,
  CategoryPreviewRow,
  FlatPreviewRow,
  CommitResult,
} from '@/server/imports'

type PreviewRow = CategoryPreviewRow | FlatPreviewRow

interface CsvImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: DimensionKind
  preview: (csv: string) => Promise<PreviewResult<PreviewRow>>
  commit: (csv: string) => Promise<CommitResult>
}

export function CsvImportDialog({ open, onOpenChange, kind, preview, commit }: CsvImportDialogProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState<string | null>(null)
  const [csvText, setCsvText] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<PreviewResult<PreviewRow> | null>(null)
  const [isPreviewing, startPreviewTransition] = useTransition()
  const [isCommitting, startCommitTransition] = useTransition()

  const template = TEMPLATES[kind]
  const expectedCols = template.headers.join('; ')

  const labels: Record<DimensionKind, { title: string; singular: string; plural: string }> = {
    'categorias': { title: 'Importar categorias', singular: 'categoria', plural: 'categorias' },
    'centros-de-custo': { title: 'Importar centros de custo', singular: 'centro de custo', plural: 'centros de custo' },
    'unidades-de-negocio': { title: 'Importar unidades de negócio', singular: 'unidade', plural: 'unidades' },
    'entidades-juridicas': { title: 'Importar entidades jurídicas', singular: 'entidade', plural: 'entidades' },
  }
  const L = labels[kind]

  function reset() {
    setFileName(null)
    setCsvText(null)
    setPreviewResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleClose(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  function handleFileSelect(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      setFileName(file.name)
      setCsvText(text)
      setPreviewResult(null)
      startPreviewTransition(async () => {
        const result = await preview(text)
        setPreviewResult(result)
      })
    }
    reader.onerror = () => toast.error('Não foi possível ler o arquivo.')
    reader.readAsText(file, 'utf-8')
  }

  function handleConfirm() {
    if (!csvText || !previewResult || !previewResult.ok) return
    startCommitTransition(async () => {
      const result = await commit(csvText)
      if (result.error) {
        toast.error(result.error)
        return
      }
      const parts: string[] = []
      if (result.inserted) parts.push(`${result.inserted} criado(s)`)
      if (result.updated) parts.push(`${result.updated} atualizado(s)`)
      toast.success(parts.length > 0 ? parts.join(', ') + '.' : 'Importação concluída.')
      reset()
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{L.title}</DialogTitle>
          <DialogDescription>
            Arquivo CSV separado por <strong>ponto-e-vírgula (;)</strong>. As colunas devem ser
            exatamente: <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">{expectedCols}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Download template */}
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Modelo de CSV</p>
              <p className="text-xs text-muted-foreground">
                Baixe o modelo para garantir o formato correto.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadTemplate(kind)}
            >
              <Download className="h-4 w-4 mr-1" />
              Baixar modelo
            </Button>
          </div>

          {/* Upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Arquivo CSV</label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isPreviewing || isCommitting}
              >
                <Upload className="h-4 w-4 mr-1" />
                Escolher arquivo
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFileSelect(file)
                }}
              />
              {fileName && (
                <span className="text-sm text-muted-foreground truncate">{fileName}</span>
              )}
              {isPreviewing && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Preview */}
          {previewResult && (
            <>
              {/* Erro de arquivo (cabeçalho ruim, vazio, etc) */}
              {previewResult.fileError && (
                <div className="flex gap-2 p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-900">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium">Arquivo inválido</p>
                    <p className="mt-1">{previewResult.fileError}</p>
                  </div>
                </div>
              )}

              {/* Sumário */}
              {!previewResult.fileError && (
                <div className="flex flex-wrap items-center gap-2">
                  {previewResult.ok ? (
                    <Badge variant="secondary" className="bg-emerald-100 text-emerald-900 border-emerald-200">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {previewResult.summary.total} linha(s) válida(s)
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-rose-100 text-rose-900 border-rose-200">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {previewResult.summary.invalid} linha(s) com erro
                    </Badge>
                  )}
                  {previewResult.summary.willInsert > 0 && (
                    <Badge variant="outline">
                      {previewResult.summary.willInsert} a criar
                    </Badge>
                  )}
                  {previewResult.summary.willUpdate > 0 && (
                    <Badge variant="outline">
                      {previewResult.summary.willUpdate} a atualizar
                    </Badge>
                  )}
                </div>
              )}

              {/* Tabela de preview */}
              {previewResult.rows.length > 0 && (
                <div className="border rounded-lg overflow-hidden max-h-[40vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground w-12">Linha</th>
                        <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground w-20">Status</th>
                        {kind === 'categorias' ? (
                          <>
                            <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">Código</th>
                            <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">Tipo</th>
                            <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">Natureza Pai</th>
                            <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">Natureza Filho</th>
                          </>
                        ) : (
                          <>
                            <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">Código</th>
                            <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">Nome</th>
                            {kind === 'entidades-juridicas' && (
                              <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">CNPJ</th>
                            )}
                          </>
                        )}
                        <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">Observação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewResult.rows.map((row) => (
                        <tr
                          key={row.line}
                          className={row.status === 'invalid' ? 'bg-rose-50' : ''}
                        >
                          <td className="px-3 py-1.5 text-xs text-muted-foreground font-mono">{row.line}</td>
                          <td className="px-3 py-1.5">
                            <StatusBadge status={row.status} />
                          </td>
                          {kind === 'categorias' ? (
                            <CategoryCells row={row as CategoryPreviewRow} />
                          ) : (
                            <FlatCells row={row as FlatPreviewRow} showCnpj={kind === 'entidades-juridicas'} />
                          )}
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">
                            {row.status === 'invalid' ? (
                              <span className="text-rose-700">{row.message}</span>
                            ) : (
                              row.changeHint ?? (row.status === 'insert' ? 'novo' : '')
                            )}
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
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isCommitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!previewResult?.ok || isCommitting || isPreviewing || previewResult.rows.length === 0}
          >
            {isCommitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Importando...
              </>
            ) : (
              `Confirmar e importar`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StatusBadge({ status }: { status: 'insert' | 'update' | 'invalid' }) {
  if (status === 'insert')
    return <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50">criar</Badge>
  if (status === 'update')
    return <Badge variant="outline" className="text-sky-700 border-sky-200 bg-sky-50">atualizar</Badge>
  return <Badge variant="outline" className="text-rose-700 border-rose-200 bg-rose-50">erro</Badge>
}

function CategoryCells({ row }: { row: CategoryPreviewRow }) {
  return (
    <>
      <td className="px-3 py-1.5 font-mono text-xs">{row.codigo}</td>
      <td className="px-3 py-1.5 text-xs">{row.tipo}</td>
      <td className="px-3 py-1.5">{row.paiNome}</td>
      <td className="px-3 py-1.5">{row.filhoNome}</td>
    </>
  )
}

function FlatCells({ row, showCnpj }: { row: FlatPreviewRow; showCnpj: boolean }) {
  return (
    <>
      <td className="px-3 py-1.5 font-mono text-xs">{row.codigo || '—'}</td>
      <td className="px-3 py-1.5">{row.nome}</td>
      {showCnpj && (
        <td className="px-3 py-1.5 text-xs font-mono">{row.cnpj || '—'}</td>
      )}
    </>
  )
}
