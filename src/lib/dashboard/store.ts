// O miolo dos painéis — criar, ler, compartilhar, e os blocos dentro deles.
//
// Fora de `'use server'` pelo motivo de sempre: cada função recebe o executor
// e é exercitável direto contra o banco (`verify-dashboards.ts`), e o grupo de
// ferramentas MCP da 5.D chama exatamente estas funções. A casca de sessão
// chega na 5.C.
//
// As regras de papel (decididas com Julio em 25/ago, na abertura da Fase 5):
//
// - VER painel: dono, ou compartilhado com a organização, ou compartilhado com
//   a pessoa — qualquer papel, viewer incluso.
// - CRIAR, EDITAR, COMPARTILHAR: admin+. Painel de outra pessoa só se edita
//   com compartilhamento de permissão 'editar' (e sendo admin+).
// - APAGAR painel e gerir compartilhamentos: só o dono.
//
// Toda query filtra `organization_id` — painel de outra organização não é
// "sem acesso", é inexistente.
//
// Specs passam pelo `blockSpecSchema` na escrita E na leitura. Um bloco com
// spec inválida aparece na leitura com `erroDeSpec` preenchido, nunca some da
// lista nem derruba o painel.

import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { dashboards, dashboardBlocks, dashboardShares, memberships } from '@/db/schema'
import { recusaDePapel } from '@/lib/members-types'
import { blockSpecSchema, lerBlockSpec, type BlockSpec } from './block-spec'
import {
  PAINEL_PADRAO_NOME, PAINEL_PADRAO_SLUG, blocosDoPainelPadraoValidados,
} from './default-panel'

type Exec = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type PermissaoNoPainel = 'dono' | 'editar' | 'ler'

export interface PainelListado {
  id: string
  nome: string
  slug: string
  descricao: string | null
  padrao: boolean
  donoUserId: string
  permissao: PermissaoNoPainel
  compartilhadoComAOrganizacao: boolean
}

export interface BlocoDoPainel {
  id: string
  posicao: number
  titulo: string | null
  /** `null` quando a spec gravada não valida mais — `erroDeSpec` diz por quê. */
  spec: BlockSpec | null
  erroDeSpec: string | null
}

export interface CompartilhamentoDoPainel {
  id: string
  escopo: 'organizacao' | 'usuarios'
  userId: string | null
  email: string | null
  permissao: 'ler' | 'editar'
}

export interface PainelCompleto extends PainelListado {
  blocos: BlocoDoPainel[]
  compartilhamentos: CompartilhamentoDoPainel[]
}

// ─── Helpers internos ────────────────────────────────────────────────────────

function slugificar(nome: string): string {
  const base = nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'painel'
}

// A assinatura de índice é exigência do `execute<T>` do Drizzle, que só aceita
// `Record<string, unknown>`.
interface LinhaDePainel {
  id: string
  name: string
  slug: string
  description: string | null
  is_default: boolean
  owner_user_id: string
  comp_org: boolean
  org_editar: boolean
  user_share: boolean
  user_editar: boolean
  [k: string]: unknown
}

function permissaoDaLinha(l: LinhaDePainel, userId: string): PermissaoNoPainel | null {
  if (l.owner_user_id === userId) return 'dono'
  if (l.org_editar || l.user_editar) return 'editar'
  if (l.comp_org || l.user_share) return 'ler'
  return null
}

const CAMPOS_DE_PAINEL = sql`
  d.id, d.name, d.slug, d.description, d.is_default, d.owner_user_id,
  EXISTS(SELECT 1 FROM dashboard_shares s WHERE s.dashboard_id = d.id AND s.scope = 'organizacao') AS comp_org,
  EXISTS(SELECT 1 FROM dashboard_shares s WHERE s.dashboard_id = d.id AND s.scope = 'organizacao' AND s.permission = 'editar') AS org_editar
`

function paraListado(l: LinhaDePainel, permissao: PermissaoNoPainel): PainelListado {
  return {
    id: l.id,
    nome: l.name,
    slug: l.slug,
    descricao: l.description,
    padrao: l.is_default,
    donoUserId: l.owner_user_id,
    permissao,
    compartilhadoComAOrganizacao: l.comp_org,
  }
}

async function carregarLinha(
  organizationId: string,
  painelId: string,
  userId: string,
  exec: Exec,
): Promise<LinhaDePainel | null> {
  const linhas = await exec.execute<LinhaDePainel>(sql`
    SELECT ${CAMPOS_DE_PAINEL},
      EXISTS(SELECT 1 FROM dashboard_shares s WHERE s.dashboard_id = d.id AND s.scope = 'usuarios' AND s.user_id = ${userId}::uuid) AS user_share,
      EXISTS(SELECT 1 FROM dashboard_shares s WHERE s.dashboard_id = d.id AND s.scope = 'usuarios' AND s.user_id = ${userId}::uuid AND s.permission = 'editar') AS user_editar
    FROM dashboards d
    WHERE d.organization_id = ${organizationId}::uuid AND d.id = ${painelId}::uuid
    LIMIT 1
  `)
  return linhas[0] ?? null
}

/**
 * A recusa de edição. Papel primeiro (admin+ sempre), depois o vínculo com o
 * painel: dono edita o seu; o de outra pessoa exige compartilhamento 'editar'.
 */
function recusaDeEdicao(
  linha: LinhaDePainel,
  userId: string,
  papel: string,
): string | null {
  const porPapel = recusaDePapel(papel, 'admin', 'editar painéis')
  if (porPapel) return porPapel
  if (linha.owner_user_id === userId) return null
  if (linha.org_editar || linha.user_editar) return null
  return 'Este painel é de outra pessoa e foi compartilhado sem permissão de edição — peça ao dono.'
}

function erroDeSpecLegivel(spec: unknown): string | null {
  const r = blockSpecSchema.safeParse(spec)
  if (r.success) return null
  const i = r.error.issues[0]
  return `${i.path.join('.') || 'spec'}: ${i.message}`
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

/** Os painéis que o usuário enxerga nesta organização: os dele + os compartilhados. */
export async function listarPaineis(
  userId: string,
  organizationId: string,
  exec: Exec = db,
): Promise<PainelListado[]> {
  const linhas = await exec.execute<LinhaDePainel>(sql`
    SELECT ${CAMPOS_DE_PAINEL},
      EXISTS(SELECT 1 FROM dashboard_shares s WHERE s.dashboard_id = d.id AND s.scope = 'usuarios' AND s.user_id = ${userId}::uuid) AS user_share,
      EXISTS(SELECT 1 FROM dashboard_shares s WHERE s.dashboard_id = d.id AND s.scope = 'usuarios' AND s.user_id = ${userId}::uuid AND s.permission = 'editar') AS user_editar
    FROM dashboards d
    WHERE d.organization_id = ${organizationId}::uuid
    ORDER BY d.is_default DESC, d.created_at ASC, d.id ASC
  `)

  return linhas
    .map(l => {
      const p = permissaoDaLinha(l, userId)
      return p ? paraListado(l, p) : null
    })
    .filter((x): x is PainelListado => x !== null)
}

/** O painel com blocos e compartilhamentos — ou a recusa. */
export async function lerPainel(
  userId: string,
  organizationId: string,
  painelId: string,
  exec: Exec = db,
): Promise<{ painel: PainelCompleto } | { erro: string }> {
  const linha = await carregarLinha(organizationId, painelId, userId, exec)
  if (!linha) return { erro: 'Painel não encontrado.' }

  const permissao = permissaoDaLinha(linha, userId)
  if (!permissao) {
    return { erro: 'Você não tem acesso a este painel — peça ao dono para compartilhá-lo.' }
  }

  const [blocos, shares] = await Promise.all([
    exec
      .select({
        id: dashboardBlocks.id,
        position: dashboardBlocks.position,
        title: dashboardBlocks.title,
        spec: dashboardBlocks.spec,
      })
      .from(dashboardBlocks)
      .where(eq(dashboardBlocks.dashboardId, painelId))
      .orderBy(asc(dashboardBlocks.position), asc(dashboardBlocks.createdAt)),
    exec.execute<{
      id: string
      scope: string
      user_id: string | null
      permission: string
      email: string | null
    }>(sql`
      SELECT s.id, s.scope, s.user_id, s.permission, u.email
      FROM dashboard_shares s
      LEFT JOIN auth.users u ON u.id = s.user_id
      WHERE s.dashboard_id = ${painelId}::uuid
      ORDER BY s.scope ASC, s.created_at ASC
    `),
  ])

  return {
    painel: {
      ...paraListado(linha, permissao),
      blocos: blocos.map((b): BlocoDoPainel => {
        const lido = lerBlockSpec(b.spec)
        return {
          id: b.id,
          posicao: b.position,
          titulo: b.title,
          spec: lido.ok ? lido.spec : null,
          erroDeSpec: lido.ok ? null : lido.erro,
        }
      }),
      compartilhamentos: shares.map(s => ({
        id: s.id,
        escopo: s.scope as 'organizacao' | 'usuarios',
        userId: s.user_id,
        email: s.email,
        permissao: s.permission as 'ler' | 'editar',
      })),
    },
  }
}

// ─── Painéis ─────────────────────────────────────────────────────────────────

async function slugLivre(
  organizationId: string,
  userId: string,
  base: string,
  exec: Exec,
): Promise<string> {
  for (let n = 1; n <= 50; n++) {
    const tentativa = n === 1 ? base : `${base}-${n}`
    const [existe] = await exec
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(and(
        eq(dashboards.organizationId, organizationId),
        eq(dashboards.ownerUserId, userId),
        eq(dashboards.slug, tentativa),
      ))
      .limit(1)
    if (!existe) return tentativa
  }
  // 50 homônimos é sabotagem, não uso: o sufixo temporal desempata.
  return `${base}-${Date.now()}`
}

async function desmarcarPadrao(organizationId: string, userId: string, exec: Exec) {
  await exec
    .update(dashboards)
    .set({ isDefault: false })
    .where(and(
      eq(dashboards.organizationId, organizationId),
      eq(dashboards.ownerUserId, userId),
      eq(dashboards.isDefault, true),
    ))
}

export async function criarPainel(
  args: {
    userId: string
    organizationId: string
    papel: string
    nome: string
    descricao?: string
    padrao?: boolean
  },
  exec: Exec = db,
): Promise<{ id: string; slug: string } | { erro: string }> {
  const recusa = recusaDePapel(args.papel, 'admin', 'criar painéis')
  if (recusa) return { erro: recusa }

  const nome = args.nome.trim()
  if (!nome) return { erro: 'Dê um nome ao painel.' }
  if (nome.length > 80) return { erro: 'Nome longo demais (máximo 80 caracteres).' }

  const slug = await slugLivre(args.organizationId, args.userId, slugificar(nome), exec)
  if (args.padrao) await desmarcarPadrao(args.organizationId, args.userId, exec)

  const [criado] = await exec
    .insert(dashboards)
    .values({
      organizationId: args.organizationId,
      ownerUserId: args.userId,
      name: nome,
      slug,
      description: args.descricao?.trim() || null,
      isDefault: args.padrao ?? false,
    })
    .returning({ id: dashboards.id, slug: dashboards.slug })

  return { id: criado.id, slug: criado.slug }
}

export async function atualizarPainel(
  args: {
    userId: string
    organizationId: string
    papel: string
    painelId: string
    nome?: string
    descricao?: string | null
    padrao?: boolean
  },
  exec: Exec = db,
): Promise<{ ok: true } | { erro: string }> {
  const linha = await carregarLinha(args.organizationId, args.painelId, args.userId, exec)
  if (!linha) return { erro: 'Painel não encontrado.' }
  const recusa = recusaDeEdicao(linha, args.userId, args.papel)
  if (recusa) return { erro: recusa }

  const mudancas: Partial<typeof dashboards.$inferInsert> = {}
  if (args.nome !== undefined) {
    const nome = args.nome.trim()
    if (!nome) return { erro: 'Dê um nome ao painel.' }
    mudancas.name = nome
  }
  if (args.descricao !== undefined) mudancas.description = args.descricao?.trim() || null

  // "Padrão" é POR USUÁRIO (o índice parcial é por org+owner): marcar o painel
  // de outra pessoa como padrão mexeria no painel inicial DELA — só o dono.
  if (args.padrao !== undefined) {
    if (linha.owner_user_id !== args.userId) {
      return { erro: 'Só o dono define o painel padrão dele.' }
    }
    if (args.padrao) await desmarcarPadrao(args.organizationId, args.userId, exec)
    mudancas.isDefault = args.padrao
  }

  if (Object.keys(mudancas).length === 0) return { ok: true }

  await exec
    .update(dashboards)
    .set(mudancas)
    .where(and(
      eq(dashboards.id, args.painelId),
      eq(dashboards.organizationId, args.organizationId),
    ))
  return { ok: true }
}

export async function apagarPainel(
  args: { userId: string; organizationId: string; papel: string; painelId: string },
  exec: Exec = db,
): Promise<{ ok: true } | { erro: string }> {
  const linha = await carregarLinha(args.organizationId, args.painelId, args.userId, exec)
  if (!linha) return { erro: 'Painel não encontrado.' }
  const porPapel = recusaDePapel(args.papel, 'admin', 'apagar painéis')
  if (porPapel) return { erro: porPapel }
  if (linha.owner_user_id !== args.userId) {
    return { erro: 'Só o dono apaga o painel — compartilhamento não dá esse direito.' }
  }

  // O CASCADE leva blocos e compartilhamentos.
  await exec
    .delete(dashboards)
    .where(and(
      eq(dashboards.id, args.painelId),
      eq(dashboards.organizationId, args.organizationId),
    ))
  return { ok: true }
}

/**
 * Materializa o painel padrão virtual — o botão "Personalizar" de admin+.
 * Nasce como padrão do usuário, com os 8 blocos da tela clássica.
 */
export async function materializarPainelPadrao(
  args: { userId: string; organizationId: string; papel: string },
  exec: Exec = db,
): Promise<{ id: string } | { erro: string }> {
  const recusa = recusaDePapel(args.papel, 'admin', 'criar painéis')
  if (recusa) return { erro: recusa }

  const [existente] = await exec
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(and(
      eq(dashboards.organizationId, args.organizationId),
      eq(dashboards.ownerUserId, args.userId),
      eq(dashboards.slug, PAINEL_PADRAO_SLUG),
    ))
    .limit(1)
  if (existente) return { erro: 'O painel padrão já foi materializado — edite o existente.' }

  await desmarcarPadrao(args.organizationId, args.userId, exec)
  const [painel] = await exec
    .insert(dashboards)
    .values({
      organizationId: args.organizationId,
      ownerUserId: args.userId,
      name: PAINEL_PADRAO_NOME,
      slug: PAINEL_PADRAO_SLUG,
      isDefault: true,
    })
    .returning({ id: dashboards.id })

  const blocos = blocosDoPainelPadraoValidados()
  await exec.insert(dashboardBlocks).values(
    blocos.map((spec, i) => ({
      dashboardId: painel.id,
      organizationId: args.organizationId,
      position: i,
      title: 'titulo' in spec ? spec.titulo ?? null : null,
      spec,
    })),
  )

  return { id: painel.id }
}

// ─── Blocos ──────────────────────────────────────────────────────────────────

export async function adicionarBloco(
  args: {
    userId: string
    organizationId: string
    papel: string
    painelId: string
    spec: unknown
    titulo?: string
    posicao?: number
  },
  exec: Exec = db,
): Promise<{ id: string; spec: BlockSpec } | { erro: string }> {
  const linha = await carregarLinha(args.organizationId, args.painelId, args.userId, exec)
  if (!linha) return { erro: 'Painel não encontrado.' }
  const recusa = recusaDeEdicao(linha, args.userId, args.papel)
  if (recusa) return { erro: recusa }

  const invalida = erroDeSpecLegivel(args.spec)
  if (invalida) return { erro: `Especificação inválida — ${invalida}` }
  const spec = blockSpecSchema.parse(args.spec)

  let posicao = args.posicao
  if (posicao === undefined) {
    const [max] = await exec.execute<{ prox: number }>(sql`
      SELECT COALESCE(MAX(position) + 1, 0)::int AS prox
      FROM dashboard_blocks WHERE dashboard_id = ${args.painelId}::uuid
    `)
    posicao = max?.prox ?? 0
  }

  const [criado] = await exec
    .insert(dashboardBlocks)
    .values({
      dashboardId: args.painelId,
      organizationId: args.organizationId,
      position: posicao,
      title: args.titulo?.trim() || ('titulo' in spec ? spec.titulo ?? null : null),
      spec,
    })
    .returning({ id: dashboardBlocks.id })

  return { id: criado.id, spec }
}

export async function editarBloco(
  args: {
    userId: string
    organizationId: string
    papel: string
    painelId: string
    blocoId: string
    spec: unknown
    titulo?: string | null
  },
  exec: Exec = db,
): Promise<{ spec: BlockSpec } | { erro: string }> {
  const linha = await carregarLinha(args.organizationId, args.painelId, args.userId, exec)
  if (!linha) return { erro: 'Painel não encontrado.' }
  const recusa = recusaDeEdicao(linha, args.userId, args.papel)
  if (recusa) return { erro: recusa }

  const invalida = erroDeSpecLegivel(args.spec)
  if (invalida) return { erro: `Especificação inválida — ${invalida}` }
  const spec = blockSpecSchema.parse(args.spec)

  const mudancas: Partial<typeof dashboardBlocks.$inferInsert> = { spec }
  if (args.titulo !== undefined) mudancas.title = args.titulo?.trim() || null

  const alterados = await exec
    .update(dashboardBlocks)
    .set(mudancas)
    .where(and(
      eq(dashboardBlocks.id, args.blocoId),
      eq(dashboardBlocks.dashboardId, args.painelId),
    ))
    .returning({ id: dashboardBlocks.id })
  if (alterados.length === 0) return { erro: 'Bloco não encontrado neste painel.' }

  return { spec }
}

export async function removerBloco(
  args: {
    userId: string
    organizationId: string
    papel: string
    painelId: string
    blocoId: string
  },
  exec: Exec = db,
): Promise<{ ok: true } | { erro: string }> {
  const linha = await carregarLinha(args.organizationId, args.painelId, args.userId, exec)
  if (!linha) return { erro: 'Painel não encontrado.' }
  const recusa = recusaDeEdicao(linha, args.userId, args.papel)
  if (recusa) return { erro: recusa }

  const removidos = await exec
    .delete(dashboardBlocks)
    .where(and(
      eq(dashboardBlocks.id, args.blocoId),
      eq(dashboardBlocks.dashboardId, args.painelId),
    ))
    .returning({ id: dashboardBlocks.id })
  if (removidos.length === 0) return { erro: 'Bloco não encontrado neste painel.' }

  return { ok: true }
}

/**
 * Reordena TODOS os blocos. A lista tem de bater exatamente com o conjunto
 * atual — se alguém acrescentou ou removeu um bloco no intervalo, reordenar
 * por cima apagaria a mudança que o autor da lista nunca viu (a mesma defesa
 * da assinatura de plano das regras, na 3.3).
 */
export async function reordenarBlocos(
  args: {
    userId: string
    organizationId: string
    papel: string
    painelId: string
    ordem: string[]
  },
  exec: Exec = db,
): Promise<{ ok: true } | { erro: string }> {
  const linha = await carregarLinha(args.organizationId, args.painelId, args.userId, exec)
  if (!linha) return { erro: 'Painel não encontrado.' }
  const recusa = recusaDeEdicao(linha, args.userId, args.papel)
  if (recusa) return { erro: recusa }

  const atuais = await exec
    .select({ id: dashboardBlocks.id })
    .from(dashboardBlocks)
    .where(eq(dashboardBlocks.dashboardId, args.painelId))

  const idsAtuais = atuais.map(b => b.id)
  const idsPedidos = new Set(args.ordem)
  const bate = idsAtuais.length === idsPedidos.size
    && args.ordem.length === idsPedidos.size
    && idsAtuais.every(id => idsPedidos.has(id))
  if (!bate) {
    return { erro: 'A ordem enviada não corresponde aos blocos atuais do painel — recarregue e tente de novo.' }
  }

  for (let i = 0; i < args.ordem.length; i++) {
    await exec
      .update(dashboardBlocks)
      .set({ position: i })
      .where(and(
        eq(dashboardBlocks.id, args.ordem[i]),
        eq(dashboardBlocks.dashboardId, args.painelId),
      ))
  }
  return { ok: true }
}

// ─── Compartilhamento ────────────────────────────────────────────────────────

export async function compartilharPainel(
  args: {
    userId: string
    organizationId: string
    papel: string
    painelId: string
    alvo: { escopo: 'organizacao' } | { escopo: 'usuarios'; userId: string }
    permissao: 'ler' | 'editar'
  },
  exec: Exec = db,
): Promise<{ id: string } | { erro: string }> {
  const linha = await carregarLinha(args.organizationId, args.painelId, args.userId, exec)
  if (!linha) return { erro: 'Painel não encontrado.' }
  const porPapel = recusaDePapel(args.papel, 'admin', 'compartilhar painéis')
  if (porPapel) return { erro: porPapel }
  if (linha.owner_user_id !== args.userId) {
    return { erro: 'Só o dono compartilha o painel.' }
  }

  const alvoUserId = args.alvo.escopo === 'usuarios' ? args.alvo.userId : null
  if (alvoUserId === args.userId) return { erro: 'O painel já é seu — compartilhe com outra pessoa.' }

  // Compartilhar com pessoa exige vínculo ACEITO na organização: sem isso, o
  // share seria uma promessa a quem talvez nunca tenha entrado.
  if (alvoUserId) {
    const [vinculo] = await exec
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(
        eq(memberships.userId, alvoUserId),
        eq(memberships.organizationId, args.organizationId),
        sql`${memberships.acceptedAt} IS NOT NULL`,
      ))
      .limit(1)
    if (!vinculo) return { erro: 'Essa pessoa não é membro ativo desta organização.' }
  }

  // Upsert manual: o índice único usa COALESCE e o Drizzle não o expressa.
  const existentes = await exec
    .select({ id: dashboardShares.id })
    .from(dashboardShares)
    .where(and(
      eq(dashboardShares.dashboardId, args.painelId),
      eq(dashboardShares.scope, args.alvo.escopo),
      alvoUserId ? eq(dashboardShares.userId, alvoUserId) : sql`${dashboardShares.userId} IS NULL`,
    ))
  if (existentes.length > 0) {
    await exec
      .update(dashboardShares)
      .set({ permission: args.permissao })
      .where(eq(dashboardShares.id, existentes[0].id))
    return { id: existentes[0].id }
  }

  const [criado] = await exec
    .insert(dashboardShares)
    .values({
      dashboardId: args.painelId,
      organizationId: args.organizationId,
      scope: args.alvo.escopo,
      userId: alvoUserId,
      permission: args.permissao,
    })
    .returning({ id: dashboardShares.id })
  return { id: criado.id }
}

export async function removerCompartilhamento(
  args: {
    userId: string
    organizationId: string
    papel: string
    painelId: string
    shareId: string
  },
  exec: Exec = db,
): Promise<{ ok: true } | { erro: string }> {
  const linha = await carregarLinha(args.organizationId, args.painelId, args.userId, exec)
  if (!linha) return { erro: 'Painel não encontrado.' }
  const porPapel = recusaDePapel(args.papel, 'admin', 'compartilhar painéis')
  if (porPapel) return { erro: porPapel }
  if (linha.owner_user_id !== args.userId) {
    return { erro: 'Só o dono gerencia os compartilhamentos.' }
  }

  const removidos = await exec
    .delete(dashboardShares)
    .where(and(
      eq(dashboardShares.id, args.shareId),
      eq(dashboardShares.dashboardId, args.painelId),
    ))
    .returning({ id: dashboardShares.id })
  if (removidos.length === 0) return { erro: 'Compartilhamento não encontrado.' }
  return { ok: true }
}

