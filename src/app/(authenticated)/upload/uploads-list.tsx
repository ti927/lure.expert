'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Loader2, AlertCircle } from 'lucide-react'
import { DeleteDocumentButton } from './delete-document-button'

const SOURCE_LABELS: Record<string, string> = {
  bank: 'Extrato bancário',
  erp: 'Relatório ERP',
  acquirer: 'Adquirente',
  credit_card: 'Fatura de cartão',
  sefaz: 'Nota fiscal',
  other: 'Outro',
}

function formatDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Doc {
  id: string
  filename: string
  extractionStatus: string | null
  createdAt: Date | string
  metadata: Record<string, unknown> | null
}

interface Counts {
  pending: number
  approved: number
  total: number
}

interface Props {
  docs: Doc[]
  countsByDoc: Record<string, Counts>
}

export function UploadsList({ docs, countsByDoc }: Props) {
  const router = useRouter()

  const hasProcessing = docs.some(
    d => d.extractionStatus !== 'completed' && d.extractionStatus !== 'failed',
  )

  useEffect(() => {
    if (!hasProcessing) return
    const interval = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(interval)
  }, [hasProcessing, router])

  if (docs.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">Uploads recentes</h2>
      <div className="divide-y rounded-lg border">
        {docs.map(doc => {
          const sourceType = doc.metadata?.source_type as string | undefined
          const counts = countsByDoc[doc.id]
          const pendingCount = Number(counts?.pending ?? 0)
          const approvedCount = Number(counts?.approved ?? 0)
          const totalCount = Number(counts?.total ?? 0)
          const isProcessing =
            doc.extractionStatus !== 'completed' && doc.extractionStatus !== 'failed'

          return (
            <div key={doc.id} className="flex items-center justify-between px-4 py-3 gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{doc.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {SOURCE_LABELS[sourceType ?? ''] ?? sourceType ?? 'Outro'} ·{' '}
                  {formatDate(doc.createdAt)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3 text-sm">
                {isProcessing ? (
                  <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    <Loader2 size={12} className="animate-spin" />
                    Processando
                  </span>
                ) : doc.extractionStatus === 'failed' ? (
                  <span className="flex items-center gap-1.5 text-rose-600 text-xs">
                    <AlertCircle size={12} />
                    Falha
                  </span>
                ) : totalCount === 0 ? (
                  <span className="text-xs text-muted-foreground">Sem linhas</span>
                ) : (
                  <>
                    {pendingCount > 0 && (
                      <span className="text-xs text-amber-600 font-medium">
                        {pendingCount} pendente{pendingCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {pendingCount === 0 && approvedCount > 0 && (
                      <span className="text-xs text-emerald-600 font-medium">
                        {approvedCount} importada{approvedCount > 1 ? 's' : ''}
                      </span>
                    )}
                    <Link
                      href={`/upload/${doc.id}/review`}
                      className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                    >
                      {pendingCount > 0 ? 'Revisar' : 'Ver'}
                      <ArrowRight size={12} />
                    </Link>
                  </>
                )}
                <DeleteDocumentButton documentId={doc.id} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
