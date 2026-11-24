'use server'

// Server actions da análise de fornecedores. Cascas: resolvem organização e papel,
// conferem o papel nas escritas e delegam a `lib/fornecedores.ts`.
// Leitura: qualquer papel. Mesa e agrupamentos: admin+ (decisão do Julio, 24/nov).

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { getAuthContext } from '@/lib/auth-context'
import { papelAtinge, recusaDePapel } from '@/lib/members-types'
import {
  apagarAgrupamento, lerAgrupamentos, lerMesa, lerSaidasPorFornecedor, salvarAgrupamento, salvarItemMesa, tirarDaMesa,
  type Periodo,
} from '@/lib/fornecedores'
import type { AgrupamentoInput, ItemMesaInput } from '@/lib/fornecedores-types'

const recusa = (papel: string, acao: string) => recusaDePapel(papel, 'admin', acao)
const DATA = /^\d{4}-\d{2}-\d{2}$/

/** Tudo o que a tela precisa de uma vez: as saídas do período, a mesa e se quem vê pode editá-la. */
export async function getAnaliseFornecedores(periodo: Periodo) {
  const { organizationId, papel } = await getAuthContext()
  if (!DATA.test(periodo.de) || !DATA.test(periodo.ate) || periodo.de > periodo.ate) {
    return { error: 'Período inválido.' as const }
  }
  const [lancamentos, mesa] = await Promise.all([
    lerSaidasPorFornecedor(db, organizationId, periodo),
    lerMesa(db, organizationId),
  ])
  return { lancamentos, mesa, podeEditar: papelAtinge(papel, 'admin') }
}

export async function saveItemMesa(input: ItemMesaInput) {
  const { organizationId, userId, papel } = await getAuthContext()
  const r0 = recusa(papel, 'alterar a mesa de negociação')
  if (r0) return { error: r0 }
  const r = await db.transaction((tx) => salvarItemMesa(tx, organizationId, userId, input))
  if (!('error' in r)) revalidatePath('/fornecedores')
  return r
}

export async function removeItemMesa(chave: string) {
  const { organizationId, userId, papel } = await getAuthContext()
  const r0 = recusa(papel, 'alterar a mesa de negociação')
  if (r0) return { error: r0 }
  const r = await db.transaction((tx) => tirarDaMesa(tx, organizationId, userId, chave))
  if (!('error' in r)) revalidatePath('/fornecedores')
  return r
}

export async function getAgrupamentos() {
  const { organizationId, papel } = await getAuthContext()
  return { agrupamentos: await lerAgrupamentos(db, organizationId), podeEditar: papelAtinge(papel, 'admin') }
}

export async function saveAgrupamento(input: AgrupamentoInput, id?: string) {
  const { organizationId, userId, papel } = await getAuthContext()
  const r0 = recusa(papel, 'alterar os agrupamentos de fornecedor')
  if (r0) return { error: r0 }
  const r = await db.transaction((tx) => salvarAgrupamento(tx, organizationId, userId, input, id))
  if (!('error' in r)) { revalidatePath('/fornecedores'); revalidatePath('/configuracoes/agrupamentos-de-fornecedor') }
  return r
}

export async function deleteAgrupamento(id: string) {
  const { organizationId, userId, papel } = await getAuthContext()
  const r0 = recusa(papel, 'alterar os agrupamentos de fornecedor')
  if (r0) return { error: r0 }
  const r = await db.transaction((tx) => apagarAgrupamento(tx, organizationId, userId, id))
  if (!('error' in r)) { revalidatePath('/fornecedores'); revalidatePath('/configuracoes/agrupamentos-de-fornecedor') }
  return r
}
