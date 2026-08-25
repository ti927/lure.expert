// O miolo da gestão de membros — listar, convidar, aceitar, alterar, remover.
//
// Fora de `'use server'` pelo motivo de sempre: cada função recebe o executor
// e é exercitável direto contra o banco num script (`verify-members.ts`), sem
// sessão HTTP. `server/members.ts` é a casca que autentica e delega.
//
// `auth.users` não está no schema Drizzle (é do Supabase, não nosso), então a
// leitura de e-mail entra por SQL cru. O `LEFT JOIN` é deliberado: membership
// cujo usuário não resolve (convite recém-criado num ambiente de teste, por
// exemplo) ainda aparece na lista, com o e-mail vindo de `invited_email`.

import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { memberships, agentEvents } from '@/db/schema'
import { recusaDeGestao, type Papel } from '@/lib/members-types'

type Exec = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

export interface MembroListado {
  membershipId: string
  userId: string
  papel: string
  email: string
  aceitoEm: string | null
  criadoEm: string
  convidadoPor: string | null
}

export interface ConvitePendente {
  membershipId: string
  organizationId: string
  organizationName: string
  papel: string
  convidadoPor: string | null
  criadoEm: string
}

/** Membros e convites pendentes da organização — ativos primeiro, mais antigos primeiro. */
export async function listarMembros(organizationId: string, exec: Exec = db): Promise<MembroListado[]> {
  const linhas = await exec.execute<{
    id: string
    user_id: string
    role: string
    invited_email: string | null
    accepted_at: string | null
    created_at: string
    user_email: string | null
    invited_by_email: string | null
  }>(sql`
    SELECT m.id, m.user_id, m.role, m.invited_email, m.accepted_at, m.created_at,
           u.email  AS user_email,
           iu.email AS invited_by_email
    FROM memberships m
    LEFT JOIN auth.users u  ON u.id  = m.user_id
    LEFT JOIN auth.users iu ON iu.id = m.invited_by_user_id
    WHERE m.organization_id = ${organizationId}
    ORDER BY (m.accepted_at IS NULL) ASC, m.created_at ASC, m.id ASC
  `)

  return linhas.map((l) => ({
    membershipId: l.id,
    userId: l.user_id,
    papel: l.role,
    email: l.user_email ?? l.invited_email ?? '(e-mail não disponível)',
    aceitoEm: l.accepted_at,
    criadoEm: l.created_at,
    convidadoPor: l.invited_by_email,
  }))
}

/** O papel do usuário na organização, exigindo membership ACEITA. `null` sem vínculo. */
export async function papelNaOrganizacao(
  userId: string,
  organizationId: string,
  exec: Exec = db,
): Promise<string | null> {
  const [m] = await exec
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(
      eq(memberships.userId, userId),
      eq(memberships.organizationId, organizationId),
      sql`${memberships.acceptedAt} IS NOT NULL`,
    ))
    .limit(1)
  return m?.role ?? null
}

/** Usuário do Supabase Auth pelo e-mail (case-insensitive). `null` se não existe conta. */
export async function usuarioPorEmail(
  email: string,
  exec: Exec = db,
): Promise<{ id: string; email: string } | null> {
  const [u] = await exec.execute<{ id: string; email: string }>(sql`
    SELECT id, email FROM auth.users WHERE lower(email) = lower(${email}) LIMIT 1
  `)
  return u ?? null
}

/**
 * Já existe vínculo (ativo ou pendente) desta pessoa com a organização?
 * Confere pelos DOIS caminhos — `user_id` e `invited_email` — porque um
 * convite antigo pode ter sido criado antes de a conta existir.
 */
export async function vinculoExistente(
  organizationId: string,
  pessoa: { userId?: string | null; email: string },
  exec: Exec = db,
): Promise<{ membershipId: string; pendente: boolean } | null> {
  const [v] = await exec.execute<{ id: string; accepted_at: string | null }>(sql`
    SELECT id, accepted_at FROM memberships
    WHERE organization_id = ${organizationId}
      AND (
        ${pessoa.userId ?? null}::uuid IS NOT DISTINCT FROM user_id
        OR lower(invited_email) = lower(${pessoa.email})
      )
    LIMIT 1
  `)
  return v ? { membershipId: v.id, pendente: v.accepted_at === null } : null
}

/** Convite pendente = membership com `accepted_at` nulo. O aceite é o UPDATE que o preenche. */
export async function criarConvitePendente(
  args: {
    organizationId: string
    userId: string
    email: string
    papel: Papel
    convidadoPorUserId: string
  },
  exec: Exec = db,
): Promise<string> {
  const [linha] = await exec
    .insert(memberships)
    .values({
      userId: args.userId,
      organizationId: args.organizationId,
      role: args.papel,
      invitedEmail: args.email,
      invitedByUserId: args.convidadoPorUserId,
      acceptedAt: null,
    })
    .returning({ id: memberships.id })
  return linha.id
}

/** Convites pendentes DO usuário — o que ele vê no onboarding e em /configuracoes. */
export async function convitesPendentesDoUsuario(
  userId: string,
  exec: Exec = db,
): Promise<ConvitePendente[]> {
  const linhas = await exec.execute<{
    id: string
    organization_id: string
    organization_name: string
    role: string
    invited_by_email: string | null
    created_at: string
  }>(sql`
    SELECT m.id, m.organization_id, o.name AS organization_name, m.role,
           iu.email AS invited_by_email, m.created_at
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    LEFT JOIN auth.users iu ON iu.id = m.invited_by_user_id
    WHERE m.user_id = ${userId} AND m.accepted_at IS NULL
    ORDER BY m.created_at ASC, m.id ASC
  `)
  return linhas.map((l) => ({
    membershipId: l.id,
    organizationId: l.organization_id,
    organizationName: l.organization_name,
    papel: l.role,
    convidadoPor: l.invited_by_email,
    criadoEm: l.created_at,
  }))
}

/**
 * Aceita UM convite do próprio usuário. O `WHERE` inteiro é a autorização:
 * só a linha dele, só se ainda pendente — id de convite alheio não atualiza
 * nada e volta `null`, sem virar oráculo de ids.
 */
export async function aceitarConvite(
  membershipId: string,
  userId: string,
  exec: Exec = db,
): Promise<{ organizationId: string } | null> {
  const [linha] = await exec
    .update(memberships)
    .set({ acceptedAt: new Date() })
    .where(and(
      eq(memberships.id, membershipId),
      eq(memberships.userId, userId),
      isNull(memberships.acceptedAt),
    ))
    .returning({ organizationId: memberships.organizationId })
  return linha ?? null
}

/** Recusa (apaga) um convite pendente do próprio usuário. Mesma regra de silêncio do aceite. */
export async function recusarConvite(
  membershipId: string,
  userId: string,
  exec: Exec = db,
): Promise<{ organizationId: string } | null> {
  const [linha] = await exec
    .delete(memberships)
    .where(and(
      eq(memberships.id, membershipId),
      eq(memberships.userId, userId),
      isNull(memberships.acceptedAt),
    ))
    .returning({ organizationId: memberships.organizationId })
  return linha ?? null
}

/**
 * Aceita TODOS os convites pendentes do usuário — o caso do convidado novo,
 * que acabou de definir a senha vindo do e-mail: cada convite pendente dele
 * foi criado por um administrador que ele acabou de comprovar (clicou o link
 * daquele e-mail), então não há o que perguntar um a um.
 */
export async function aceitarTodosOsConvites(
  userId: string,
  exec: Exec = db,
): Promise<{ membershipId: string; organizationId: string }[]> {
  return exec
    .update(memberships)
    .set({ acceptedAt: new Date() })
    .where(and(eq(memberships.userId, userId), isNull(memberships.acceptedAt)))
    .returning({ membershipId: memberships.id, organizationId: memberships.organizationId })
}

/**
 * Decide se a mudança/remoção é permitida, INCLUINDO a regra do último owner —
 * que é de contagem, não de matriz: rebaixar ou remover o único proprietário
 * ativo deixaria a organização sem ninguém que possa geri-la.
 *
 * `alvo` é a linha como está no banco; `novoPapel` ausente significa remoção.
 */
export async function recusaDeMudanca(
  args: {
    organizationId: string
    papelDoAtor: string
    alvo: { membershipId: string; papel: string; aceito: boolean }
    novoPapel?: Papel
  },
  exec: Exec = db,
): Promise<string | null> {
  const recusa = recusaDeGestao({
    papelDoAtor: args.papelDoAtor,
    papelDoAlvo: args.alvo.papel,
    novoPapel: args.novoPapel,
  })
  if (recusa) return recusa

  const viraOutraCoisa = args.novoPapel === undefined || args.novoPapel !== 'owner'
  if (args.alvo.papel === 'owner' && args.alvo.aceito && viraOutraCoisa) {
    const [{ n }] = await exec.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM memberships
      WHERE organization_id = ${args.organizationId}
        AND role = 'owner' AND accepted_at IS NOT NULL
        AND id <> ${args.alvo.membershipId}
    `)
    if (Number(n) === 0) {
      return 'Este é o único proprietário ativo — promova outra pessoa a proprietário antes.'
    }
  }
  return null
}

/**
 * Registro em `agent_events` (princípio 9 do CLAUDE.md: operação importante é
 * logada). Sem tokens nem custo — evento de gestão, não de IA.
 */
export async function registrarEventoDeMembro(
  args: {
    organizationId: string
    tipo: 'member_invited' | 'member_role_changed' | 'member_removed' | 'invite_accepted' | 'invite_declined'
    membershipId: string
    payload: Record<string, unknown>
  },
  exec: Exec = db,
): Promise<void> {
  await exec.insert(agentEvents).values({
    organizationId: args.organizationId,
    type: args.tipo,
    entityType: 'membership',
    entityId: args.membershipId,
    payload: args.payload,
    success: true,
  })
}
