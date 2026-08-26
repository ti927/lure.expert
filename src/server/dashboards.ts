'use server'

// A casca dos painéis: autentica, delega para `lib/dashboard/**` e revalida.
//
// Nenhuma regra mora aqui — papel, validação de spec e execução de bloco estão
// em `/lib`, exercitáveis por script e reusáveis pelas ferramentas MCP da 5.D.

import { revalidatePath } from 'next/cache'
import { getAuthContext } from '@/lib/auth-context'
import { scopeFromSession } from '@/lib/query/scope'
import { listarMembros } from '@/lib/members'
import {
  listarPaineis, lerPainel, criarPainel, atualizarPainel, apagarPainel,
  materializarPainelPadrao, adicionarBloco, editarBloco, removerBloco,
  reordenarBlocos, compartilharPainel, removerCompartilhamento,
  type PainelListado, type CompartilhamentoDoPainel,
} from '@/lib/dashboard/store'
import { blocosDoPainelPadraoValidados, PAINEL_PADRAO_NOME } from '@/lib/dashboard/default-panel'
import { executarBloco, type ResultadoDeBloco } from '@/lib/dashboard/run-block'
import type { BlockSpec } from '@/lib/dashboard/block-spec'

export interface BlocoRenderizado {
  id: string
  posicao: number
  titulo: string | null
  largura: number
  tipo: BlockSpec['tipo'] | null
  spec: BlockSpec | null
  dados: ResultadoDeBloco | null
  /** Spec inválida ou consulta que falhou — o bloco aparece quebrado, sozinho. */
  erro: string | null
}

export interface PainelRenderizado {
  /** `null` no painel padrão virtual, que não existe no banco. */
  id: string | null
  nome: string
  virtual: boolean
  podeEditar: boolean
  ehDono: boolean
  blocos: BlocoRenderizado[]
  compartilhamentos: CompartilhamentoDoPainel[]
}

export interface EstadoDoPainel {
  painel: PainelRenderizado
  disponiveis: PainelListado[]
  /** Papel do usuário na organização — a tela esconde o que ele não pode fazer. */
  papel: string
}

/**
 * Executa os blocos em paralelo. Um bloco que falha vira erro NELE, com o
 * motivo — o painel não pode cair inteiro porque uma consulta quebrou.
 */
async function renderizarBlocos(
  userId: string,
  organizationId: string,
  entradas: Array<{ id: string; posicao: number; titulo: string | null; spec: BlockSpec | null; erroDeSpec: string | null }>,
  mes?: string,
): Promise<BlocoRenderizado[]> {
  const scope = await scopeFromSession(userId, organizationId)

  return Promise.all(entradas.map(async (b): Promise<BlocoRenderizado> => {
    if (!b.spec) {
      return {
        id: b.id, posicao: b.posicao, titulo: b.titulo, largura: 12,
        tipo: null, spec: null, dados: null,
        erro: b.erroDeSpec ?? 'Especificação inválida.',
      }
    }
    const comum = {
      id: b.id,
      posicao: b.posicao,
      titulo: b.titulo ?? ('titulo' in b.spec ? b.spec.titulo ?? null : null),
      largura: b.spec.largura,
      tipo: b.spec.tipo,
      spec: b.spec,
    }
    try {
      return { ...comum, dados: await executarBloco(scope, b.spec, { mes }), erro: null }
    } catch (e) {
      return { ...comum, dados: null, erro: e instanceof Error ? e.message : 'Falha ao carregar este bloco.' }
    }
  }))
}

/**
 * O painel a mostrar: o pedido, o padrão do usuário, ou — se ele não tem
 * nenhum — o PADRÃO VIRTUAL, que reproduz a tela clássica sem gravar nada.
 * Virtual porque só admin+ cria painel, e o primeiro visitante pode ser viewer.
 */
export async function getEstadoDoPainel(
  painelId?: string,
  mes?: string,
): Promise<EstadoDoPainel> {
  const { userId, organizationId, papel } = await getAuthContext()
  const disponiveis = await listarPaineis(userId, organizationId)

  const alvo = painelId
    ? disponiveis.find(p => p.id === painelId)
    : disponiveis.find(p => p.padrao && p.donoUserId === userId) ?? disponiveis[0]

  if (!alvo) {
    const blocos = blocosDoPainelPadraoValidados()
    return {
      papel,
      disponiveis,
      painel: {
        id: null,
        nome: PAINEL_PADRAO_NOME,
        virtual: true,
        podeEditar: false,
        ehDono: false,
        compartilhamentos: [],
        blocos: await renderizarBlocos(
          userId, organizationId,
          blocos.map((spec, i) => ({
            id: `virtual-${i}`, posicao: i,
            titulo: 'titulo' in spec ? spec.titulo ?? null : null,
            spec, erroDeSpec: null,
          })),
          mes,
        ),
      },
    }
  }

  const lido = await lerPainel(userId, organizationId, alvo.id)
  if ('erro' in lido) throw new Error(lido.erro)

  return {
    papel,
    disponiveis,
    painel: {
      id: lido.painel.id,
      nome: lido.painel.nome,
      virtual: false,
      podeEditar: lido.painel.permissao !== 'ler',
      ehDono: lido.painel.permissao === 'dono',
      compartilhamentos: lido.painel.compartilhamentos,
      blocos: await renderizarBlocos(userId, organizationId, lido.painel.blocos, mes),
    },
  }
}

// ─── Mutações ────────────────────────────────────────────────────────────────

async function ctx() {
  const { userId, organizationId, papel } = await getAuthContext()
  return { userId, organizationId, papel }
}

export async function criarPainelAction(nome: string, padrao = false) {
  const r = await criarPainel({ ...(await ctx()), nome, padrao })
  if (!('erro' in r)) revalidatePath('/dashboard')
  return r
}

export async function renomearPainelAction(painelId: string, nome: string) {
  const r = await atualizarPainel({ ...(await ctx()), painelId, nome })
  if (!('erro' in r)) revalidatePath('/dashboard')
  return r
}

export async function definirPainelPadraoAction(painelId: string) {
  const r = await atualizarPainel({ ...(await ctx()), painelId, padrao: true })
  if (!('erro' in r)) revalidatePath('/dashboard')
  return r
}

export async function apagarPainelAction(painelId: string) {
  const r = await apagarPainel({ ...(await ctx()), painelId })
  if (!('erro' in r)) revalidatePath('/dashboard')
  return r
}

export async function materializarPainelPadraoAction() {
  const r = await materializarPainelPadrao(await ctx())
  if (!('erro' in r)) revalidatePath('/dashboard')
  return r
}

export async function adicionarBlocoAction(painelId: string, spec: unknown, titulo?: string) {
  const r = await adicionarBloco({ ...(await ctx()), painelId, spec, titulo })
  if (!('erro' in r)) revalidatePath('/dashboard')
  return 'erro' in r ? r : { id: r.id }
}

export async function editarBlocoAction(painelId: string, blocoId: string, spec: unknown, titulo?: string | null) {
  const r = await editarBloco({ ...(await ctx()), painelId, blocoId, spec, titulo })
  if (!('erro' in r)) revalidatePath('/dashboard')
  return 'erro' in r ? r : { ok: true as const }
}

export async function removerBlocoAction(painelId: string, blocoId: string) {
  const r = await removerBloco({ ...(await ctx()), painelId, blocoId })
  if (!('erro' in r)) revalidatePath('/dashboard')
  return r
}

export async function reordenarBlocosAction(painelId: string, ordem: string[]) {
  const r = await reordenarBlocos({ ...(await ctx()), painelId, ordem })
  if (!('erro' in r)) revalidatePath('/dashboard')
  return r
}

/**
 * Muda a largura de um bloco — a edição de layout que a tela oferece na v1
 * (bloco novo e mudança de consulta ficam com o expert, via MCP).
 * Reescreve a spec inteira porque `largura` mora dentro dela.
 */
export async function redimensionarBlocoAction(painelId: string, blocoId: string, largura: number) {
  const { userId, organizationId, papel } = await ctx()
  const lido = await lerPainel(userId, organizationId, painelId)
  if ('erro' in lido) return { erro: lido.erro }

  const bloco = lido.painel.blocos.find(b => b.id === blocoId)
  if (!bloco?.spec) return { erro: 'Bloco não encontrado ou com especificação inválida.' }

  const r = await editarBloco({
    userId, organizationId, papel, painelId, blocoId,
    spec: { ...bloco.spec, largura },
  })
  if (!('erro' in r)) revalidatePath('/dashboard')
  return 'erro' in r ? r : { ok: true as const }
}

export async function compartilharPainelAction(
  painelId: string,
  alvo: { escopo: 'organizacao' } | { escopo: 'usuarios'; userId: string },
  permissao: 'ler' | 'editar',
) {
  const r = await compartilharPainel({ ...(await ctx()), painelId, alvo, permissao })
  if (!('erro' in r)) revalidatePath('/dashboard')
  return 'erro' in r ? r : { id: r.id }
}

export async function removerCompartilhamentoAction(painelId: string, shareId: string) {
  const r = await removerCompartilhamento({ ...(await ctx()), painelId, shareId })
  if (!('erro' in r)) revalidatePath('/dashboard')
  return r
}

/** Membros ativos, para o diálogo de compartilhamento escolher com quem. */
export async function getMembrosParaCompartilhar() {
  const { userId, organizationId } = await getAuthContext()
  const membros = await listarMembros(organizationId)
  return membros
    .filter(m => m.aceitoEm !== null && m.userId !== userId)
    .map(m => ({ userId: m.userId, email: m.email, papel: m.papel }))
}
