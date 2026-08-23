'use server'

// Casca de sessão. O miolo do rateio MUDOU DE CASA para
// `@/lib/allocations-write` — o servidor MCP não pode importar de
// `src/server/**`, e duas cópias da regra é como a tela e o MCP passam a
// repartir centavo de jeitos diferentes.

import { revalidatePath } from 'next/cache'
import { getAuthContext } from '@/lib/auth-context'
import {
  listarAllocations, gravarAllocations, preverLoteDeRateio, aplicarLoteDeRateio,
  type AllocationPart, type AllocationWeight, type AllocationRow, type BatchPreviewRow,
} from '@/lib/allocations-write'

export type { AllocationPart, AllocationWeight, AllocationRow, BatchPreviewRow }

function revalidar() {
  revalidatePath('/transacoes')
  revalidatePath('/dre')
  revalidatePath('/fluxo')
}

/** As partes de um lançamento, em ordem. Vazio = lançamento sem rateio. */
export async function getAllocations(transactionId: string): Promise<AllocationRow[]> {
  const { organizationId } = await getAuthContext()
  return listarAllocations(organizationId, transactionId)
}

export async function saveAllocations(
  transactionId: string,
  partes: AllocationPart[],
  templateId?: string | null,
) {
  const { organizationId } = await getAuthContext()
  const r = await gravarAllocations(organizationId, transactionId, partes, templateId)
  if ('success' in r) revalidar()
  return r
}

export async function removeAllocations(transactionId: string) {
  return saveAllocations(transactionId, [])
}

export async function previewBatchAllocation(ids: string[], pesos: AllocationWeight[]) {
  const { organizationId } = await getAuthContext()
  return preverLoteDeRateio(organizationId, ids, pesos)
}

export async function applyBatchAllocation(
  ids: string[],
  pesos: AllocationWeight[],
  templateId?: string | null,
) {
  const { organizationId } = await getAuthContext()
  const r = await aplicarLoteDeRateio(organizationId, ids, pesos, templateId)
  if ('success' in r) revalidar()
  return r
}
