'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, documents, transactionsStaging, transactions } from '@/db/schema'
import { eq, and, isNotNull, inArray, count, desc } from 'drizzle-orm'
import { inngest } from '@/lib/inngest'

export interface DocumentOption {
  id: string
  filename: string
  sourceType: string
  periodStart: string | null
  txCount: number
}

export async function getDocumentsWithTransactions(): Promise<DocumentOption[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!membership) return []

  const { organizationId } = membership

  // Conta transações por document_id nesta org
  const txCounts = await db
    .select({ documentId: transactions.documentId, total: count() })
    .from(transactions)
    .where(and(eq(transactions.organizationId, organizationId), isNotNull(transactions.documentId)))
    .groupBy(transactions.documentId)

  if (txCounts.length === 0) return []

  const ids = txCounts.map(r => r.documentId).filter(Boolean) as string[]
  const countMap = Object.fromEntries(txCounts.map(r => [r.documentId, r.total]))

  const docs = await db
    .select({ id: documents.id, filename: documents.filename, metadata: documents.metadata, createdAt: documents.createdAt })
    .from(documents)
    .where(and(eq(documents.organizationId, organizationId), inArray(documents.id, ids)))
    .orderBy(desc(documents.createdAt))
    .limit(50)

  return docs.map(d => {
    const meta = d.metadata as { source_type?: string; period_start?: string } | null
    return {
      id: d.id,
      filename: d.filename,
      sourceType: meta?.source_type ?? 'other',
      periodStart: meta?.period_start ?? null,
      txCount: countMap[d.id] ?? 0,
    }
  })
}

const schema = z.object({
  storagePath: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().positive(),
  type: z.enum(['invoice', 'statement', 'report', 'receipt', 'contract', 'other']),
  sourceType: z.string().min(1),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  pdfPassword: z.string().optional(),
})

export type CreateDocumentResult = {
  success?: boolean
  documentId?: string
  error?: string | null
}

export async function createDocumentRecord(
  input: z.infer<typeof schema>,
): Promise<CreateDocumentResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { storagePath, filename, mimeType, sizeBytes, type, sourceType, periodStart, periodEnd, pdfPassword } =
    parsed.data

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!membership) redirect('/onboarding')

  const { organizationId } = membership

  if (!storagePath.startsWith(`${organizationId}/`)) {
    return { error: 'Caminho de armazenamento inválido.' }
  }

  const [doc] = await db
    .insert(documents)
    .values({
      organizationId,
      type,
      filename,
      storagePath,
      mimeType,
      sizeBytes,
      extractionStatus: 'pending',
      uploadedByUserId: user.id,
      metadata: {
        source_type: sourceType,
        ...(periodStart ? { period_start: periodStart } : {}),
        ...(periodEnd ? { period_end: periodEnd } : {}),
      },
    })
    .returning({ id: documents.id })

  // URL assinada válida por 1h — permite que o job Inngest baixe o arquivo sem service role
  const { data: signedData } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, 3600)

  try {
    await inngest.send({
      name: 'document/uploaded',
      data: {
        documentId: doc.id,
        organizationId,
        storagePath,
        mimeType,
        sourceType,
        signedUrl: signedData?.signedUrl ?? null,
        pdfPassword: pdfPassword ?? null,
      },
    })
  } catch (err) {
    // Job não disparado (Inngest dev server offline ou chave inválida).
    // O documento já foi gravado com status 'pending' — o processamento
    // pode ser re-enfileirado depois.
    console.warn('[documents] inngest.send falhou:', err)
  }

  return { success: true, documentId: doc.id }
}

export async function deleteDocument(
  documentId: string,
): Promise<{ success?: boolean; error?: string }> {
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

  const [doc] = await db
    .select({ id: documents.id, storagePath: documents.storagePath })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
    .limit(1)

  if (!doc) return { error: 'Documento não encontrado.' }

  // Remove referência nas transações já importadas (FK sem cascade — deve ser nulificada antes)
  await db
    .update(transactions)
    .set({ documentId: null })
    .where(eq(transactions.documentId, documentId))

  // Remove arquivo do storage (best-effort)
  const { error: storageError } = await supabase.storage
    .from('documents')
    .remove([doc.storagePath])
  if (storageError) {
    console.warn('[deleteDocument] falha ao remover arquivo do storage:', storageError.message)
  }

  // Remove o registro do documento — staging rows em cascade pelo banco
  await db
    .delete(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))

  revalidatePath('/upload')
  return { success: true }
}
