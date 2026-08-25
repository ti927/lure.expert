'use server'

// A casca das actions de membros: autentica, resolve o papel do ator e delega
// ao miolo em `lib/members.ts`. Regra de negócio NÃO mora aqui.
//
// Toda recusa volta como `{ erro }` descritivo, nunca exceção — o padrão de
// `resolverAcessoIa`. A exceção honesta é `redirect()`, que o Next trata.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthContext } from '@/lib/auth-context'
import { db } from '@/db'
import { memberships } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  listarMembros, papelNaOrganizacao, usuarioPorEmail, vinculoExistente,
  criarConvitePendente, convitesPendentesDoUsuario, aceitarConvite,
  recusarConvite, aceitarTodosOsConvites, recusaDeMudanca,
  registrarEventoDeMembro, type MembroListado, type ConvitePendente,
} from '@/lib/members'
import { conviteSchema, recusaDeGestao, PAPEIS, type Papel } from '@/lib/members-types'

export type { MembroListado, ConvitePendente }

const idSchema = z.string().uuid()

async function contextoComPapel() {
  const { userId, organizationId } = await getAuthContext()
  const papel = await papelNaOrganizacao(userId, organizationId)
  // getAuthContext já garantiu membership aceita; papel nulo aqui seria uma
  // corrida com uma remoção — tratar como sessão sem organização.
  if (!papel) redirect('/onboarding')
  return { userId, organizationId, papel }
}

/** Sessão sem exigir organização — o onboarding e o pós-convite vivem antes dela. */
async function usuarioDaSessao() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return user
}

function origemDaRequisicao(): string {
  const h = headers()
  const origin = h.get('origin')
  if (origin) return origin
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return host ? `${proto}://${host}` : 'https://lure-expert.vercel.app'
}

// ─── Leitura ────────────────────────────────────────────────────────────────

export interface MembrosDaTela {
  membros: MembroListado[]
  meuPapel: string
  meuUserId: string
}

export async function getMembros(): Promise<MembrosDaTela> {
  const ctx = await contextoComPapel()
  const membros = await listarMembros(ctx.organizationId)
  return { membros, meuPapel: ctx.papel, meuUserId: ctx.userId }
}

export async function getMeusConvites(): Promise<ConvitePendente[]> {
  const user = await usuarioDaSessao()
  return convitesPendentesDoUsuario(user.id)
}

// ─── Convite ────────────────────────────────────────────────────────────────

export interface ResultadoConvite {
  erro?: string
  /** true = a pessoa já tinha conta; o convite aparece para ela dentro do app. */
  usuarioJaExistia?: boolean
}

export async function convidarMembro(input: { email: string; papel: string }): Promise<ResultadoConvite> {
  const ctx = await contextoComPapel()

  const parsed = conviteSchema.safeParse(input)
  if (!parsed.success) return { erro: parsed.error.issues[0].message }
  const { email, papel } = parsed.data

  const recusa = recusaDeGestao({ papelDoAtor: ctx.papel, novoPapel: papel })
  if (recusa) return { erro: recusa }

  const existente = await usuarioPorEmail(email)

  const vinculo = await vinculoExistente(ctx.organizationId, { userId: existente?.id, email })
  if (vinculo) {
    return {
      erro: vinculo.pendente
        ? 'Esta pessoa já tem um convite pendente nesta organização.'
        : 'Esta pessoa já é membro desta organização.',
    }
  }

  let convidadoUserId: string
  let usuarioJaExistia = false

  if (existente) {
    // Conta já existe: o Supabase recusa reconvidar e-mail cadastrado, e não é
    // preciso — o convite pendente aparece para a pessoa dentro do app.
    convidadoUserId = existente.id
    usuarioJaExistia = true
  } else {
    const admin = supabaseAdmin()
    if (!admin) {
      return {
        erro: 'SUPABASE_SERVICE_ROLE_KEY não está configurada — sem ela não é possível ' +
              'criar a conta da pessoa convidada. Configure a variável e tente de novo.',
      }
    }
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origemDaRequisicao()}/auth/confirm?next=/convite/definir-senha`,
    })
    if (error || !data.user) {
      return { erro: `O Supabase recusou o envio do convite: ${error?.message ?? 'resposta vazia'}` }
    }
    convidadoUserId = data.user.id
  }

  let membershipId: string
  try {
    membershipId = await criarConvitePendente({
      organizationId: ctx.organizationId,
      userId: convidadoUserId,
      email,
      papel,
      convidadoPorUserId: ctx.userId,
    })
  } catch (err) {
    // Corrida entre a checagem e o INSERT — o unique (user_id, organization_id)
    // decide. Drizzle 0.45 embrulha o erro do driver e o código do Postgres
    // mora em `cause` (o formato antigo, direto em `code`, fica coberto também).
    const e = err as { code?: string; cause?: { code?: string } }
    if ((e.code ?? e.cause?.code) === '23505') {
      return { erro: 'Esta pessoa já foi convidada para esta organização.' }
    }
    throw err
  }

  await registrarEventoDeMembro({
    organizationId: ctx.organizationId,
    tipo: 'member_invited',
    membershipId,
    payload: { email, papel, convidadoPor: ctx.userId, usuarioJaExistia },
  })

  revalidatePath('/configuracoes/membros')
  return { usuarioJaExistia }
}

// ─── Alterar papel e remover ────────────────────────────────────────────────

async function carregarAlvo(membershipId: string, organizationId: string) {
  // O filtro por organização É a multi-tenancy: id de outra organização não
  // encontra nada, e a resposta é a mesma de id inexistente.
  const [alvo] = await db
    .select({
      id: memberships.id,
      userId: memberships.userId,
      role: memberships.role,
      invitedEmail: memberships.invitedEmail,
      acceptedAt: memberships.acceptedAt,
    })
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
    .limit(1)
  return alvo ?? null
}

export async function alterarPapel(membershipId: string, novoPapel: string): Promise<{ erro?: string }> {
  const ctx = await contextoComPapel()

  if (!idSchema.safeParse(membershipId).success) return { erro: 'Membro não encontrado.' }
  if (!(PAPEIS as readonly string[]).includes(novoPapel)) return { erro: 'Papel inválido.' }
  const papel = novoPapel as Papel

  const alvo = await carregarAlvo(membershipId, ctx.organizationId)
  if (!alvo) return { erro: 'Membro não encontrado.' }
  if (alvo.userId === ctx.userId) {
    return { erro: 'Você não altera o próprio papel — peça a outro administrador ou proprietário.' }
  }
  if (alvo.role === papel) return {}

  const recusa = await recusaDeMudanca({
    organizationId: ctx.organizationId,
    papelDoAtor: ctx.papel,
    alvo: { membershipId: alvo.id, papel: alvo.role, aceito: alvo.acceptedAt !== null },
    novoPapel: papel,
  })
  if (recusa) return { erro: recusa }

  await db.update(memberships).set({ role: papel }).where(eq(memberships.id, alvo.id))

  await registrarEventoDeMembro({
    organizationId: ctx.organizationId,
    tipo: 'member_role_changed',
    membershipId: alvo.id,
    payload: { de: alvo.role, para: papel, por: ctx.userId },
  })

  revalidatePath('/configuracoes/membros')
  return {}
}

export async function removerMembro(membershipId: string): Promise<{ erro?: string }> {
  const ctx = await contextoComPapel()

  if (!idSchema.safeParse(membershipId).success) return { erro: 'Membro não encontrado.' }

  const alvo = await carregarAlvo(membershipId, ctx.organizationId)
  if (!alvo) return { erro: 'Membro não encontrado.' }
  if (alvo.userId === ctx.userId) {
    return { erro: 'Você não remove a si mesmo da organização.' }
  }

  const recusa = await recusaDeMudanca({
    organizationId: ctx.organizationId,
    papelDoAtor: ctx.papel,
    alvo: { membershipId: alvo.id, papel: alvo.role, aceito: alvo.acceptedAt !== null },
  })
  if (recusa) return { erro: recusa }

  await db.delete(memberships).where(eq(memberships.id, alvo.id))

  await registrarEventoDeMembro({
    organizationId: ctx.organizationId,
    tipo: 'member_removed',
    membershipId: alvo.id,
    payload: {
      papel: alvo.role,
      email: alvo.invitedEmail,
      eraConvitePendente: alvo.acceptedAt === null,
      por: ctx.userId,
    },
  })

  revalidatePath('/configuracoes/membros')
  return {}
}

// ─── Aceite e recusa pelo convidado ─────────────────────────────────────────

export async function aceitarConviteAction(membershipId: string): Promise<{ erro?: string }> {
  const user = await usuarioDaSessao()
  if (!idSchema.safeParse(membershipId).success) return { erro: 'Convite não encontrado.' }

  const aceito = await aceitarConvite(membershipId, user.id)
  if (!aceito) return { erro: 'Convite não encontrado.' }

  await registrarEventoDeMembro({
    organizationId: aceito.organizationId,
    tipo: 'invite_accepted',
    membershipId,
    payload: { userId: user.id },
  })

  revalidatePath('/configuracoes')
  redirect('/dashboard')
}

export async function recusarConviteAction(membershipId: string): Promise<{ erro?: string }> {
  const user = await usuarioDaSessao()
  if (!idSchema.safeParse(membershipId).success) return { erro: 'Convite não encontrado.' }

  const recusado = await recusarConvite(membershipId, user.id)
  if (!recusado) return { erro: 'Convite não encontrado.' }

  await registrarEventoDeMembro({
    organizationId: recusado.organizationId,
    tipo: 'invite_declined',
    membershipId,
    payload: { userId: user.id },
  })

  revalidatePath('/onboarding')
  revalidatePath('/configuracoes')
  return {}
}

/**
 * O passo final do convidado novo: acabou de definir a senha vindo do link do
 * e-mail, então todo convite pendente dele é aceito de uma vez.
 */
export async function concluirConvite(): Promise<{ empresas: number }> {
  const user = await usuarioDaSessao()
  const aceitos = await aceitarTodosOsConvites(user.id)

  for (const { membershipId, organizationId } of aceitos) {
    await registrarEventoDeMembro({
      organizationId,
      tipo: 'invite_accepted',
      membershipId,
      payload: { userId: user.id, via: 'definir-senha' },
    })
  }

  return { empresas: aceitos.length }
}
