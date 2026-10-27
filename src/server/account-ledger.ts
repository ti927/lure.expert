'use server'

// Conferência de saldo — cascas sobre `lib/account-ledger.ts`, que concentra a
// regra (e é o que o script de verificação exercita).

import { revalidatePath } from 'next/cache'
import { getAuthContext } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/server'
import { recusaDePapel } from '@/lib/members-types'
import {
  lerExtratoDaConta, descreverConta, gravarSaldoInicial, apagarSaldoInicial,
  contarLancamentosSemConta, lerFaturasDaConta, type ExtratoParams, type ContaDoExtrato,
} from '@/lib/account-ledger'

export interface ContaNaTela {
  accountId: string
  nome: string | null
  tipo: string | null
  numero: string | null
  logoUrl: string | null
  badge: string | null
  conexao: string | null
  /** Conta manual (cadastro próprio) — não vem de conexão bancária. */
  manual: boolean
}

/** O cabeçalho da conta: logo (o enviado pelo usuário vence o do banco), badge, conexão. */
async function contaNaTela(conta: ContaDoExtrato): Promise<ContaNaTela> {
  const meta = conta.metadata ?? {}
  let logoUrl = typeof meta.institutionImageUrl === 'string' ? meta.institutionImageUrl : null
  if (typeof meta.customLogoPath === 'string') {
    const { data } = await createClient().storage.from('documents').createSignedUrl(meta.customLogoPath, 3600)
    if (data?.signedUrl) logoUrl = data.signedUrl
  }
  return {
    accountId: conta.accountId, nome: conta.nome, tipo: conta.tipo, numero: conta.numero,
    logoUrl,
    badge: (meta.customBadge as { text?: string } | undefined)?.text || null,
    conexao: (typeof meta.customLabel === 'string' && meta.customLabel.trim())
      || (typeof meta.institutionName === 'string' ? meta.institutionName : null),
    manual: meta.manual === true,
  }
}

export async function getContaParaConferencia(accountId: string): Promise<ContaNaTela | null> {
  const { organizationId } = await getAuthContext()
  const conta = await descreverConta(organizationId, accountId)
  return conta ? contaNaTela(conta) : null
}

export async function getExtratoDaConta(accountId: string, params: ExtratoParams) {
  const { organizationId } = await getAuthContext()
  const conta = await descreverConta(organizationId, accountId)
  if (!conta) return null

  const [extrato, semConta, tela] = await Promise.all([
    lerExtratoDaConta(organizationId, accountId, params),
    contarLancamentosSemConta(organizationId),
    contaNaTela(conta),
  ])
  return { conta: tela, extrato, semConta }
}

export async function getFaturasDaConta(accountId: string) {
  const { organizationId } = await getAuthContext()
  return lerFaturasDaConta(organizationId, accountId)
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
