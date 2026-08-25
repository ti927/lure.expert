export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Importar' }
import { db } from '@/db'
import { documents, transactionsStaging } from '@/db/schema'
import { eq, inArray, desc, sql } from 'drizzle-orm'
import { getAuthContext } from '@/lib/auth-context'
import { UploadForm } from './upload-form'
import { UploadsList } from './uploads-list'

export default async function UploadPage() {
  const { organizationId } = await getAuthContext()

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

  const countsByDoc = Object.fromEntries(
    stagingCounts.map(c => [
      c.documentId,
      { pending: Number(c.pending), approved: Number(c.approved), total: Number(c.total) },
    ]),
  )

  return (
    <div className="p-6 max-w-2xl space-y-10">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Enviar arquivo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Extratos, relatórios, notas fiscais e outros documentos financeiros
          </p>
        </div>
        <UploadForm orgId={organizationId} />
      </div>

      <UploadsList docs={recentDocs as Parameters<typeof UploadsList>[0]['docs']} countsByDoc={countsByDoc} />
    </div>
  )
}
