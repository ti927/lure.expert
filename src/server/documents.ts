'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, documents } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { inngest } from '@/lib/inngest'

const schema = z.object({
  storagePath: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().positive(),
  type: z.enum(['invoice', 'statement', 'report', 'receipt', 'contract', 'other']),
  sourceType: z.string().min(1),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
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

  const { storagePath, filename, mimeType, sizeBytes, type, sourceType, periodStart, periodEnd } =
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

  await inngest.send({
    name: 'document/uploaded',
    data: {
      documentId: doc.id,
      organizationId,
      storagePath,
      mimeType,
      sourceType,
      signedUrl: signedData?.signedUrl ?? null,
    },
  })

  return { success: true, documentId: doc.id }
}
