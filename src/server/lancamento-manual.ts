'use server'

// Lançamento manual — cascas sobre `lib/lancamento-manual.ts`. A autoria (quem,
// quando, IP, navegador) é lida AQUI, no servidor; do cliente vem só o
// identificador do navegador.

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getAuthContext } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/server'
import { recusaDePapel } from '@/lib/members-types'
import {
  criarLancamentoManual, listarManuaisApagados, restaurarLancamentoManual,
  type LancamentoManualInput,
} from '@/lib/lancamento-manual'

async function email(): Promise<string | null> {
  const { data: { user } } = await createClient().auth.getUser()
  return user?.email ?? null
}

/** O IP de quem fez: o primeiro de `x-forwarded-for` (a Vercel o preenche). */
function ipDaRequisicao(): string | null {
  const h = headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null
}

function revalidarConta(accountId: string) {
  revalidatePath(`/contas/${encodeURIComponent(accountId)}`, 'layout')
  revalidatePath('/transacoes')
}

export async function lancarManual(
  accountId: string, entrada: LancamentoManualInput, dispositivoId: string | null,
): Promise<{ error: string } | { ok: true; id: string }> {
  const { organizationId, userId, papel } = await getAuthContext()
  const recusa = recusaDePapel(papel, 'member', 'criar lançamentos')
  if (recusa) return { error: recusa }

  const r = await criarLancamentoManual(organizationId, accountId, entrada, {
    userId,
    email: await email(),
    userAgent: headers().get('user-agent'),
    ip: ipDaRequisicao(),
    // Do cliente, e só como pista: curto e sem nada além de letras e números.
    dispositivoId: dispositivoId && /^[A-Za-z0-9-]{4,64}$/.test(dispositivoId) ? dispositivoId : null,
  })
  if ('ok' in r) revalidarConta(accountId)
  return r
}

export async function getManuaisApagados(accountId: string) {
  const { organizationId } = await getAuthContext()
  return listarManuaisApagados(organizationId, accountId)
}

export async function restaurarManual(
  accountId: string, eventoId: string,
): Promise<{ error: string } | { ok: true; id: string }> {
  const { organizationId, userId, papel } = await getAuthContext()
  // Restaurar é recriar o que foi lançado — o mesmo papel de lançar.
  const recusa = recusaDePapel(papel, 'member', 'restaurar lançamentos')
  if (recusa) return { error: recusa }
  const r = await restaurarLancamentoManual(organizationId, eventoId, { userId, email: await email() })
  if ('ok' in r) revalidarConta(accountId)
  return r
}
