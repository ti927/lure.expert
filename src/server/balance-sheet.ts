'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, fixedAssets, loans, equityMovements, inventorySnapshots } from '@/db/schema'
import { eq, and, isNotNull, desc } from 'drizzle-orm'

type ActionResult = { error?: string; success?: boolean }

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

// ─── IMOBILIZADO (fixed_assets) ───────────────────────────────────────────────

const fixedAssetSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(200),
  description: z.string().max(500).optional(),
  acquisitionDate: z.string().min(1, 'Data de aquisição obrigatória'),
  acquisitionValue: z.coerce.number().positive('Valor de aquisição deve ser positivo'),
  currentValue: z.coerce.number().min(0, 'Valor atual não pode ser negativo'),
  depreciationMethod: z.string().max(50).optional(),
  usefulLifeMonths: z.number().int().positive().optional(),
  monthlyDepreciation: z.number().min(0).optional(),
  status: z.enum(['active', 'sold', 'written_off', 'disposed']).default('active'),
})

export type FixedAssetInput = z.infer<typeof fixedAssetSchema>

export async function getFixedAssets() {
  const { organizationId } = await getAuthContext()
  return db
    .select()
    .from(fixedAssets)
    .where(eq(fixedAssets.organizationId, organizationId))
    .orderBy(desc(fixedAssets.acquisitionDate))
}

export async function createFixedAsset(input: FixedAssetInput): Promise<ActionResult> {
  const { organizationId } = await getAuthContext()
  const parsed = fixedAssetSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { usefulLifeMonths, monthlyDepreciation, ...rest } = parsed.data
  await db.insert(fixedAssets).values({
    organizationId,
    ...rest,
    acquisitionValue: String(rest.acquisitionValue),
    currentValue: String(rest.currentValue),
    usefulLifeMonths,
    monthlyDepreciation: monthlyDepreciation !== undefined ? String(monthlyDepreciation) : undefined,
  })
  revalidatePath('/configuracoes/imobilizado')
  return { success: true }
}

export async function updateFixedAsset(id: string, input: FixedAssetInput): Promise<ActionResult> {
  const { organizationId } = await getAuthContext()
  const parsed = fixedAssetSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { usefulLifeMonths, monthlyDepreciation, ...rest } = parsed.data
  await db
    .update(fixedAssets)
    .set({
      ...rest,
      acquisitionValue: String(rest.acquisitionValue),
      currentValue: String(rest.currentValue),
      usefulLifeMonths,
      monthlyDepreciation: monthlyDepreciation !== undefined ? String(monthlyDepreciation) : null,
      updatedAt: new Date(),
    })
    .where(and(eq(fixedAssets.id, id), eq(fixedAssets.organizationId, organizationId)))
  revalidatePath('/configuracoes/imobilizado')
  return { success: true }
}

export async function deleteFixedAsset(id: string): Promise<ActionResult> {
  const { organizationId } = await getAuthContext()
  await db
    .delete(fixedAssets)
    .where(and(eq(fixedAssets.id, id), eq(fixedAssets.organizationId, organizationId)))
  revalidatePath('/configuracoes/imobilizado')
  return { success: true }
}

// ─── EMPRÉSTIMOS (loans) ─────────────────────────────────────────────────────

const loanSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(200),
  lender: z.string().min(1, 'Credor obrigatório').max(200),
  type: z.enum(['working_capital', 'investment', 'payroll', 'partner_loan', 'other']),
  originalAmount: z.coerce.number().positive('Valor original deve ser positivo'),
  currentBalance: z.coerce.number().min(0, 'Saldo não pode ser negativo'),
  interestRateAnnual: z.number().min(0).max(100).optional(),
  startDate: z.string().min(1, 'Data de início obrigatória'),
  endDate: z.string().optional(),
  installmentAmount: z.number().positive().optional(),
  installmentCountTotal: z.number().int().positive().optional(),
  installmentCountPaid: z.coerce.number().int().min(0).default(0),
  status: z.enum(['active', 'paid_off', 'in_default', 'renegotiated']).default('active'),
})

export type LoanInput = z.infer<typeof loanSchema>

export async function getLoans() {
  const { organizationId } = await getAuthContext()
  return db
    .select()
    .from(loans)
    .where(eq(loans.organizationId, organizationId))
    .orderBy(desc(loans.startDate))
}

export async function createLoan(input: LoanInput): Promise<ActionResult> {
  const { organizationId } = await getAuthContext()
  const parsed = loanSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { originalAmount, currentBalance, interestRateAnnual, installmentAmount, installmentCountTotal, installmentCountPaid, endDate, ...rest } = parsed.data
  await db.insert(loans).values({
    organizationId,
    ...rest,
    originalAmount: String(originalAmount),
    currentBalance: String(currentBalance),
    interestRateAnnual: interestRateAnnual !== undefined ? String(interestRateAnnual / 100) : undefined,
    installmentAmount: installmentAmount !== undefined ? String(installmentAmount) : undefined,
    installmentCountTotal,
    installmentCountPaid: installmentCountPaid ?? 0,
    endDate,
  })
  revalidatePath('/configuracoes/emprestimos')
  return { success: true }
}

export async function updateLoan(id: string, input: LoanInput): Promise<ActionResult> {
  const { organizationId } = await getAuthContext()
  const parsed = loanSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { originalAmount, currentBalance, interestRateAnnual, installmentAmount, installmentCountTotal, installmentCountPaid, endDate, ...rest } = parsed.data
  await db
    .update(loans)
    .set({
      ...rest,
      originalAmount: String(originalAmount),
      currentBalance: String(currentBalance),
      interestRateAnnual: interestRateAnnual !== undefined ? String(interestRateAnnual / 100) : null,
      installmentAmount: installmentAmount !== undefined ? String(installmentAmount) : null,
      installmentCountTotal: installmentCountTotal ?? null,
      installmentCountPaid: installmentCountPaid ?? 0,
      endDate: endDate ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(loans.id, id), eq(loans.organizationId, organizationId)))
  revalidatePath('/configuracoes/emprestimos')
  return { success: true }
}

export async function deleteLoan(id: string): Promise<ActionResult> {
  const { organizationId } = await getAuthContext()
  await db
    .delete(loans)
    .where(and(eq(loans.id, id), eq(loans.organizationId, organizationId)))
  revalidatePath('/configuracoes/emprestimos')
  return { success: true }
}

// ─── PATRIMÔNIO LÍQUIDO (equity_movements) ────────────────────────────────────

const equityMovementSchema = z.object({
  type: z.enum(['capital_contribution', 'capital_withdrawal', 'profit_distribution', 'reserve_transfer', 'other']),
  amount: z.coerce.number().positive('Valor deve ser positivo'),
  direction: z.enum(['inflow', 'outflow']),
  date: z.string().min(1, 'Data obrigatória'),
  description: z.string().min(1, 'Descrição obrigatória').max(500),
})

export type EquityMovementInput = z.infer<typeof equityMovementSchema>

export async function getEquityMovements() {
  const { organizationId } = await getAuthContext()
  return db
    .select()
    .from(equityMovements)
    .where(eq(equityMovements.organizationId, organizationId))
    .orderBy(desc(equityMovements.date))
}

export async function createEquityMovement(input: EquityMovementInput): Promise<ActionResult> {
  const { organizationId } = await getAuthContext()
  const parsed = equityMovementSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { amount, ...rest } = parsed.data
  await db.insert(equityMovements).values({
    organizationId,
    ...rest,
    amount: String(amount),
  })
  revalidatePath('/configuracoes/patrimonio-liquido')
  return { success: true }
}

export async function deleteEquityMovement(id: string): Promise<ActionResult> {
  const { organizationId } = await getAuthContext()
  await db
    .delete(equityMovements)
    .where(and(eq(equityMovements.id, id), eq(equityMovements.organizationId, organizationId)))
  revalidatePath('/configuracoes/patrimonio-liquido')
  return { success: true }
}

// ─── ESTOQUE (inventory_snapshots) ───────────────────────────────────────────

const inventorySnapshotSchema = z.object({
  snapshotDate: z.string().min(1, 'Data do snapshot obrigatória'),
  totalValue: z.coerce.number().min(0, 'Valor não pode ser negativo'),
  notes: z.string().max(500).optional(),
})

export type InventorySnapshotInput = z.infer<typeof inventorySnapshotSchema>

export async function getInventorySnapshots() {
  const { organizationId } = await getAuthContext()
  return db
    .select()
    .from(inventorySnapshots)
    .where(eq(inventorySnapshots.organizationId, organizationId))
    .orderBy(desc(inventorySnapshots.snapshotDate))
}

export async function createInventorySnapshot(input: InventorySnapshotInput): Promise<ActionResult> {
  const { organizationId } = await getAuthContext()
  const parsed = inventorySnapshotSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { totalValue, ...rest } = parsed.data
  await db.insert(inventorySnapshots).values({
    organizationId,
    ...rest,
    totalValue: String(totalValue),
  })
  revalidatePath('/configuracoes/estoque')
  return { success: true }
}

export async function deleteInventorySnapshot(id: string): Promise<ActionResult> {
  const { organizationId } = await getAuthContext()
  await db
    .delete(inventorySnapshots)
    .where(and(eq(inventorySnapshots.id, id), eq(inventorySnapshots.organizationId, organizationId)))
  revalidatePath('/configuracoes/estoque')
  return { success: true }
}
