'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, invoices, transactions, legalEntities } from '@/db/schema'
import { eq, and, isNotNull, sql, desc, count, inArray } from 'drizzle-orm'

async function getAuthContext() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!membership) redirect('/onboarding')

  return { userId: user.id, organizationId: membership.organizationId }
}

const PAGE_SIZE = 100

// ─────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────

export type InvoiceFilters = {
  tipo?: 'saida' | 'entrada'
  status?: string[]
  legalEntityId?: string
  dateFrom?: string
  dateTo?: string
  amountMin?: string
  amountMax?: string
  page?: number
}

export type InvoiceRow = {
  id: string
  tipo: string
  chaveAcesso: string
  numeroNf: string | null
  serie: string | null
  emitenteCnpj: string
  emitenteNome: string | null
  destinatarioCnpj: string | null
  destinatarioNome: string | null
  dataEmissao: string
  totalNf: string
  status: string
  reconciliationScore: string | null
  transactionId: string | null
  legalEntityId: string
  legalEntityName: string
}

export type InvoiceStats = {
  totalAReceber: string
  totalAPagar: string
  countPendenteRevisao: number
  countNova: number
}

// ─────────────────────────────────────────
// listInvoices
// ─────────────────────────────────────────

export async function listInvoices(filters: InvoiceFilters = {}) {
  const { organizationId } = await getAuthContext()

  const {
    tipo,
    status,
    legalEntityId,
    dateFrom,
    dateTo,
    amountMin,
    amountMax,
    page = 1,
  } = filters

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [eq(invoices.organizationId, organizationId)]

  if (tipo) conditions.push(eq(invoices.tipo, tipo))
  if (legalEntityId) conditions.push(eq(invoices.legalEntityId, legalEntityId))
  if (dateFrom) conditions.push(sql`${invoices.dataEmissao} >= ${dateFrom}`)
  if (dateTo) conditions.push(sql`${invoices.dataEmissao} <= ${dateTo}`)
  if (amountMin) conditions.push(sql`${invoices.totalNf}::numeric >= ${amountMin}::numeric`)
  if (amountMax) conditions.push(sql`${invoices.totalNf}::numeric <= ${amountMax}::numeric`)
  if (status && status.length > 0) conditions.push(inArray(invoices.status, status))

  const offset = (page - 1) * PAGE_SIZE

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: invoices.id,
        tipo: invoices.tipo,
        chaveAcesso: invoices.chaveAcesso,
        numeroNf: invoices.numeroNf,
        serie: invoices.serie,
        emitenteCnpj: invoices.emitenteCnpj,
        emitenteNome: invoices.emitenteNome,
        destinatarioCnpj: invoices.destinatarioCnpj,
        destinatarioNome: invoices.destinatarioNome,
        dataEmissao: invoices.dataEmissao,
        totalNf: invoices.totalNf,
        status: invoices.status,
        reconciliationScore: invoices.reconciliationScore,
        transactionId: invoices.transactionId,
        legalEntityId: invoices.legalEntityId,
        legalEntityName: legalEntities.name,
      })
      .from(invoices)
      .innerJoin(legalEntities, eq(invoices.legalEntityId, legalEntities.id))
      .where(and(...conditions))
      .orderBy(desc(invoices.dataEmissao))
      .limit(PAGE_SIZE)
      .offset(offset),

    db
      .select({ total: count() })
      .from(invoices)
      .innerJoin(legalEntities, eq(invoices.legalEntityId, legalEntities.id))
      .where(and(...conditions)),
  ])

  const total = totalResult[0]?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return { rows: rows as InvoiceRow[], total, totalPages, page }
}

// ─────────────────────────────────────────
// getInvoiceStats — cards de resumo para o painel /nfe
// ─────────────────────────────────────────

export async function getInvoiceStats(): Promise<InvoiceStats> {
  const { organizationId } = await getAuthContext()

  const [stats] = await db.execute<{
    total_a_receber: string
    total_a_pagar: string
    count_pendente_revisao: string
    count_nova: string
  }>(sql`
    SELECT
      COALESCE(SUM(CASE
        WHEN tipo = 'saida' AND status NOT IN ('casada', 'cancelada', 'denegada')
        THEN total_nf::numeric ELSE 0 END), 0)::text AS total_a_receber,
      COALESCE(SUM(CASE
        WHEN tipo = 'entrada' AND status NOT IN ('casada', 'cancelada', 'denegada')
        THEN total_nf::numeric ELSE 0 END), 0)::text AS total_a_pagar,
      COUNT(*) FILTER (WHERE status = 'pendente_revisao')::text AS count_pendente_revisao,
      COUNT(*) FILTER (WHERE status = 'nova')::text AS count_nova
    FROM invoices
    WHERE organization_id = ${organizationId}::uuid
  `)

  return {
    totalAReceber: stats?.total_a_receber ?? '0',
    totalAPagar: stats?.total_a_pagar ?? '0',
    countPendenteRevisao: Number(stats?.count_pendente_revisao ?? 0),
    countNova: Number(stats?.count_nova ?? 0),
  }
}

// ─────────────────────────────────────────
// manualReconcile — reconciliação manual no painel /nfe
// ─────────────────────────────────────────

export async function manualReconcile(invoiceId: string, transactionId: string) {
  const { organizationId } = await getAuthContext()

  const [inv] = await db
    .select({ id: invoices.id, dataEmissao: invoices.dataEmissao, status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
    .limit(1)

  if (!inv) throw new Error('NF-e não encontrada')
  if (inv.status === 'casada') throw new Error('NF-e já reconciliada com outra transação')

  const [tx] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.organizationId, organizationId)))
    .limit(1)

  if (!tx) throw new Error('Transação não encontrada')

  await db.update(invoices)
    .set({
      transactionId,
      status: 'casada',
      reconciliationScore: '1.00',
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId))

  await db.update(transactions)
    .set({
      invoiceId,
      date: inv.dataEmissao,  // competência real da NF alimenta o DRE
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, transactionId))

  revalidatePath('/nfe')
  revalidatePath('/dre')
  revalidatePath('/transacoes')
}

// ─────────────────────────────────────────
// getInvoicePendingCount — badge na sidebar
// ─────────────────────────────────────────

export async function getInvoicePendingCount(): Promise<number> {
  try {
    const { organizationId } = await getAuthContext()
    const [result] = await db
      .select({ cnt: count() })
      .from(invoices)
      .where(and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.status, 'pendente_revisao'),
      ))
    return Number(result?.cnt ?? 0)
  } catch {
    return 0
  }
}
