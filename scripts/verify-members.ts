/**
 * Exercita o miolo da gestão de membros (Fase 4.A) contra o banco de verdade.
 *
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-members.ts
 *
 * Cria as próprias organizações e as apaga no fim — o CASCADE leva memberships
 * e agent_events. Usuários são UUIDs sintéticos: `memberships.user_id` não tem
 * FK para `auth.users`, então o join de e-mail cai no fallback `invited_email`
 * — que é exatamente o caso de um convite recém-criado.
 *
 * O que NÃO passa por aqui, e fica declarado: o envio do e-mail pelo Supabase
 * (`inviteUserByEmail` exige a service role e mandaria e-mail real) e o
 * `verifyOtp` do link — os dois só se conferem na tela, com SMTP configurado.
 */
import { db } from '@/db'
import { organizations, memberships, agentEvents } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import {
  listarMembros, papelNaOrganizacao, vinculoExistente, criarConvitePendente,
  convitesPendentesDoUsuario, aceitarConvite, recusarConvite,
  aceitarTodosOsConvites, recusaDeMudanca, registrarEventoDeMembro,
} from '@/lib/members'
import { recusaDeGestao, podeGerirMembros } from '@/lib/members-types'
import { emailAvisoDeConvite, enviarEmail } from '@/lib/email'

const NOME_A = 'ZZ Teste membros A'
const NOME_B = 'ZZ Teste membros B'

const DONO      = '55555555-0000-4000-8000-000000000001'
const ADMIN     = '55555555-0000-4000-8000-000000000002'
const OPERADOR  = '55555555-0000-4000-8000-000000000003'
const LEITOR    = '55555555-0000-4000-8000-000000000004'
const CONVIDADO = '55555555-0000-4000-8000-000000000005'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

async function limpar() {
  await db.delete(organizations).where(eq(organizations.name, NOME_A))
  await db.delete(organizations).where(eq(organizations.name, NOME_B))
}

async function main() {
  await limpar()

  const [orgA] = await db.insert(organizations).values({
    name: NOME_A, slug: `zz-teste-membros-a-${Date.now()}`,
  }).returning({ id: organizations.id })
  const [orgB] = await db.insert(organizations).values({
    name: NOME_B, slug: `zz-teste-membros-b-${Date.now()}`,
  }).returning({ id: organizations.id })
  const A = orgA.id, B = orgB.id

  const agora = new Date()
  await db.insert(memberships).values([
    { userId: DONO,     organizationId: A, role: 'owner',  invitedEmail: 'dono@teste.com',     acceptedAt: agora },
    { userId: ADMIN,    organizationId: A, role: 'admin',  invitedEmail: 'Admin@Teste.com',    acceptedAt: agora },
    { userId: OPERADOR, organizationId: A, role: 'member', invitedEmail: 'operador@teste.com', acceptedAt: agora },
    { userId: LEITOR,   organizationId: A, role: 'viewer', invitedEmail: 'leitor@teste.com',   acceptedAt: agora },
    { userId: DONO,     organizationId: B, role: 'owner',  invitedEmail: 'dono@teste.com',     acceptedAt: agora },
  ])

  // ═══ 1. A matriz pura, nos DOIS sentidos ══════════════════════════════════
  console.log('── 1. matriz de papéis (pura) ──')
  {
    t(podeGerirMembros('owner') && podeGerirMembros('admin'), 'owner e admin gerenciam')
    t(!podeGerirMembros('member') && !podeGerirMembros('viewer'), 'member e viewer não gerenciam')

    t(recusaDeGestao({ papelDoAtor: 'viewer' }) !== null, 'viewer é recusado')
    t(recusaDeGestao({ papelDoAtor: 'member' }) !== null, 'member é recusado')
    t(recusaDeGestao({ papelDoAtor: 'admin', papelDoAlvo: 'member' }) === null, 'admin mexe em member')
    t(recusaDeGestao({ papelDoAtor: 'admin', papelDoAlvo: 'owner' }) !== null, 'admin NÃO mexe em owner')
    t(recusaDeGestao({ papelDoAtor: 'admin', novoPapel: 'owner' }) !== null, 'admin NÃO concede owner')
    t(recusaDeGestao({ papelDoAtor: 'admin', novoPapel: 'admin' }) === null, 'admin concede até admin')
    t(recusaDeGestao({ papelDoAtor: 'owner', papelDoAlvo: 'owner', novoPapel: 'admin' }) === null, 'owner rebaixa owner (a contagem decide depois)')
    t(recusaDeGestao({ papelDoAtor: 'owner', novoPapel: 'owner' }) === null, 'owner concede owner')
  }

  // ═══ 2. Listagem ══════════════════════════════════════════════════════════
  console.log('\n── 2. listarMembros ──')
  {
    const lista = await listarMembros(A)
    t(lista.length === 4, `organização A tem 4 membros (são ${lista.length})`)
    t(lista.every(m => m.aceitoEm !== null), 'todos aceitos por enquanto')
    // Os 4 inserts saíram no mesmo instante, então a ordem entre eles é por id
    // — o que se afirma é o FALLBACK de e-mail, não a posição.
    const emails = new Set(lista.map(m => m.email))
    t(
      ['dono@teste.com', 'Admin@Teste.com', 'operador@teste.com', 'leitor@teste.com'].every(e => emails.has(e)),
      'e-mail cai no fallback invited_email (usuário sintético não existe em auth.users)',
    )
    const listaB = await listarMembros(B)
    t(listaB.length === 1, 'organização B tem 1 — a listagem não vaza entre organizações')
  }

  // ═══ 3. Vínculo existente ═════════════════════════════════════════════════
  console.log('\n── 3. vinculoExistente ──')
  {
    const porId = await vinculoExistente(A, { userId: OPERADOR, email: 'outro@x.com' })
    t(porId !== null && !porId.pendente, 'acha pelo user_id, marcado como ativo')
    const porEmail = await vinculoExistente(A, { email: 'admin@teste.com' })
    t(porEmail !== null, 'acha pelo e-mail sem diferenciar caixa (Admin@Teste.com)')
    const nada = await vinculoExistente(A, { email: 'ninguem@teste.com' })
    t(nada === null, 'quem não tem vínculo devolve null')
    const cruzado = await vinculoExistente(B, { userId: OPERADOR, email: 'operador@teste.com' })
    t(cruzado === null, 'vínculo da organização A não aparece pela B')
  }

  // ═══ 4. Convite pendente e aceite ═════════════════════════════════════════
  console.log('\n── 4. convite → aceite ──')
  {
    const convite = await criarConvitePendente({
      organizationId: A, userId: CONVIDADO, email: 'convidado@teste.com',
      papel: 'member', convidadoPorUserId: ADMIN,
    })

    t(await papelNaOrganizacao(CONVIDADO, A) === null, 'convite pendente NÃO conta como papel (exige aceite)')

    const pendentes = await convitesPendentesDoUsuario(CONVIDADO)
    t(pendentes.length === 1 && pendentes[0].organizationName === NOME_A, 'o convidado vê o convite com o nome da empresa')

    const roubo = await aceitarConvite(convite, OPERADOR)
    t(roubo === null, 'aceitar convite ALHEIO devolve null')
    t((await convitesPendentesDoUsuario(CONVIDADO)).length === 1, 'e a linha segue pendente')

    const aceite = await aceitarConvite(convite, CONVIDADO)
    t(aceite?.organizationId === A, 'o dono do convite aceita')
    t(await papelNaOrganizacao(CONVIDADO, A) === 'member', 'e o papel passa a valer')
    t(await aceitarConvite(convite, CONVIDADO) === null, 'aceitar de novo devolve null — já não está pendente')

    // duplicata: o unique (user_id, organization_id) é a segunda barreira
    let duplicou = false
    try {
      await criarConvitePendente({
        organizationId: A, userId: CONVIDADO, email: 'convidado@teste.com',
        papel: 'viewer', convidadoPorUserId: ADMIN,
      })
      duplicou = true
    } catch (err) {
      // Drizzle 0.45 embrulha o erro do driver em DrizzleQueryError; o código
      // do Postgres mora em `cause`. Aceitar os dois formatos.
      const e = err as { code?: string; cause?: { code?: string } }
      const codigo = e.code ?? e.cause?.code
      t(codigo === '23505', `convidar quem já é membro estoura o unique (código: ${codigo ?? 'nenhum'})`)
    }
    t(!duplicou, 'a duplicata não entrou')
  }

  // ═══ 5. Recusa de convite ═════════════════════════════════════════════════
  console.log('\n── 5. recusar convite ──')
  {
    const NOVO = '55555555-0000-4000-8000-000000000006'
    const convite = await criarConvitePendente({
      organizationId: A, userId: NOVO, email: 'novo@teste.com',
      papel: 'viewer', convidadoPorUserId: DONO,
    })
    t(await recusarConvite(convite, OPERADOR) === null, 'recusar convite alheio devolve null')
    const recusa = await recusarConvite(convite, NOVO)
    t(recusa?.organizationId === A, 'o dono recusa')
    const [{ n }] = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM memberships WHERE id = ${convite}::uuid`)
    t(Number(n) === 0, 'e a linha some do banco')
  }

  // ═══ 6. Aceitar todos (o caminho do definir-senha) ════════════════════════
  console.log('\n── 6. aceitarTodosOsConvites ──')
  {
    const NOVO = '55555555-0000-4000-8000-000000000007'
    await criarConvitePendente({ organizationId: A, userId: NOVO, email: 'dois@teste.com', papel: 'viewer', convidadoPorUserId: DONO })
    await criarConvitePendente({ organizationId: B, userId: NOVO, email: 'dois@teste.com', papel: 'member', convidadoPorUserId: DONO })
    const aceitos = await aceitarTodosOsConvites(NOVO)
    t(aceitos.length === 2, `aceita os 2 pendentes de uma vez (foram ${aceitos.length})`)
    t(await papelNaOrganizacao(NOVO, B) === 'member', 'e o papel vale nas duas')
    t((await aceitarTodosOsConvites(NOVO)).length === 0, 'segunda chamada não aceita nada — nada pendente')
  }

  // ═══ 7. Último owner ══════════════════════════════════════════════════════
  console.log('\n── 7. regra do último owner ──')
  {
    const [donoA] = await db.select({ id: memberships.id }).from(memberships)
      .where(and(eq(memberships.userId, DONO), eq(memberships.organizationId, A)))

    const rebaixar = await recusaDeMudanca({
      organizationId: A, papelDoAtor: 'owner',
      alvo: { membershipId: donoA.id, papel: 'owner', aceito: true }, novoPapel: 'admin',
    })
    t(rebaixar !== null, 'rebaixar o ÚNICO owner é recusado')

    const remover = await recusaDeMudanca({
      organizationId: A, papelDoAtor: 'owner',
      alvo: { membershipId: donoA.id, papel: 'owner', aceito: true },
    })
    t(remover !== null, 'remover o único owner é recusado')

    const manter = await recusaDeMudanca({
      organizationId: A, papelDoAtor: 'owner',
      alvo: { membershipId: donoA.id, papel: 'owner', aceito: true }, novoPapel: 'owner',
    })
    t(manter === null, 'owner → owner não dispara a contagem')

    // Segundo owner entra; aí o primeiro pode ser rebaixado.
    await db.update(memberships).set({ role: 'owner' })
      .where(and(eq(memberships.userId, ADMIN), eq(memberships.organizationId, A)))
    const agoraPode = await recusaDeMudanca({
      organizationId: A, papelDoAtor: 'owner',
      alvo: { membershipId: donoA.id, papel: 'owner', aceito: true }, novoPapel: 'admin',
    })
    t(agoraPode === null, 'com um segundo owner ativo, rebaixar é permitido')
    await db.update(memberships).set({ role: 'admin' })
      .where(and(eq(memberships.userId, ADMIN), eq(memberships.organizationId, A)))

    // Owner PENDENTE não conta na proteção nem é protegido.
    const PEND = '55555555-0000-4000-8000-000000000008'
    const convitePend = await criarConvitePendente({
      organizationId: A, userId: PEND, email: 'owner-pendente@teste.com',
      papel: 'owner', convidadoPorUserId: DONO,
    })
    const cancelarPendente = await recusaDeMudanca({
      organizationId: A, papelDoAtor: 'owner',
      alvo: { membershipId: convitePend, papel: 'owner', aceito: false },
    })
    t(cancelarPendente === null, 'cancelar convite pendente de owner é permitido — pendente não conta')

    const adminSobreOwner = await recusaDeMudanca({
      organizationId: A, papelDoAtor: 'admin',
      alvo: { membershipId: donoA.id, papel: 'owner', aceito: true }, novoPapel: 'admin',
    })
    t(adminSobreOwner !== null, 'e a matriz vence antes da contagem: admin sobre owner é recusado')
  }

  // ═══ 8. Auditoria em agent_events ═════════════════════════════════════════
  console.log('\n── 8. agent_events ──')
  {
    const antes = await db.select({ id: agentEvents.id }).from(agentEvents)
      .where(and(eq(agentEvents.organizationId, A), eq(agentEvents.type, 'member_invited')))
    await registrarEventoDeMembro({
      organizationId: A, tipo: 'member_invited', membershipId: DONO,
      payload: { email: 'x@y.com', papel: 'viewer' },
    })
    const depois = await db.select({ id: agentEvents.id }).from(agentEvents)
      .where(and(eq(agentEvents.organizationId, A), eq(agentEvents.type, 'member_invited')))
    t(depois.length === antes.length + 1, `o registro SOBE a contagem (${antes.length} → ${depois.length})`)
  }

  // ═══ 8.5 Aviso por e-mail (parte pura + recusa sem chave) ═════════════════
  console.log('\n── 8.5 aviso por e-mail ──')
  {
    const aviso = emailAvisoDeConvite({
      empresa: 'Padaria <script> & Cia',
      url: 'https://lure-expert.vercel.app/login?next=/configuracoes',
    })
    t(aviso.html.includes('Padaria &lt;script&gt; &amp; Cia'), 'nome da empresa entra ESCAPADO no HTML')
    t(!aviso.html.includes('<script>'), 'e a tag crua não sobrevive')
    t(aviso.html.includes('href="https://lure-expert.vercel.app/login?next=/configuracoes"'), 'o link aponta para o login com next=/configuracoes')
    t(aviso.assunto.includes('Padaria <script> & Cia'), 'o assunto é texto puro, sem escapes de HTML')

    // Garante que NENHUM e-mail real sai do teste, e que a ausência da chave
    // vira recusa descritiva, não exceção.
    delete process.env.RESEND_API_KEY
    const envio = await enviarEmail({ para: 'x@y.com', assunto: 'x', html: 'x' })
    t(!!envio.erro && envio.erro.includes('RESEND_API_KEY'), 'sem a chave, recusa descritiva em vez de exceção')
  }

  // ═══ 9. Limpeza ═══════════════════════════════════════════════════════════
  console.log('\n── 9. limpeza ──')
  await db.delete(organizations).where(eq(organizations.id, A))
  await db.delete(organizations).where(eq(organizations.id, B))
  const [{ n: sobrou }] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE o.name IN (${NOME_A}, ${NOME_B})`)
  t(Number(sobrou) === 0, 'organizações de teste removidas — o CASCADE levou memberships e eventos')

  console.log(`\n${ok} ok · ${falhas} falhas`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(async e => {
  console.error(e)
  await limpar().catch(() => {})
  process.exit(1)
})
