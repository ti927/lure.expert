// O grupo de dashboard — as 8 ferramentas que fecham o catálogo do MCP.
//
// A diferença de padrão em relação aos seis pares prever_/aplicar_: aqui a
// prévia é um PARÂMETRO (`previa: true`), não uma chamada separada. O motivo é
// que criar bloco não destrói nada — não reclassifica lançamento nem sobrescreve
// trabalho de outra pessoa. O que o par existe para proteger (aplicar sobre uma
// fotografia velha) não se aplica: o pior caso de um bloco errado é um bloco
// errado, que `remover_bloco` desfaz.
//
// O que ele PRECISA, e é o que `previa: true` entrega, é o modelo **ver o
// número que construiu** antes de gravar — um gráfico plausível com a consulta
// errada é o defeito caro aqui, e ele só aparece olhando as linhas.
//
// Mesma regra de importação de sempre: este arquivo só importa de `src/lib/**`.

import { z } from 'zod'
import { blockSpecSchema } from '@/lib/dashboard/block-spec'
import {
  listarPaineis, lerPainel, criarPainel, apagarPainel, adicionarBloco, editarBloco,
  removerBloco, reordenarBlocos, compartilharPainel,
} from '@/lib/dashboard/store'
import { executarBloco } from '@/lib/dashboard/run-block'
import { papelNaOrganizacao } from '@/lib/members'
import { scopeFromMcpGrant } from '@/lib/query/scope'
import { exigirConfirmacao, PALAVRA_DE_CONFIRMACAO } from './preview'
import type { Ferramenta, ContextoMcp } from './tools-types'

const uuid = z.string().uuid()

const alvo = z.object({
  organizationId: uuid.describe(
    'Empresa do painel. Use listar_organizacoes para obter os ids disponíveis.',
  ),
})

async function escopoDe(ctx: ContextoMcp, organizationId: string) {
  return scopeFromMcpGrant({ userId: ctx.userId, organizationIds: ctx.organizationIds }, organizationId)
}

/**
 * O papel, exigido pelas escritas de painel.
 *
 * O portão do despacho em `/api/mcp` já recusa viewer em qualquer ferramenta de
 * escrita; este é o segundo, mais estreito: painel exige **admin+**, e um
 * operador (member) passa lá e para aqui.
 */
async function papelDe(ctx: ContextoMcp, organizationId: string): Promise<string> {
  return (await papelNaOrganizacao(ctx.userId, organizationId)) ?? 'desconhecido'
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

const listarPaineisFerramenta: Ferramenta = {
  nome: 'listar_paineis',
  titulo: 'Listar painéis',
  descricao:
    'Os painéis desta empresa que o usuário enxerga: os dele e os que compartilharam com ele. ' +
    'Devolve id, nome, se é o painel padrão e qual a permissão (dono, editar ou ler). ' +
    'Comece por aqui antes de criar painel — pode já existir um com o nome que o usuário citou.',
  entrada: alvo,
  escopo: 'leitura',
  async executar(args, ctx) {
    const scope = await escopoDe(ctx, String(args.organizationId))
    const paineis = await listarPaineis(ctx.userId, scope.organizationId)
    return {
      paineis: paineis.map(p => ({
        id: p.id,
        nome: p.nome,
        padrao: p.padrao,
        permissao: p.permissao,
        compartilhadoComAEmpresa: p.compartilhadoComAOrganizacao,
      })),
      total: paineis.length,
      ...(paineis.length === 0 ? {
        aviso: 'Nenhum painel gravado. A tela mostra um painel padrão automático, que reproduz a ' +
          'visão clássica sem existir no banco. Para personalizar, crie um painel com criar_painel.',
      } : {}),
    }
  },
}

const lerPainelFerramenta: Ferramenta = {
  nome: 'ler_painel',
  titulo: 'Ler painel',
  descricao:
    'Os blocos de um painel, em ordem, com a especificação de cada um. É o que você lê antes de ' +
    'editar ou reordenar — `editar_bloco` precisa do blocoId, e `reordenar_blocos` precisa da ' +
    'lista COMPLETA de ids. Bloco cuja especificação não valida mais aparece com `erroDeSpec`.',
  entrada: alvo.extend({ painelId: uuid }),
  escopo: 'leitura',
  async executar(args, ctx) {
    const a = args as { organizationId: string; painelId: string }
    const scope = await escopoDe(ctx, a.organizationId)
    const r = await lerPainel(ctx.userId, scope.organizationId, a.painelId)
    if ('erro' in r) throw new Error(r.erro)
    return {
      painel: {
        id: r.painel.id,
        nome: r.painel.nome,
        padrao: r.painel.padrao,
        permissao: r.painel.permissao,
      },
      blocos: r.painel.blocos.map(b => ({
        id: b.id,
        posicao: b.posicao,
        titulo: b.titulo,
        tipo: b.spec?.tipo ?? null,
        largura: b.spec?.largura ?? null,
        spec: b.spec,
        ...(b.erroDeSpec ? { erroDeSpec: b.erroDeSpec } : {}),
      })),
      compartilhamentos: r.painel.compartilhamentos.map(c => ({
        id: c.id, escopo: c.escopo, email: c.email, permissao: c.permissao,
      })),
    }
  },
}

// ─── Escrita ─────────────────────────────────────────────────────────────────

const criarPainelFerramenta: Ferramenta = {
  nome: 'criar_painel',
  titulo: 'Criar painel',
  descricao:
    'Cria um painel VAZIO e devolve o id — os blocos entram depois, com adicionar_bloco. ' +
    'Exige papel de administrador ou proprietário. O painel nasce como do usuário, e só ele o ' +
    'apaga ou compartilha. Use `padrao: true` para ele virar o painel que abre em /dashboard.',
  entrada: alvo.extend({
    nome: z.string().trim().min(1).max(80).describe('Ex.: "Conselho", "Operação", "Visão do banco".'),
    padrao: z.boolean().default(false).describe(
      'Torna este o painel inicial do usuário nesta empresa (só um por vez).',
    ),
  }),
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as { organizationId: string; nome: string; padrao: boolean }
    const scope = await escopoDe(ctx, a.organizationId)
    const r = await criarPainel({
      userId: ctx.userId, organizationId: scope.organizationId,
      papel: await papelDe(ctx, scope.organizationId),
      nome: a.nome, padrao: a.padrao,
    })
    if ('erro' in r) throw new Error(r.erro)
    return {
      painelId: r.id, slug: r.slug,
      proximoPasso: 'Agora chame adicionar_bloco com previa: true para conferir os números antes de gravar.',
    }
  },
}

/**
 * A entrada de `adicionar_bloco`.
 *
 * Publica o `blockSpecSchema` inteiro — diferente da importação, onde a entrada
 * é uma simplificação do schema interno. Aqui não há o que simplificar: a spec
 * do bloco JÁ é a interface, foi desenhada para ser preenchida por um modelo, e
 * qualquer tradução criaria um segundo vocabulário para manter.
 */
const entradaAdicionarBloco = alvo.extend({
  painelId: uuid,
  spec: blockSpecSchema,
  previa: z.boolean().default(false).describe(
    'true = NÃO grava; só valida e devolve os números que o bloco mostraria. Use SEMPRE antes de ' +
    'gravar: é como você confere que a consulta responde o que o usuário pediu.',
  ),
  mes: z.string().regex(/^\d{4}-\d{2}$/).optional().describe(
    'Mês de referência para calcular a prévia (AAAA-MM). Padrão: mês corrente. Não afeta o que é ' +
    'gravado — a janela do bloco é sempre relativa ao mês que o painel estiver mostrando.',
  ),
})

/**
 * O par de `criar_painel`.
 *
 * Faltava — achado 8 do diagnóstico de 26/ago: dava para criar painel e remover
 * os blocos um a um, mas o painel vazio ficava, e só a tela o apagava. Criar sem
 * excluir deixa lixo que quem criou não consegue limpar.
 *
 * É a ÚNICA exclusão do catálogo, e o que a torna aceitável é o que ela não
 * apaga: painel não contém dado financeiro, só a forma de olhar para ele. As
 * exclusões que ficaram de fora da v1 (lançamentos, regras, versão de orçamento)
 * apagam contabilidade e pedem `prever_exclusao_*` com contagem antes.
 */
const apagarPainelFerramenta: Ferramenta = {
  nome: 'apagar_painel',
  titulo: 'Apagar painel',
  descricao:
    'Apaga o painel, com os blocos e os compartilhamentos dele. **Não apaga lançamento, natureza ' +
    'nem orçamento** — some a forma de visualizar, e os números continuam intactos em /transacoes ' +
    'e na DRE. Ainda assim é irreversível: confirme com o usuário, pelo NOME do painel, antes de ' +
    'chamar. Só o dono do painel apaga.',
  entrada: alvo.extend({
    painelId: uuid,
    confirmacao: z.string().describe(
      `A palavra literal "${PALAVRA_DE_CONFIRMACAO}". Serve para o aceite do usuário aparecer na ` +
      'conversa, onde ele lê — o mesmo dente das outras escritas.',
    ),
  }),
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as { organizationId: string; painelId: string; confirmacao: string }
    const scope = await escopoDe(ctx, a.organizationId)

    const falta = exigirConfirmacao(a.confirmacao)
    if (falta) throw new Error(falta)

    // Lê ANTES de apagar: sem o nome e a contagem, o resultado seria "apagado"
    // sem dizer o quê, e o usuário não teria como conferir que foi o certo.
    const antes = await lerPainel(ctx.userId, scope.organizationId, a.painelId)
    if ('erro' in antes) throw new Error(antes.erro)

    const r = await apagarPainel({
      userId: ctx.userId, organizationId: scope.organizationId,
      papel: await papelDe(ctx, scope.organizationId),
      painelId: a.painelId,
    })
    if ('erro' in r) throw new Error(r.erro)

    return {
      apagado: true,
      nome: antes.painel.nome,
      blocosRemovidos: antes.painel.blocos.length,
      compartilhamentosRemovidos: antes.painel.compartilhamentos.length,
    }
  },
}

const adicionarBlocoFerramenta: Ferramenta = {
  nome: 'adicionar_bloco',
  titulo: 'Adicionar bloco ao painel',
  descricao:
    'Adicionar, acrescentar ou criar um bloco novo num painel: KPI, gráfico, série temporal, ' +
    'ranking, top N, composição, pizza, indicadores ou texto. É o passo seguinte a criar_painel. ' +
    '**Chame primeiro com `previa: true`**: a ferramenta ' +
    'valida a especificação, executa a consulta uma vez e devolve as linhas — assim você confere o ' +
    'número antes de gravar, sem uma rodada extra. Depois repita com `previa: false`. ' +
    'Tipos: `kpi` (um número com variação), `serie` (evolução no tempo), `ranking` (top N), ' +
    '`composicao` (como um total se divide), `indicador` (os 7 indicadores financeiros), ' +
    '`alertas` (as 8 regras de risco) e `texto`. Os quatro primeiros carregam uma `query` — a MESMA ' +
    'especificação da ferramenta `consultar`, então vale usar `explicar_consulta` para conferi-la. ' +
    'A `largura` é em colunas de 12 (um KPI costuma ser 3; um gráfico, 12). ' +
    'O período do bloco tem duas formas: `herda_do_painel` (padrão) com uma `janela` ancorada no mês ' +
    'que o usuário escolher na tela — mes, ultimos_meses, ultimos_dias ou acumulado —, ou `proprio`, ' +
    'que usa as datas de `query.periodo` literalmente. Exige administrador ou proprietário.',
  entrada: entradaAdicionarBloco,
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as z.infer<typeof entradaAdicionarBloco>
    const scope = await escopoDe(ctx, a.organizationId)

    // A prévia executa a consulta ANTES de qualquer escrita — e o resultado é o
    // que o modelo mostra ao usuário para obter o aceite.
    const dados = await executarBloco(scope, a.spec, { mes: a.mes })

    if (a.previa) {
      return {
        previa: true,
        gravado: false,
        tipo: a.spec.tipo,
        resultado: dados,
        comoAplicar: 'Mostre estes números ao usuário. Com o aceite, repita a MESMA chamada com previa: false.',
      }
    }

    const r = await adicionarBloco({
      userId: ctx.userId, organizationId: scope.organizationId,
      papel: await papelDe(ctx, scope.organizationId),
      painelId: a.painelId, spec: a.spec,
    })
    if ('erro' in r) throw new Error(r.erro)

    return { gravado: true, blocoId: r.id, tipo: a.spec.tipo, resultado: dados }
  },
}

const entradaEditarBloco = alvo.extend({
  painelId: uuid,
  blocoId: uuid,
  spec: blockSpecSchema.describe('A especificação COMPLETA e nova — ela substitui a anterior inteira.'),
  previa: z.boolean().default(false),
  mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
})

const editarBlocoFerramenta: Ferramenta = {
  nome: 'editar_bloco',
  titulo: 'Editar bloco do painel',
  descricao:
    'Editar, alterar ou trocar a consulta, o título, o tamanho ou o visual de um bloco existente. ' +
    'Substitui a especificação de um bloco. A spec enviada é a nova INTEIRA, não um remendo — leia ' +
    'o bloco com ler_painel, altere o que precisa e mande de volta o objeto completo, senão os ' +
    'campos omitidos voltam ao padrão. Aceita `previa: true` do mesmo jeito que adicionar_bloco. ' +
    'Exige administrador ou proprietário.',
  entrada: entradaEditarBloco,
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as z.infer<typeof entradaEditarBloco>
    const scope = await escopoDe(ctx, a.organizationId)

    const dados = await executarBloco(scope, a.spec, { mes: a.mes })
    if (a.previa) {
      return { previa: true, gravado: false, tipo: a.spec.tipo, resultado: dados }
    }

    const r = await editarBloco({
      userId: ctx.userId, organizationId: scope.organizationId,
      papel: await papelDe(ctx, scope.organizationId),
      painelId: a.painelId, blocoId: a.blocoId, spec: a.spec,
    })
    if ('erro' in r) throw new Error(r.erro)
    return { gravado: true, blocoId: a.blocoId, tipo: a.spec.tipo, resultado: dados }
  },
}

const removerBlocoFerramenta: Ferramenta = {
  nome: 'remover_bloco',
  titulo: 'Remover bloco do painel',
  descricao:
    'Tira um bloco do painel. Não apaga dado financeiro nenhum — só a forma de visualizá-lo, e o ' +
    'bloco pode ser recriado com adicionar_bloco. Confirme com o usuário antes. ' +
    'Exige administrador ou proprietário.',
  entrada: alvo.extend({ painelId: uuid, blocoId: uuid }),
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as { organizationId: string; painelId: string; blocoId: string }
    const scope = await escopoDe(ctx, a.organizationId)
    const r = await removerBloco({
      userId: ctx.userId, organizationId: scope.organizationId,
      papel: await papelDe(ctx, scope.organizationId),
      painelId: a.painelId, blocoId: a.blocoId,
    })
    if ('erro' in r) throw new Error(r.erro)
    return { removido: true, blocoId: a.blocoId }
  },
}

const reordenarBlocosFerramenta: Ferramenta = {
  nome: 'reordenar_blocos',
  titulo: 'Reordenar blocos do painel',
  descricao:
    'Define a ordem dos blocos. A lista precisa conter TODOS os ids do painel, exatamente uma vez ' +
    'cada — se faltar ou sobrar um, a chamada é recusada de propósito: significa que alguém mexeu ' +
    'no painel depois que você o leu, e reordenar por cima apagaria uma mudança que você não viu. ' +
    'Leia com ler_painel imediatamente antes. Exige administrador ou proprietário.',
  entrada: alvo.extend({
    painelId: uuid,
    ordem: z.array(uuid).min(1).max(60).describe('Os ids dos blocos, na ordem desejada, TODOS eles.'),
  }),
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as { organizationId: string; painelId: string; ordem: string[] }
    const scope = await escopoDe(ctx, a.organizationId)
    const r = await reordenarBlocos({
      userId: ctx.userId, organizationId: scope.organizationId,
      papel: await papelDe(ctx, scope.organizationId),
      painelId: a.painelId, ordem: a.ordem,
    })
    if ('erro' in r) throw new Error(r.erro)
    return { reordenado: true, total: a.ordem.length }
  },
}

const compartilharPainelFerramenta: Ferramenta = {
  nome: 'compartilhar_painel',
  titulo: 'Compartilhar painel',
  descricao:
    'Dá acesso ao painel: para a empresa inteira (`escopo: "organizacao"`) ou para uma pessoa ' +
    '(`escopo: "usuarios"` com o userId). Permissão "ler" mostra o painel; "editar" também deixa ' +
    'reorganizar os blocos. Apagar e recompartilhar continuam sendo só do dono. ' +
    'Repetir o mesmo alvo ATUALIZA a permissão, não duplica. Só o dono do painel compartilha, e é ' +
    'preciso ser administrador ou proprietário da empresa.',
  entrada: alvo.extend({
    painelId: uuid,
    escopo: z.enum(['organizacao', 'usuarios']),
    usuarioId: uuid.optional().describe('Obrigatório quando escopo = "usuarios". Precisa ser membro ativo.'),
    permissao: z.enum(['ler', 'editar']).default('ler'),
  }),
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as {
      organizationId: string; painelId: string
      escopo: 'organizacao' | 'usuarios'; usuarioId?: string; permissao: 'ler' | 'editar'
    }
    const scope = await escopoDe(ctx, a.organizationId)

    if (a.escopo === 'usuarios' && !a.usuarioId) {
      throw new Error('Compartilhar com uma pessoa exige usuarioId. Para a empresa toda, use escopo "organizacao".')
    }

    const r = await compartilharPainel({
      userId: ctx.userId, organizationId: scope.organizationId,
      papel: await papelDe(ctx, scope.organizationId),
      painelId: a.painelId,
      alvo: a.escopo === 'organizacao'
        ? { escopo: 'organizacao' }
        : { escopo: 'usuarios', userId: a.usuarioId! },
      permissao: a.permissao,
    })
    if ('erro' in r) throw new Error(r.erro)
    return { compartilhado: true, shareId: r.id, permissao: a.permissao }
  },
}

export const FERRAMENTAS_DE_DASHBOARD: Ferramenta[] = [
  listarPaineisFerramenta,
  lerPainelFerramenta,
  criarPainelFerramenta,
  apagarPainelFerramenta,
  adicionarBlocoFerramenta,
  editarBlocoFerramenta,
  removerBlocoFerramenta,
  reordenarBlocosFerramenta,
  compartilharPainelFerramenta,
]
