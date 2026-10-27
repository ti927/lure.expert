'use server'

// Conferência de saldo — cascas sobre `lib/account-ledger.ts`, que concentra a
// regra (e é o que o script de verificação exercita).

import { revalidatePath } from 'next/cache'
import { getAuthContext } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/server'
import { recusaDePapel } from '@/lib/members-types'
import {
  lerExtratoDaConta, descreverConta, gravarSaldoInicial, apagarSaldoInicial,
  contarLancamentosSemConta, type ExtratoParams,
} from '@/lib/account-ledger'

export async function getExtratoDaConta(accountId: string, params: ExtratoParams) {
  const { organizationId } = await getAuthContext()
  const conta = await descreverConta(organizationId, accountId)
  if (!conta) return null

  const [extrato, semConta] = await Promise.all([
    lerExtratoDaConta(organizationId, accountId, params),
    contarLancamentosSemConta(organizationId),
  ])

  // Logo da conta: o enviado pelo usuário (assinado) vence o automático do banco.
  const meta = conta.metadata ?? {}
  let logoUrl = typeof meta.institutionImageUrl === 'string' ? meta.institutionImageUrl : null
  if (typeof meta.customLogoPath === 'string') {
    const { data } = await createClient().storage.from('documents').createSignedUrl(meta.customLogoPath, 3600)
    if (data?.signedUrl) logoUrl = data.signedUrl
  }
  const badge = (meta.customBadge as { text?: string } | undefined)?.text || null
  const conexao = (typeof meta.customLabel === 'string' && meta.customLabel.trim())
    || (typeof meta.institutionName === 'string' ? meta.institutionName : null)

  return {
    conta: {
      accountId: conta.accountId, nome: conta.nome, tipo: conta.tipo, numero: conta.numero,
      logoUrl, badge, conexao,
    },
    extrato,
    semConta,
  }
}

/** Saldo inicial: escrita comum (member+), como classificar — não destrói nada. */
export async function salvarSaldoInicial(
  accountId: string,
  entrada: { data: string; valor: number; nota?: string | null },
): Promise<{ error: string } | { ok: true }> {
  const { organizationId, userId, papel } = await getAuthContext()
  const recusa = recusaDePapel(papel, 'member', 'informar o saldo inicial')
  if (recusa) return { error: recusa }
  if (!(await descreverConta(organizationId, accountId))) return { error: 'Conta não encontrada.' }

  const r = await gravarSaldoInicial(organizationId, accountId, entrada, userId)
  if ('ok' in r) revalidatePath(`/contas/${encodeURIComponent(accountId)}`)
  return r
}

export async function removerSaldoInicial(accountId: string): Promise<{ error: string } | { ok: true }> {
  const { organizationId, papel } = await getAuthContext()
  const recusa = recusaDePapel(papel, 'member', 'remover o saldo inicial')
  if (recusa) return { error: recusa }
  await apagarSaldoInicial(organizationId, accountId)
  revalidatePath(`/contas/${encodeURIComponent(accountId)}`)
  return { ok: true }
}
