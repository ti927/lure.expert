'use client'

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { createDocumentRecord } from '@/server/documents'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { buildImportTemplateCsv, downloadCsv, IMPORT_TEMPLATE_FILES } from '@/lib/csv-templates'
import { UploadCloud, FileText, CheckCircle2, AlertCircle, X, ArrowRight, FileSpreadsheet } from 'lucide-react'

const SOURCE_TYPES = [
  { value: 'bank', label: 'Extrato bancário', docType: 'statement', reportType: 'other' },
  { value: 'erp', label: 'Relatório ERP', docType: 'report', reportType: 'other' },
  { value: 'acquirer', label: 'Adquirente (Cielo, Stone, etc.)', docType: 'report', reportType: 'other' },
  { value: 'credit_card', label: 'Fatura de cartão corporativo', docType: 'statement', reportType: 'other' },
  { value: 'sefaz', label: 'Nota fiscal (SEFAZ)', docType: 'invoice', reportType: 'other' },
  { value: 'balance_sheet', label: 'Balanço Patrimonial', docType: 'report', reportType: 'balance_sheet' },
  { value: 'other', label: 'Outro', docType: 'other', reportType: 'other' },
] as const

const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]

const ACCEPTED_EXTENSIONS = '.pdf,.xls,.xlsx,.csv,.txt'
const MAX_SIZE_MB = 50

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UploadForm({ orgId }: { orgId: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [sourceType, setSourceType] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [referenceDate, setReferenceDate] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [pdfPassword, setPdfPassword] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isPdf = file?.type === 'application/pdf'
  const isBp = SOURCE_TYPES.find(s => s.value === sourceType)?.reportType === 'balance_sheet'

  function validateFile(f: File): string | null {
    if (!ACCEPTED_MIME_TYPES.includes(f.type)) {
      return 'Tipo não suportado. Use PDF, Excel, CSV ou imagem.'
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      return `Arquivo muito grande. Limite: ${MAX_SIZE_MB} MB.`
    }
    return null
  }

  const selectFile = useCallback((f: File) => {
    const err = validateFile(f)
    if (err) { setError(err); return }
    setFile(f)
    setError(null)
    setStatus('idle')
  // validateFile, setFile, setError, setStatus são estáveis — deps vazia é segura
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) selectFile(dropped)
  }, [selectFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { setError('Selecione um arquivo.'); return }
    if (!sourceType) { setError('Selecione a origem do arquivo.'); return }

    setStatus('uploading')
    setError(null)

    const supabase = createClient()
    const uuid = crypto.randomUUID()
    const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${orgId}/${uuid}-${safeFilename}`

    const { error: storageError } = await supabase.storage
      .from('documents')
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      })

    if (storageError) {
      setStatus('error')
      setError(`Erro ao enviar arquivo: ${storageError.message}`)
      return
    }

    const source = SOURCE_TYPES.find(s => s.value === sourceType)!
    const isBp = source.reportType === 'balance_sheet'
    const result = await createDocumentRecord({
      storagePath,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      type: source.docType as 'invoice' | 'statement' | 'report' | 'receipt' | 'contract' | 'other',
      sourceType,
      reportType: source.reportType as 'income_statement' | 'balance_sheet' | 'other',
      referenceDate: isBp ? referenceDate || undefined : undefined,
      periodStart: !isBp ? periodStart || undefined : undefined,
      periodEnd: !isBp ? periodEnd || undefined : undefined,
      pdfPassword: pdfPassword || undefined,
    })

    if (result.error || !result.success) {
      await supabase.storage.from('documents').remove([storagePath])
      setStatus('error')
      setError(result.error ?? 'Erro desconhecido.')
      return
    }

    setDocumentId(result.documentId!)
    setStatus('success')
  }

  function reset() {
    setFile(null)
    setSourceType('')
    setPeriodStart('')
    setPeriodEnd('')
    setReferenceDate('')
    setPdfPassword('')
    setStatus('idle')
    setError(null)
    setDocumentId(null)
  }

  if (status === 'success') {
    return (
      <Card>
        <CardContent className="py-12 flex flex-col items-center text-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-7 w-7 text-emerald-600" strokeWidth={1.5} />
          </div>
          <div>
            <p className="font-semibold text-foreground">Arquivo enviado</p>
            <p className="text-sm text-muted-foreground mt-1">{file?.name}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            expert está extraindo as linhas. Em alguns instantes você poderá revisá-las.
          </p>
          <div className="flex gap-3">
            {documentId && (
              <Button asChild>
                <Link href={`/upload/${documentId}/review`}>
                  Revisar linhas <ArrowRight size={15} className="ml-1" />
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={reset}>
              Enviar outro arquivo
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="source-type">Origem do arquivo</Label>
        <Select value={sourceType} onValueChange={setSourceType}>
          <SelectTrigger id="source-type" className="w-full">
            <SelectValue placeholder="Selecione a origem" />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_TYPES.map(s => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isBp ? (
        <div className="space-y-2">
          <Label htmlFor="reference-date">Data de referência do BP <span className="text-muted-foreground">(obrigatória)</span></Label>
          <Input
            id="reference-date"
            type="date"
            value={referenceDate}
            onChange={e => setReferenceDate(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Data do snapshot — geralmente o último dia do mês (ex: 31/01/2026).
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="period-start">Início do período <span className="text-muted-foreground">(opcional)</span></Label>
            <Input
              id="period-start"
              type="date"
              value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="period-end">Fim do período <span className="text-muted-foreground">(opcional)</span></Label>
            <Input
              id="period-end"
              type="date"
              value={periodEnd}
              onChange={e => setPeriodEnd(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>Arquivo</Label>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center cursor-pointer transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30',
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) selectFile(f)
            }}
          />
          {file ? (
            <div className="flex items-center gap-3">
              <FileText size={22} className="shrink-0 text-primary" />
              <div className="text-left">
                <p className="max-w-xs truncate text-sm font-medium text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setFile(null) }}
                className="ml-2 text-muted-foreground hover:text-foreground"
                aria-label="Remover arquivo"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <>
              <UploadCloud size={32} className="mb-3 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Arraste ou clique para selecionar</p>
              <p className="mt-1 text-xs text-muted-foreground">
                PDF, Excel (.xls/.xlsx), CSV, TXT — máx. {MAX_SIZE_MB} MB
              </p>
            </>
          )}
        </div>
      </div>

      {/*
        O modelo é oferecido, nunca exigido. A promessa da Fase 2 é "qualquer
        formato", e ela vale: quem arrasta o CSV do banco continua funcionando.
        Quem usa o modelo ganha leitura determinística, sem chamada de IA.
      */}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        <FileSpreadsheet size={14} className="mt-0.5 shrink-0" />
        <span>
          Qualquer formato funciona — o expert lê e organiza. Se preferir tabular à mão, use o{' '}
          <button
            type="button"
            onClick={() => downloadCsv(
              IMPORT_TEMPLATE_FILES[isBp ? 'balanco' : 'movimentos'],
              buildImportTemplateCsv(isBp ? 'balanco' : 'movimentos'),
            )}
            className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
          >
            modelo de {isBp ? 'balanço' : 'lançamentos'}
          </button>
          {' '}— arquivo no modelo é lido direto, sem consumir IA.
        </span>
      </div>

      {isPdf && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          PDFs protegidos por senha não são suportados diretamente. Se o arquivo pedir senha, abra no Chrome → Ctrl+P → Salvar como PDF e envie o novo arquivo.
        </div>
      )}

      {status === 'uploading' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Enviando...
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        type="submit"
        disabled={status === 'uploading' || !file || !sourceType || (isBp && !referenceDate)}
        className="w-full"
      >
        {status === 'uploading' ? 'Enviando...' : 'Enviar arquivo'}
      </Button>
    </form>
  )
}
