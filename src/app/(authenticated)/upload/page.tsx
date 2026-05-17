import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, documents, transactionsStaging } from '@/db/schema'
import { eq, and, isNotNull, inArray, desc, sql } from 'drizzle-orm'
import { UploadForm } from './upload-form'
import { DeleteDocumentButton } from './delete-document-button'
import { ArrowRight, Loader2, AlertCircle } from 'lucide-react'

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

export default async function UploadPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!membership) redirect('/onboarding')

  const { organizationId } = membership

  // Busca os 10 uploads mais recentes da organização
  const recentDocs = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      extractionStatus: documents.extractionStatus,
      createdAt: documents.createdAt,
      metadata: documents.metadata,
    })
    .from(documents)
    .where(eq(documents.organizationId, organizationId))
    .orderBy(desc(documents.createdAt))
    .limit(10)

  // Conta linhas de staging por documento
  const docIds = recentDocs.map(d => d.id)
  const stagingCounts =
    docIds.length > 0
      ? await db
          .select({
            documentId: transactionsStaging.documentId,
            total: sql<number>`count(*)::int`,
            pending: sql<number>`sum(case when ${transactionsStaging.status} = 'pending' then 1 else 0 end)::int`,
            approved: sql<number>`sum(case when ${transactionsStaging.status} = 'approved' then 1 else 0 end)::int`,
          })
          .from(transactionsStaging)
          .where(inArray(transactionsStaging.documentId, docIds))
          .groupBy(transactionsStaging.documentId)
      : []

  const countsByDoc = Object.fromEntries(stagingCounts.map(c => [c.documentId, c]))

  return (
    <div className="p-6 max-w-2xl space-y-10">
      {/* Formulário de upload */}
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Enviar arquivo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Extratos, relatórios, notas fiscais e outros documentos financeiros
          </p>
        </div>
        <UploadForm orgId={organizationId} />
      </div>

      {/* Uploads recentes */}
      {recentDocs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Uploads recentes</h2>
          <div className="divide-y rounded-lg border">
            {recentDocs.map(doc => {
              const sourceType = (doc.metadata as Record<string, unknown>)?.source_type as string
              const counts = countsByDoc[doc.id]
              const pendingCount = Number(counts?.pending ?? 0)
              const approvedCount = Number(counts?.approved ?? 0)
              const totalCount = Number(counts?.total ?? 0)
              const isProcessing =
                doc.extractionStatus !== 'completed' && doc.extractionStatus !== 'failed'

              return (
                <div
                  key={doc.id}
                  className="flex items-center justify-between px-4 py-3 gap-4"
                >
                  {/* Info do arquivo */}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {doc.filename}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {SOURCE_LABELS[sourceType] ?? sourceType ?? 'Outro'} ·{' '}
                      {formatDate(doc.createdAt)}
                    </p>
                  </div>

                  {/* Status + ação + apagar */}
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
      )}
    </div>
  )
}
