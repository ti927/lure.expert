// O catálogo de ferramentas.
//
// REGRA DURA: este arquivo e `src/app/api/mcp/**` só importam de `src/lib/**`,
// nunca de `src/server/**`. Todo arquivo de `src/server/` chama `redirect()` sem
// sessão, e `redirect()` lança `NEXT_REDIRECT` — que numa resposta JSON-RPC vira
// exceção crua em vez de erro legível. É a mesma razão de `scope.ts` receber o
// par já resolvido em vez de chamar `getAuthContext()`.
//
// Ferramenta de ESCRITA só é registrada se o consentimento tiver o escopo. Não
// enxergar a ferramenta é mais forte que recusá-la na chamada: o modelo não
// tenta, não erra, e não gasta uma rodada descobrindo que não podia.

import { z } from 'zod'
import { and, eq, isNotNull, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  memberships, organizations, transactions, categories,
  costCenters, businessUnits, legalEntities, contacts,
  allocationTemplates, allocationTemplateLines, budgetVersions,
} from '@/db/schema'
import { scopeFromMcpGrant } from '@/lib/query/scope'
import { runQuery, explicarQuery } from '@/lib/query/engine'
import { querySpecSchema, type QuerySource } from '@/lib/query/spec'
import { fontesDisponiveis } from '@/lib/query/sources'
import { QueryValidationError, ScopeDeniedError } from '@/lib/query/errors'
import {
  assertLeafCategory, filtroLancamentosSchema, resumirClassificacao,
  classificarPorFiltro, idsPorFiltro, TETO_CLASSIFICACAO,
} from '@/lib/transactions-write'
import {
  preverLoteDeRateio, aplicarLoteDeRateio, MAX_LOTE, MAX_PARTES,
  type AllocationWeight,
} from '@/lib/allocations-write'
import { normalizeWeights, formatProportion } from '@/lib/allocation-math'
import { preverSerie, criarSerie, preverCopia, aplicarCopia } from '@/lib/budget-write'
import {
  listarRegras, planejarRegras, aplicarRegras, assinaturaDoPlano,
  regraDeLoteSchema, MAX_REGRAS_POR_LOTE, CONTADOR_VIVO_DESDE, type RegraDeLote,
} from '@/lib/rules-write'
import {
  linhaImportadaSchema, planejarImportacao, aplicarImportacao,
  MAX_LINHAS_IMPORTACAO, type LinhaImportada,
} from '@/lib/import-write'
import {
  cabecalhoDoArquivoSchema, TIPOS_DE_RELATORIO, TIPOS_DE_CONTA, ROTULO_DE_CONTA,
} from '@/lib/import-contract'
import { listarContasUsadas, mapaDeContasManuais } from '@/lib/accounts'
import { sendCategorizationEvents } from '@/lib/inngest'
import type { BudgetSeriesInput, CopyActualsInput } from '@/lib/budget-types'
import {
  registrarPrevia, consumirPrevia, divergiu, registrarAplicacao,
  exigirConfirmacao, PALAVRA_DE_CONFIRMACAO,
} from './preview'
import type { Escopo } from '@/lib/oauth/clients'
import { FERRAMENTAS_DE_DASHBOARD } from './dashboard-tools'
// `Ferramenta` e `ContextoMcp` mudaram para `tools-types.ts` na 5.D, porque o
// grupo de dashboard vive noutro arquivo e precisa dos mesmos tipos sem fechar
// um ciclo de importação. Reexportados aqui: os consumidores não mudam.
import type { Ferramenta, ContextoMcp } from './tools-types'
export type { Ferramenta, ContextoMcp }

const uuid = z.string().uuid()

const alvo = z.object({
  organizationId: uuid.describe(
    'Empresa sobre a qual consultar. Use listar_organizacoes para obter os ids disponíveis.',
  ),
})

/**
 * O funil, aplicado a toda ferramenta que toca dado.
 *
 * O `organizationId` que chega no corpo só PROPÕE: `scopeFromMcpGrant` confere
 * contra o que o humano marcou na tela E contra a membership viva, que pode ter
 * sido revogada depois do consentimento.
 */
async function escopoDe(ctx: ContextoMcp, organizationId: string) {
  return scopeFromMcpGrant({ userId: ctx.userId, organizationIds: ctx.organizationIds }, organizationId)
}

// ─────────────────────────────────────────────────────────────────────────────

const listarOrganizacoes: Ferramenta = {
  nome: 'listar_organizacoes',
  titulo: 'Listar empresas',
  descricao:
    'As empresas que esta conexão pode acessar. Toda outra ferramenta exige o organizationId ' +
    'devolvido aqui. Comece por esta.',
  entrada: z.object({}),
  escopo: 'leitura',
  async executar(_args, ctx) {
    if (ctx.organizationIds.length === 0) return { organizacoes: [] }

    // Junta com `memberships` em vez de confiar só no consentimento: o vínculo
    // pode ter sido revogado depois de o humano autorizar, e o token viveria
    // mais que o acesso.
    const linhas = await db
      .select({
        id: organizations.id,
        nome: organizations.name,
        cnpj: organizations.cnpj,
        papel: memberships.role,
      })
      .from(organizations)
      .innerJoin(memberships, eq(memberships.organizationId, organizations.id))
      .where(and(
        inArray(organizations.id, ctx.organizationIds),
        eq(memberships.userId, ctx.userId),
        isNotNull(memberships.acceptedAt),
      ))

    return { organizacoes: linhas }
  },
}

const descreverOrganizacao: Ferramenta = {
  nome: 'descrever_organizacao',
  titulo: 'Descrever empresa',
  descricao:
    'Contexto de uma empresa antes de consultar: período com dados, quantidade de lançamentos, ' +
    'quantos ainda estão sem natureza, e o plano de contas. Útil para não pedir um período vazio.',
  entrada: alvo,
  escopo: 'leitura',
  async executar(args, ctx) {
    const scope = await escopoDe(ctx, String(args.organizationId))

    const [org] = await db
      .select({ nome: organizations.name, cnpj: organizations.cnpj })
      .from(organizations)
      .where(eq(organizations.id, scope.organizationId))
      .limit(1)

    const [resumo] = await db
      .select({
        lancamentos: sql<number>`COUNT(*)::int`,
        semNatureza: sql<number>`COUNT(*) FILTER (WHERE ${transactions.categoryId} IS NULL)::int`,
        primeira: sql<string | null>`MIN(${transactions.date})::text`,
        ultima: sql<string | null>`MAX(${transactions.date})::text`,
      })
      .from(transactions)
      .where(eq(transactions.organizationId, scope.organizationId))

    // `isActive` para bater com `listar_categorias`, que sempre filtrou por ele.
    // Sem o filtro, as duas ferramentas anunciavam contagens diferentes do MESMO
    // plano de contas (80 × 79 no diagnóstico de 26/ago, achado 5) — e uma
    // natureza inativa não é destino de classificação, então a contagem que
    // importa é a das ativas.
    const [plano] = await db
      .select({ naturezas: sql<number>`COUNT(*)::int` })
      .from(categories)
      .where(and(
        eq(categories.organizationId, scope.organizationId),
        eq(categories.isActive, true),
      ))

    return {
      id: scope.organizationId,
      nome: org?.nome ?? null,
      cnpj: org?.cnpj ?? null,
      papel: scope.role,
      lancamentos: Number(resumo?.lancamentos ?? 0),
      semNatureza: Number(resumo?.semNatureza ?? 0),
      periodoComDados: resumo?.primeira ? { de: resumo.primeira, ate: resumo.ultima } : null,
      naturezasCadastradas: Number(plano?.naturezas ?? 0),
    }
  },
}

/**
 * As fontes que o MCP anuncia saem do REGISTRO do motor, não do enum do Zod.
 *
 * O enum tem quatro (`balanco` incluída), mas o registro tem três — o balanço
 * ficou de fora de propósito, por ser snapshot por documento e não haver um
 * documento no banco para conferir contra. Publicar as quatro fazia o modelo
 * oferecer balanço ao usuário com confiança e só descobrir na chamada que ela
 * não existe. Anunciar menos do que o tipo permite é o certo aqui: o catálogo
 * tem de descrever o que o servidor FAZ, não o que ele um dia fará.
 */
const FONTES = fontesDisponiveis() as [QuerySource, ...QuerySource[]]

const entradaConsulta = querySpecSchema.extend({
  ...alvo.shape,
  fonte: z.enum(FONTES).default('realizado').describe(
    'realizado = lançamentos efetivados; orcado = o planejado; nfe = notas fiscais. ' +
    'O balanço patrimonial ainda não é consultável por aqui.',
  ),
})

const consultar: Ferramenta = {
  nome: 'consultar',
  titulo: 'Consultar números',
  descricao:
    'A consulta analítica do lure.expert: soma, agrupa e ordena sobre realizado, orçado ou NF-e. ' +
    'Responde perguntas como "top 5 unidades de negócio por despesa em 2026" ' +
    '(agruparPor: ["unidade_de_negocio"], medidas: ["saidas"], ordenarPor por saidas desc, limite 5). ' +
    'Regime "competencia" é a data do fato (alimenta a DRE); "caixa" é a data em que o dinheiro ' +
    'se moveu (alimenta o fluxo). Respeita rateio: um lançamento repartido entre centros de custo ' +
    'entra proporcionalmente em cada um, e a contagem continua sendo de lançamentos, não de partes.',
  entrada: entradaConsulta,
  escopo: 'leitura',
  async executar(args, ctx) {
    const { organizationId, ...spec } = args as Record<string, unknown>
    const scope = await escopoDe(ctx, String(organizationId))
    return runQuery(scope, spec as never)
  },
}

const explicarConsulta: Ferramenta = {
  nome: 'explicar_consulta',
  titulo: 'Explicar consulta',
  descricao:
    'Resolve uma consulta sem executá-la: devolve o período concreto, o regime, os agrupamentos e ' +
    'as medidas que seriam usados. Serve para conferir um pedido caro ou ambíguo antes de rodar. ' +
    'Exige o mesmo organizationId de `consultar` — conferir o plano contra uma empresa e executar ' +
    'contra outra daria um resultado certo para a pergunta errada.',
  // `organizationId` era OPCIONAL e, pior, ignorado: `explicarQuery` é pura e
  // não toca o banco, então a chamada "funcionava" sem empresa nenhuma. Num
  // consentimento com várias empresas isso é a pior forma de falha — a
  // ferramenta que existe para VALIDAR era a única que não validava, e o modelo
  // recebia confirmação de um plano que ninguém conferiu contra o escopo.
  // Achado 3 do diagnóstico de 26/ago.
  entrada: entradaConsulta,
  escopo: 'leitura',
  async executar(args, ctx) {
    const { organizationId, ...spec } = args as Record<string, unknown>
    // O escopo não entra no cálculo (a explicação é pura), mas a checagem
    // precisa acontecer: sem ela, "explicar" aceitaria uma empresa que a
    // conexão não alcança e devolveria um plano com ar de aprovado.
    await escopoDe(ctx, String(organizationId))
    return explicarQuery(spec as never)
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogos — o que o modelo precisa ler ANTES de escrever
// ─────────────────────────────────────────────────────────────────────────────

const listarCategorias: Ferramenta = {
  nome: 'listar_categorias',
  titulo: 'Listar naturezas',
  descricao:
    'O plano de contas. Três níveis (Tipo → Natureza pai → Natureza filho), e **só natureza filho ' +
    'pode ser atribuída a um lançamento** — `atribuivel: true` marca quais. Chame antes de ' +
    'classificar qualquer coisa: sem o id daqui não há como dizer para onde vai.',
  entrada: alvo.extend({
    busca: z.string().trim().min(2).max(60).optional()
      .describe('Filtra por nome ou código, sem diferenciar maiúsculas.'),
  }),
  escopo: 'leitura',
  async executar(args, ctx) {
    const scope = await escopoDe(ctx, String(args.organizationId))
    const busca = typeof args.busca === 'string' ? `%${args.busca}%` : null

    const linhas = await db
      .select({
        id: categories.id,
        codigo: categories.code,
        nome: categories.name,
        tipo: categories.type,
        paiId: categories.parentId,
        opexCapex: categories.opexCapex,
        // `${categories}.id` e NÃO `${categories.id}` — ver a nota em
        // `lib/sql-dimensions.ts`. Nesta consulta não há join, então o Drizzle
        // emitiria `"id"` puro na lista do SELECT, e dentro do EXISTS o alias
        // `f` venceria: `f.parent_id = f.id`, sempre falso. `atribuivel` vivia
        // TRUE para tudo, e o modelo recebia natureza pai como destino válido.
        atribuivel: sql<boolean>`NOT EXISTS (
          SELECT 1 FROM ${categories} f WHERE f.parent_id = ${categories}.id
        )`,
      })
      .from(categories)
      .where(and(
        eq(categories.organizationId, scope.organizationId),
        eq(categories.isActive, true),
        ...(busca ? [sql`(${categories.name} ILIKE ${busca} OR ${categories.code} ILIKE ${busca})`] : []),
      ))
      .orderBy(categories.code)
      .limit(400)

    return { naturezas: linhas, total: linhas.length }
  },
}

const listarContas: Ferramenta = {
  nome: 'listar_contas',
  titulo: 'Listar contas',
  descricao:
    'As contas e cartões que aparecem nos lançamentos: id, nome, tipo, número, quantos lançamentos ' +
    'e o período. É o que traduz um `contaId` cru (que `listar_regras` e `consultar` devolvem) em ' +
    'algo legível, e o que permite preencher `filtros.contas` sem adivinhar. ' +
    '`contasSemUso` traz as contas cadastradas que ainda não têm lançamento — é nelas que se pode ' +
    'importar citando o nome, e sem esta lista uma conta recém-criada seria invisível. ' +
    '`nomeAmbiguo: true` marca contas que dividem o mesmo nome com outra — nesse caso use o número ' +
    'ou o período para desempatar, e NUNCA suponha qual é qual pelo nome.',
  entrada: alvo,
  escopo: 'leitura',
  async executar(args, ctx) {
    const scope = await escopoDe(ctx, String(args.organizationId))
    const [contas, cadastro] = await Promise.all([
      listarContasUsadas(scope.organizationId),
      mapaDeContasManuais(scope.organizationId),
    ])
    const usadas = new Set(contas.map(c => c.accountId))
    const semUso = Array.from(cadastro.values())
      .filter(c => !usadas.has(c.accountId))
      .map(c => ({ accountId: c.accountId, nome: c.nome, tipo: c.tipo, numero: c.numero }))
    const ambiguas = contas.filter(c => c.nomeAmbiguo).length
    return {
      contas,
      total: contas.length,
      ...(semUso.length > 0 ? { contasSemUso: semUso } : {}),
      ...(ambiguas > 0 ? {
        aviso: `${ambiguas} conta(s) dividem o nome com outra. Desempate pelo número ou pelo ` +
          'período antes de usar o id em qualquer filtro.',
      } : {}),
    }
  },
}

const listarDimensoes: Ferramenta = {
  nome: 'listar_dimensoes',
  titulo: 'Listar dimensões',
  descricao:
    'Centros de custo, unidades de negócio, entidades jurídicas e contatos (clientes/fornecedores) ' +
    'cadastrados. São as quatro dimensões que classificam um lançamento além da natureza.',
  entrada: alvo.extend({
    quais: z.array(z.enum(['centro_de_custo', 'unidade_de_negocio', 'entidade_legal', 'contato']))
      .optional().describe('Omitido, devolve as quatro.'),
    busca: z.string().trim().min(2).max(60).optional(),
  }),
  escopo: 'leitura',
  async executar(args, ctx) {
    const scope = await escopoDe(ctx, String(args.organizationId))
    const quais = (args.quais as string[] | undefined) ?? [
      'centro_de_custo', 'unidade_de_negocio', 'entidade_legal', 'contato',
    ]
    const busca = typeof args.busca === 'string' ? `%${args.busca}%` : null
    const saida: Record<string, unknown> = {}

    const simples = async (tabela: typeof costCenters | typeof businessUnits | typeof legalEntities) =>
      db.select({ id: tabela.id, nome: tabela.name, codigo: tabela.code })
        .from(tabela)
        .where(and(
          eq(tabela.organizationId, scope.organizationId),
          eq(tabela.isActive, true),
          ...(busca ? [sql`${tabela.name} ILIKE ${busca}`] : []),
        ))
        .orderBy(tabela.name)
        .limit(200)

    if (quais.includes('centro_de_custo'))    saida.centrosDeCusto    = await simples(costCenters)
    if (quais.includes('unidade_de_negocio')) saida.unidadesDeNegocio = await simples(businessUnits)
    if (quais.includes('entidade_legal'))     saida.entidadesLegais   = await simples(legalEntities)

    if (quais.includes('contato')) {
      saida.contatos = await db
        .select({
          id: contacts.id,
          nome: contacts.name,
          // O extrato bancário traz o nome fantasia muito mais que a razão
          // social — é por ele que o casamento costuma acontecer.
          nomeFantasia: contacts.tradeName,
          documento: contacts.document,
          cliente: contacts.isCustomer,
          fornecedor: contacts.isSupplier,
        })
        .from(contacts)
        .where(and(
          eq(contacts.organizationId, scope.organizationId),
          eq(contacts.isActive, true),
          ...(busca ? [sql`(${contacts.name} ILIKE ${busca} OR ${contacts.tradeName} ILIKE ${busca})`] : []),
        ))
        .orderBy(contacts.name)
        .limit(200)
    }

    return saida
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Escrita — sempre em par prever_ → aplicar_
// ─────────────────────────────────────────────────────────────────────────────

const FERRAMENTA_CLASSIFICACAO = 'classificacao_em_lote'

const destinoClassificacao = z.object({
  categoryId:     z.string().uuid().nullable().optional()
    .describe('Natureza de destino. Só natureza FILHO — veja listar_categorias.'),
  costCenterId:   z.string().uuid().nullable().optional(),
  businessUnitId: z.string().uuid().nullable().optional(),
  legalEntityId:  z.string().uuid().nullable().optional(),
  contactId:      z.string().uuid().nullable().optional(),
}).refine(d => Object.values(d).some(v => v !== undefined),
  'Informe ao menos uma dimensão de destino.')

const entradaPreverClassificacao = alvo.extend({
  filtro: filtroLancamentosSchema,
  destino: destinoClassificacao,
  criarRegras: z.boolean().default(true).describe(
    'Cria uma regra por descrição única, para futuras importações caírem sozinhas no mesmo lugar.',
  ),
})

const preverClassificacao: Ferramenta = {
  nome: 'prever_classificacao_em_lote',
  titulo: 'Prever classificação em lote',
  descricao:
    'Mostra o que uma reclassificação em lote faria, SEM fazer. Devolve quantos lançamentos, ' +
    'quanto somam, uma amostra e quantas regras seriam criadas. Apresente esse resumo ao usuário ' +
    'e obtenha o aceite dele ANTES de chamar aplicar_classificacao_em_lote.',
  entrada: entradaPreverClassificacao,
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as z.infer<typeof entradaPreverClassificacao>
    const scope = await escopoDe(ctx, a.organizationId)

    if (a.destino.categoryId) {
      const erroCat = await assertLeafCategory(a.destino.categoryId, scope.organizationId)
      if (erroCat) throw new Error(erroCat)
    }

    const resumo = await resumirClassificacao(scope.organizationId, a.filtro, a.destino)

    if (resumo.quantidade === 0) {
      return {
        previaId: null,
        resumo,
        aviso: 'Nenhum lançamento casa com este filtro. Não há o que aplicar.',
      }
    }
    if (resumo.excedeTeto) {
      return {
        previaId: null,
        resumo,
        aviso: `O filtro atinge ${resumo.quantidade} lançamentos e o teto por operação é ` +
          `${TETO_CLASSIFICACAO}. Estreite o filtro — por período, por conta ou por valor.`,
      }
    }

    const { previaId, expiraEm } = await registrarPrevia({
      organizationId: scope.organizationId,
      ferramenta: FERRAMENTA_CLASSIFICACAO,
      userId: ctx.userId,
      clientId: ctx.clientId,
      resumo: { ...resumo },
      pedido: { filtro: a.filtro, destino: a.destino, criarRegras: a.criarRegras },
    })

    return {
      previaId,
      expiraEm,
      resumo,
      ...(resumo.rateadosExcluidos > 0 ? {
        aviso: `${resumo.rateadosExcluidos} lançamento(s) rateado(s) ficaram de fora: com rateio, ` +
          'as dimensões ficam nas partes, não no lançamento. A natureza deles pode ser alterada normalmente.',
      } : {}),
      comoAplicar: `Mostre este resumo ao usuário. Com o aceite dele, chame ` +
        `aplicar_classificacao_em_lote com previaId e confirmacao: "${PALAVRA_DE_CONFIRMACAO}".`,
    }
  },
}

const aplicarClassificacao: Ferramenta = {
  nome: 'aplicar_classificacao_em_lote',
  titulo: 'Aplicar classificação em lote',
  descricao:
    'Aplica a reclassificação de uma prévia. Exige o previaId e a palavra literal "aplicar". ' +
    'Recalcula do zero e RECUSA se o conjunto mudou desde a prévia — nesse caso, gere outra. ' +
    'Só chame depois de o usuário ter visto o resumo e concordado.',
  entrada: alvo.extend({
    previaId: z.string().uuid(),
    confirmacao: z.string().describe('A palavra literal "aplicar".'),
  }),
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as { organizationId: string; previaId: string; confirmacao: string }
    const scope = await escopoDe(ctx, a.organizationId)

    const falta = exigirConfirmacao(a.confirmacao)
    if (falta) throw new Error(falta)

    const previa = await consumirPrevia({
      previaId: a.previaId,
      ferramenta: FERRAMENTA_CLASSIFICACAO,
      organizationId: scope.organizationId,
      userId: ctx.userId,
    })
    if (!previa.ok) throw new Error(previa.motivo)

    const pedido = previa.pedido as {
      filtro: Parameters<typeof resumirClassificacao>[1]
      destino: Parameters<typeof resumirClassificacao>[2]
      criarRegras?: boolean
    }

    // Recalcula. Se o mundo mudou entre prever e aplicar, recusa — aplicar
    // sobre uma fotografia velha é como se apaga o trabalho de outra pessoa.
    const agora = await resumirClassificacao(scope.organizationId, pedido.filtro, pedido.destino)
    const problema = divergiu(previa.resumo, agora)
    if (problema) throw new Error(problema)

    const inicio = Date.now()
    const r = await classificarPorFiltro(scope.organizationId, pedido.filtro, pedido.destino, {
      criarRegras: pedido.criarRegras !== false,
    })

    await registrarAplicacao({
      organizationId: scope.organizationId,
      ferramenta: FERRAMENTA_CLASSIFICACAO,
      previaId: a.previaId,
      userId: ctx.userId,
      clientId: ctx.clientId,
      resultado: { ...r },
      duracaoMs: Date.now() - inicio,
    })

    return {
      aplicado: true,
      lancamentosAtualizados: r.atualizados,
      regrasAfetadas: r.regrasAfetadas,
      observacao: r.regrasAfetadas > 0
        ? `${r.regrasAfetadas} regra(s) gravada(s): importações futuras com a mesma descrição caem sozinhas neste destino.`
        : undefined,
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Rateio
// ─────────────────────────────────────────────────────────────────────────────

const listarModelosDeRateio: Ferramenta = {
  nome: 'listar_modelos_de_rateio',
  titulo: 'Listar modelos de rateio',
  descricao:
    'Modelos de rateio salvos. Um modelo guarda PROPORÇÃO, nunca valor — o mesmo serve ao aluguel ' +
    'de R$ 12.000 e à conta de luz de R$ 340. Use o id de um deles em prever_rateio_em_lote no ' +
    'lugar de informar pesos à mão.',
  entrada: alvo,
  escopo: 'leitura',
  async executar(args, ctx) {
    const scope = await escopoDe(ctx, String(args.organizationId))

    const modelos = await db
      .select({ id: allocationTemplates.id, nome: allocationTemplates.name })
      .from(allocationTemplates)
      .where(and(
        eq(allocationTemplates.organizationId, scope.organizationId),
        eq(allocationTemplates.isActive, true),
      ))
      .orderBy(allocationTemplates.name)
      .limit(100)

    if (modelos.length === 0) return { modelos: [] }

    const linhas = await db
      .select({
        templateId: allocationTemplateLines.templateId,
        peso: allocationTemplateLines.weight,
        costCenterId: allocationTemplateLines.costCenterId,
        businessUnitId: allocationTemplateLines.businessUnitId,
        legalEntityId: allocationTemplateLines.legalEntityId,
        contactId: allocationTemplateLines.contactId,
      })
      .from(allocationTemplateLines)
      .where(inArray(allocationTemplateLines.templateId, modelos.map(m => m.id)))
      .orderBy(allocationTemplateLines.sequence)

    return {
      modelos: modelos.map(m => {
        const minhas = linhas.filter(l => l.templateId === m.id)
        const pcts = normalizeWeights(minhas.map(l => Number(l.peso)))
        return {
          id: m.id,
          nome: m.nome,
          partes: minhas.map((l, i) => ({
            percentual: pcts[i],
            costCenterId: l.costCenterId,
            businessUnitId: l.businessUnitId,
            legalEntityId: l.legalEntityId,
            contactId: l.contactId,
          })),
        }
      }),
    }
  },
}

const FERRAMENTA_RATEIO = 'rateio_em_lote'

const pesoDeEntrada = z.object({
  peso: z.number().positive().describe(
    'Peso RELATIVO, não percentual fechado: 60 e 40 é a mesma divisão que 6 e 4. ' +
    'Não precisa somar 100.',
  ),
  costCenterId:   z.string().uuid().nullable().default(null),
  businessUnitId: z.string().uuid().nullable().default(null),
  legalEntityId:  z.string().uuid().nullable().default(null),
  contactId:      z.string().uuid().nullable().default(null),
})

const entradaPreverRateio = alvo.extend({
  filtro: filtroLancamentosSchema,
  modeloId: z.string().uuid().optional()
    .describe('Um modelo de listar_modelos_de_rateio. Use isto OU pesos, não os dois.'),
  pesos: z.array(pesoDeEntrada).min(1).max(MAX_PARTES).optional(),
})

const preverRateio: Ferramenta = {
  nome: 'prever_rateio_em_lote',
  titulo: 'Prever rateio em lote',
  descricao:
    'Mostra como um rateio repartiria os lançamentos, SEM gravar. Cada lançamento é repartido pelo ' +
    'método do maior resto, então fecha no centavo exato — e a prévia mostra onde a sobra caiu. ' +
    'Rateio SUBSTITUI o que já existir no lançamento; a prévia diz quantos já eram rateados. ' +
    'Apresente o resumo ao usuário e obtenha o aceite antes de aplicar.',
  entrada: entradaPreverRateio,
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as z.infer<typeof entradaPreverRateio>
    const scope = await escopoDe(ctx, a.organizationId)

    const pesos = await resolverPesos(scope.organizationId, a.modeloId, a.pesos)

    const ids = await idsPorFiltro(scope.organizationId, a.filtro, MAX_LOTE + 1)
    if (ids.length === 0) {
      return { previaId: null, aviso: 'Nenhum lançamento casa com este filtro. Não há o que ratear.' }
    }
    if (ids.length > MAX_LOTE) {
      return {
        previaId: null,
        aviso: `O filtro atinge mais de ${MAX_LOTE} lançamentos, que é o teto por operação. ` +
          'Estreite o filtro — por período, por conta ou por valor.',
      }
    }

    const previsao = await preverLoteDeRateio(scope.organizationId, ids, pesos)
    if ('error' in previsao) throw new Error(previsao.error)

    const valorTotal = previsao.rows.reduce((s, r) => s + r.amount, 0)
    const resumo = {
      quantidade: previsao.rows.length,
      valorTotal,
      jaRateados: previsao.jaRateados,
      partesPorLancamento: pesos.length,
      proporcao: formatProportion(pesos.map(p => p.weight)),
      amostra: previsao.rows.slice(0, 5).map(r => ({
        data: r.date, descricao: r.description, valor: r.amount, partes: r.parts,
      })),
    }

    const { previaId, expiraEm } = await registrarPrevia({
      organizationId: scope.organizationId,
      ferramenta: FERRAMENTA_RATEIO,
      userId: ctx.userId,
      clientId: ctx.clientId,
      resumo,
      pedido: { filtro: a.filtro, pesos, modeloId: a.modeloId ?? null },
    })

    return {
      previaId,
      expiraEm,
      resumo,
      ...(previsao.jaRateados > 0 ? {
        aviso: `${previsao.jaRateados} lançamento(s) já têm rateio e serão SUBSTITUÍDOS. ` +
          'O rateio anterior deles se perde.',
      } : {}),
      comoAplicar: `Mostre este resumo ao usuário. Com o aceite dele, chame ` +
        `aplicar_rateio_em_lote com previaId e confirmacao: "${PALAVRA_DE_CONFIRMACAO}".`,
    }
  },
}

const aplicarRateio: Ferramenta = {
  nome: 'aplicar_rateio_em_lote',
  titulo: 'Aplicar rateio em lote',
  descricao:
    'Aplica o rateio de uma prévia. Exige o previaId e a palavra literal "aplicar". Recalcula do ' +
    'zero e RECUSA se o conjunto mudou desde a prévia. Só chame com o aceite do usuário.',
  entrada: alvo.extend({
    previaId: z.string().uuid(),
    confirmacao: z.string().describe('A palavra literal "aplicar".'),
  }),
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as { organizationId: string; previaId: string; confirmacao: string }
    const scope = await escopoDe(ctx, a.organizationId)

    const falta = exigirConfirmacao(a.confirmacao)
    if (falta) throw new Error(falta)

    const previa = await consumirPrevia({
      previaId: a.previaId,
      ferramenta: FERRAMENTA_RATEIO,
      organizationId: scope.organizationId,
      userId: ctx.userId,
    })
    if (!previa.ok) throw new Error(previa.motivo)

    const pedido = previa.pedido as {
      filtro: Parameters<typeof idsPorFiltro>[1]
      pesos: AllocationWeight[]
      modeloId: string | null
    }

    const ids = await idsPorFiltro(scope.organizationId, pedido.filtro, MAX_LOTE + 1)
    const conferencia = await preverLoteDeRateio(scope.organizationId, ids.slice(0, MAX_LOTE), pedido.pesos)
    if ('error' in conferencia) throw new Error(conferencia.error)

    const problema = divergiu(previa.resumo, {
      quantidade: conferencia.rows.length,
      valorTotal: conferencia.rows.reduce((s, r) => s + r.amount, 0),
    })
    if (problema) throw new Error(problema)

    const inicio = Date.now()
    const r = await aplicarLoteDeRateio(
      scope.organizationId, ids.slice(0, MAX_LOTE), pedido.pesos, pedido.modeloId,
    )
    if ('error' in r) throw new Error(r.error)

    await registrarAplicacao({
      organizationId: scope.organizationId,
      ferramenta: FERRAMENTA_RATEIO,
      previaId: a.previaId,
      userId: ctx.userId,
      clientId: ctx.clientId,
      resultado: { aplicados: r.aplicados },
      duracaoMs: Date.now() - inicio,
    })

    return {
      aplicado: true,
      lancamentosRateados: r.aplicados,
      observacao: 'As dimensões passaram para as partes; o lançamento em si ficou sem dimensão, ' +
        'como o modelo de rateio exige. A natureza não é rateada e continua no lançamento.',
    }
  },
}

/** Pesos vindos do modelo ou informados à mão — nunca os dois. */
async function resolverPesos(
  organizationId: string,
  modeloId: string | undefined,
  pesos: z.infer<typeof pesoDeEntrada>[] | undefined,
): Promise<AllocationWeight[]> {
  if (modeloId && pesos) {
    throw new Error('Informe modeloId OU pesos, não os dois — não há como saber qual deve valer.')
  }
  if (pesos?.length) {
    return pesos.map(p => ({
      weight: p.peso,
      costCenterId: p.costCenterId ?? null,
      businessUnitId: p.businessUnitId ?? null,
      legalEntityId: p.legalEntityId ?? null,
      contactId: p.contactId ?? null,
    }))
  }
  if (!modeloId) throw new Error('Informe modeloId ou pesos.')

  const linhas = await db
    .select({
      peso: allocationTemplateLines.weight,
      costCenterId: allocationTemplateLines.costCenterId,
      businessUnitId: allocationTemplateLines.businessUnitId,
      legalEntityId: allocationTemplateLines.legalEntityId,
      contactId: allocationTemplateLines.contactId,
    })
    .from(allocationTemplateLines)
    .innerJoin(allocationTemplates, eq(allocationTemplates.id, allocationTemplateLines.templateId))
    .where(and(
      eq(allocationTemplateLines.templateId, modeloId),
      // A junção com o modelo existe só para provar a organização: sem ela, um
      // id de modelo alheio traria as linhas dele.
      eq(allocationTemplates.organizationId, organizationId),
    ))
    .orderBy(allocationTemplateLines.sequence)

  if (linhas.length === 0) throw new Error('Modelo de rateio não encontrado nesta empresa.')

  return linhas.map(l => ({
    weight: Number(l.peso),
    costCenterId: l.costCenterId,
    businessUnitId: l.businessUnitId,
    legalEntityId: l.legalEntityId,
    contactId: l.contactId,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Orçamento
// ─────────────────────────────────────────────────────────────────────────────

const listarVersoesDeOrcamento: Ferramenta = {
  nome: 'listar_versoes_de_orcamento',
  titulo: 'Listar versões de orçamento',
  descricao:
    'As versões de orçamento da empresa. Cada versão é um exercício (ano civil) com um estado: ' +
    'rascunho, aprovado ou arquivado — arquivada é somente leitura. Toda escrita de orçamento ' +
    'exige o versionId de uma versão daqui.',
  entrada: alvo,
  escopo: 'leitura',
  async executar(args, ctx) {
    const scope = await escopoDe(ctx, String(args.organizationId))
    const linhas = await db
      .select({
        id: budgetVersions.id,
        nome: budgetVersions.name,
        exercicio: budgetVersions.fiscalYear,
        estado: budgetVersions.status,
        ativa: budgetVersions.isActive,
      })
      .from(budgetVersions)
      .where(eq(budgetVersions.organizationId, scope.organizationId))
      .orderBy(budgetVersions.fiscalYear, budgetVersions.name)
      .limit(100)
    return { versoes: linhas }
  },
}

const FERRAMENTA_ORCADO = 'lancamento_de_orcamento'
const FERRAMENTA_COPIA  = 'copia_do_realizado'

/**
 * Entrada amigável ao modelo, não o schema interno.
 *
 * `budgetSeriesInputSchema` tem 20 campos sem default, porque o diálogo da tela
 * os preenche. Jogá-lo cru no catálogo faria o modelo inventar `adjustmentEvery`
 * e `seasonalAmounts` em toda chamada. Aqui a entrada descreve o caso comum — um
 * valor por mês, N meses — e o modo é DEDUZIDO de qual campo de valor veio.
 */
const entradaLancamentoOrcado = alvo.extend({
  versionId: z.string().uuid(),
  descricao: z.string().trim().min(1).max(200),
  categoryId: z.string().uuid().describe('Natureza folha — veja listar_categorias.'),
  direcao: z.enum(['inflow', 'outflow']).describe('inflow para entrada, outflow para saída.'),
  mesInicial: z.string().regex(/^\d{4}-\d{2}$/).describe('AAAA-MM'),
  ocorrencias: z.number().int().min(1).max(12).default(12),

  valorMensal: z.number().nonnegative().optional()
    .describe('O mesmo valor todo mês. Com reajustePct, passa a subir periodicamente.'),
  valorTotal: z.number().nonnegative().optional()
    .describe('Um total dividido entre as ocorrências (parcelado).'),
  valoresMensais: z.array(z.number().nonnegative()).min(1).max(12).optional()
    .describe('Um valor por ocorrência, na ordem (sazonal).'),
  reajustePct: z.number().optional().describe('Em pontos percentuais: 5 = +5%.'),
  reajusteACadaMeses: z.number().int().min(1).default(12),

  intervaloMeses: z.number().int().min(1).max(12).default(1)
    .describe('1 = mensal, 3 = trimestral.'),
  diaDoMes: z.number().int().min(1).max(31).default(1),
  prazoDeCaixaDias: z.number().int().min(0).max(365).default(0)
    .describe('Dias entre a competência e o caixa. 30 = recebe/paga 30 dias depois.'),

  costCenterId:   z.string().uuid().nullable().default(null),
  businessUnitId: z.string().uuid().nullable().default(null),
  legalEntityId:  z.string().uuid().nullable().default(null),
  contactId:      z.string().uuid().nullable().default(null),
  observacao: z.string().trim().max(500).nullable().default(null),
})

function montarSerie(a: z.infer<typeof entradaLancamentoOrcado>): BudgetSeriesInput {
  const informados = [a.valorMensal, a.valorTotal, a.valoresMensais].filter(v => v !== undefined)
  if (informados.length === 0) {
    throw new Error('Informe valorMensal, valorTotal ou valoresMensais.')
  }
  if (informados.length > 1) {
    throw new Error('Informe apenas UM entre valorMensal, valorTotal e valoresMensais.')
  }

  const modo = a.valoresMensais ? 'sazonal'
    : a.valorTotal !== undefined ? 'parcelado'
    : a.reajustePct ? 'reajuste'
    : 'fixo'

  return {
    versionId: a.versionId,
    description: a.descricao,
    direction: a.direcao,
    categoryId: a.categoryId,
    costCenterId: a.costCenterId,
    businessUnitId: a.businessUnitId,
    legalEntityId: a.legalEntityId,
    contactId: a.contactId,
    startMonth: a.mesInicial,
    occurrences: a.valoresMensais ? a.valoresMensais.length : a.ocorrencias,
    intervalMonths: a.intervaloMeses,
    dayOfMonth: a.diaDoMes,
    cashLagDays: a.prazoDeCaixaDias,
    amountMode: modo,
    baseAmount: a.valorMensal ?? null,
    totalAmount: a.valorTotal ?? null,
    // O schema interno guarda fração decimal; a entrada fala em pontos
    // percentuais, que é como uma pessoa diz "5%".
    adjustmentRate: a.reajustePct === undefined ? null : a.reajustePct / 100,
    adjustmentEvery: a.reajusteACadaMeses,
    seasonalAmounts: a.valoresMensais ?? null,
    notes: a.observacao,
  }
}

const preverLancamentoOrcado: Ferramenta = {
  nome: 'prever_lancamento_de_orcamento',
  titulo: 'Prever lançamento de orçamento',
  descricao:
    'Criar, orçar, planejar ou lançar uma despesa/receita no ORÇAMENTO: valor mensal fixo, ' +
    'parcelado, sazonal ou com reajuste. É o primeiro passo — mostra as ocorrências que o ' +
    'lançamento geraria, SEM gravar, e devolve o previaId que `aplicar_lancamento_de_orcamento` ' +
    'exige. Mês a mês, com a data de competência e a de caixa de cada ocorrência. ' +
    'Duas datas por ocorrência é o desenho do orçamento — competência alimenta a DRE orçada, caixa ' +
    'alimenta o fluxo projetado. Apresente ao usuário e obtenha o aceite antes de aplicar.',
  entrada: entradaLancamentoOrcado,
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as z.infer<typeof entradaLancamentoOrcado>
    const scope = await escopoDe(ctx, a.organizationId)

    const serie = montarSerie(a)
    const previsto = await preverSerie(scope.organizationId, serie)
    if ('error' in previsto) throw new Error(previsto.error)

    const resumo = {
      quantidade: previsto.ocorrencias.length,
      valorTotal: previsto.total,
      versao: `${previsto.versao.name} (${previsto.versao.fiscalYear})`,
      modo: serie.amountMode,
      ocorrencias: previsto.ocorrencias.map(o => ({
        competencia: o.competenceDate, caixa: o.cashDate, valor: o.amount,
      })),
    }

    const { previaId, expiraEm } = await registrarPrevia({
      organizationId: scope.organizationId,
      ferramenta: FERRAMENTA_ORCADO,
      userId: ctx.userId,
      clientId: ctx.clientId,
      resumo,
      pedido: { serie },
    })

    return {
      previaId, expiraEm, resumo,
      comoAplicar: `Mostre as ocorrências ao usuário. Com o aceite dele, chame ` +
        `aplicar_lancamento_de_orcamento com previaId e confirmacao: "${PALAVRA_DE_CONFIRMACAO}".`,
    }
  },
}

const aplicarLancamentoOrcado: Ferramenta = {
  nome: 'aplicar_lancamento_de_orcamento',
  titulo: 'Aplicar lançamento de orçamento',
  descricao:
    'Grava o lançamento orçado de uma prévia. Exige previaId e a palavra literal "aplicar". ' +
    'Recalcula do zero e recusa se algo mudou desde a prévia.',
  entrada: alvo.extend({
    previaId: z.string().uuid(),
    confirmacao: z.string().describe('A palavra literal "aplicar".'),
  }),
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as { organizationId: string; previaId: string; confirmacao: string }
    const scope = await escopoDe(ctx, a.organizationId)

    const falta = exigirConfirmacao(a.confirmacao)
    if (falta) throw new Error(falta)

    const previa = await consumirPrevia({
      previaId: a.previaId, ferramenta: FERRAMENTA_ORCADO,
      organizationId: scope.organizationId, userId: ctx.userId,
    })
    if (!previa.ok) throw new Error(previa.motivo)

    const serie = (previa.pedido as { serie: BudgetSeriesInput }).serie

    const agora = await preverSerie(scope.organizationId, serie)
    if ('error' in agora) throw new Error(agora.error)
    const problema = divergiu(previa.resumo, {
      quantidade: agora.ocorrencias.length, valorTotal: agora.total,
    })
    if (problema) throw new Error(problema)

    const inicio = Date.now()
    const r = await criarSerie(scope.organizationId, ctx.userId, serie)
    if ('error' in r) throw new Error(r.error)

    await registrarAplicacao({
      organizationId: scope.organizationId, ferramenta: FERRAMENTA_ORCADO,
      previaId: a.previaId, userId: ctx.userId, clientId: ctx.clientId,
      resultado: { ocorrencias: r.occurrences }, duracaoMs: Date.now() - inicio,
    })

    return { aplicado: true, ocorrenciasGravadas: r.occurrences, seriesId: r.seriesId }
  },
}

const entradaCopia = alvo.extend({
  versionId: z.string().uuid(),
  deMes: z.string().regex(/^\d{4}-\d{2}$/).describe('Primeiro mês do realizado a copiar (AAAA-MM).'),
  ateMes: z.string().regex(/^\d{4}-\d{2}$/),
  regime: z.enum(['competencia', 'caixa']).default('competencia'),
  formato: z.enum(['mensal', 'media']).default('mensal').describe(
    'mensal preserva a sazonalidade mês a mês; media distribui a média igualmente.',
  ),
  detalhamento: z.enum(['categoria', 'dimensoes']).default('categoria').describe(
    'categoria gera uma linha por natureza; dimensoes abre também por centro de custo e unidade.',
  ),
  incluirContato: z.boolean().default(false),
  ajustePct: z.number().min(-100).max(1000).default(0).describe('Em pontos percentuais: 10 = +10%.'),
  substituirCopiasAnteriores: z.boolean().default(false).describe(
    'Apaga só o que veio de cópia anterior; o que foi lançado à mão fica.',
  ),
})

function montarCopia(a: z.infer<typeof entradaCopia>): CopyActualsInput {
  return {
    versionId: a.versionId,
    sourceFrom: a.deMes,
    sourceTo: a.ateMes,
    regime: a.regime,
    shape: a.formato,
    granularity: a.detalhamento,
    includeContact: a.incluirContato,
    adjustmentPct: a.ajustePct,
    replaceExisting: a.substituirCopiasAnteriores,
  }
}

const preverCopiaDoRealizado: Ferramenta = {
  nome: 'prever_copia_do_realizado',
  titulo: 'Prever cópia do realizado',
  descricao:
    'Monta um orçamento a partir do que já aconteceu, SEM gravar. É o caminho para "orce 2027 com ' +
    'base em 2026 mais 10%". Avisa quanto do realizado está sem natureza ou em natureza inativa — ' +
    'esse pedaço não é copiável e some da conta, então o total orçado pode ficar abaixo do realizado.',
  entrada: entradaCopia,
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as z.infer<typeof entradaCopia>
    const scope = await escopoDe(ctx, a.organizationId)

    const r = await preverCopia(scope.organizationId, montarCopia(a))
    if ('error' in r) throw new Error(r.error)
    const p = r.preview

    const total = p.targetTotals.inflow + p.targetTotals.outflow
    const resumo = {
      quantidade: p.rows.length,
      valorTotal: total,
      mesesNaOrigem: p.monthsInSource,
      totaisOrigem: p.sourceTotals,
      totaisDestino: p.targetTotals,
      semCategoria: p.semCategoria,
      emNaturezaInativa: p.inativas,
      copiasJaExistentes: p.existingCopied,
      amostra: p.rows.slice(0, 8),
    }

    if (p.rows.length === 0) {
      return { previaId: null, resumo, aviso: 'Não há realizado categorizado nesse período para copiar.' }
    }

    const { previaId, expiraEm } = await registrarPrevia({
      organizationId: scope.organizationId,
      ferramenta: FERRAMENTA_COPIA,
      userId: ctx.userId,
      clientId: ctx.clientId,
      resumo,
      pedido: { copia: montarCopia(a) },
    })

    const avisos: string[] = []
    if (p.semCategoria.count > 0) {
      avisos.push(`${p.semCategoria.count} lançamento(s) sem natureza, somando ` +
        `R$ ${p.semCategoria.total.toFixed(2)}, ficaram de fora da cópia.`)
    }
    if (p.existingCopied.series > 0 && !a.substituirCopiasAnteriores) {
      avisos.push(`Esta versão já tem ${p.existingCopied.series} lançamento(s) vindos de cópia ` +
        `anterior, somando R$ ${p.existingCopied.total.toFixed(2)}. Sem ` +
        'substituirCopiasAnteriores, os novos SOMAM aos existentes.')
    }

    return {
      previaId, expiraEm, resumo,
      ...(avisos.length ? { avisos } : {}),
      comoAplicar: `Mostre este resumo ao usuário. Com o aceite dele, chame ` +
        `aplicar_copia_do_realizado com previaId e confirmacao: "${PALAVRA_DE_CONFIRMACAO}".`,
    }
  },
}

const aplicarCopiaDoRealizado: Ferramenta = {
  nome: 'aplicar_copia_do_realizado',
  titulo: 'Aplicar cópia do realizado',
  descricao:
    'Grava o orçamento da prévia. Exige previaId e a palavra literal "aplicar". Recalcula do zero ' +
    'e recusa se o realizado mudou desde a prévia.',
  entrada: alvo.extend({
    previaId: z.string().uuid(),
    confirmacao: z.string().describe('A palavra literal "aplicar".'),
  }),
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as { organizationId: string; previaId: string; confirmacao: string }
    const scope = await escopoDe(ctx, a.organizationId)

    const falta = exigirConfirmacao(a.confirmacao)
    if (falta) throw new Error(falta)

    const previa = await consumirPrevia({
      previaId: a.previaId, ferramenta: FERRAMENTA_COPIA,
      organizationId: scope.organizationId, userId: ctx.userId,
    })
    if (!previa.ok) throw new Error(previa.motivo)

    const copia = (previa.pedido as { copia: CopyActualsInput }).copia

    const agora = await preverCopia(scope.organizationId, copia)
    if ('error' in agora) throw new Error(agora.error)
    const problema = divergiu(previa.resumo, {
      quantidade: agora.preview.rows.length,
      valorTotal: agora.preview.targetTotals.inflow + agora.preview.targetTotals.outflow,
    })
    if (problema) throw new Error(problema)

    const inicio = Date.now()
    const r = await aplicarCopia(scope.organizationId, ctx.userId, copia)
    if ('error' in r) throw new Error(r.error)

    await registrarAplicacao({
      organizationId: scope.organizationId, ferramenta: FERRAMENTA_COPIA,
      previaId: a.previaId, userId: ctx.userId, clientId: ctx.clientId,
      resultado: { ...r }, duracaoMs: Date.now() - inicio,
    })

    return { aplicado: true, ...r }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Regras de categorização
// ─────────────────────────────────────────────────────────────────────────────

const listarRegrasFerramenta: Ferramenta = {
  nome: 'listar_regras',
  titulo: 'Listar regras de categorização',
  descricao:
    'As regras que classificam sozinhas o que é importado. Uma regra é "descrição contém X (na ' +
    'conta Y) → vai para estes destinos", e o casamento é por trecho da descrição, sem diferenciar ' +
    'maiúsculas. É por aqui que se responde "por que este lançamento foi parar em SG&A?". ' +
    'PRECEDÊNCIA: a mais específica vence. Uma regra com `contaId` só vale naquela conta e é ' +
    'avaliada ANTES das globais (`contaId: null`, que valem em qualquer conta); a primeira que ' +
    'casar decide, e as demais nem são olhadas. Então a mesma descrição pode ter uma regra global ' +
    'e uma por conta apontando para naturezas diferentes, sem conflito — na conta escopada vence a ' +
    'dela, no resto vence a global. ' +
    '`total` é o total REAL da empresa, não o tamanho da página — use `offset` para percorrer o ' +
    'resto enquanto `temMais` for verdadeiro. ' +
    `CUIDADO com vezesAplicada: o contador só passou a ser escrito em ${CONTADOR_VIVO_DESDE}, e ` +
    'cada regra declara em `contadorConfiavel` se o dela vale. Numa regra com ' +
    '`contadorConfiavel: false`, zero NÃO significa "nunca pegou" — significa "não se sabe". ' +
    'Não conclua que uma regra é inútil a partir desse zero.',
  entrada: alvo.extend({
    busca: z.string().trim().min(2).max(60).optional()
      .describe('Filtra pela descrição da regra.'),
    limite: z.number().int().min(1).max(500).default(200),
    offset: z.number().int().min(0).default(0)
      .describe('Quantas pular. Para a segunda página de 500, offset: 500.'),
  }),
  escopo: 'leitura',
  async executar(args, ctx) {
    const a = args as { organizationId: string; busca?: string; limite?: number; offset?: number }
    const scope = await escopoDe(ctx, a.organizationId)
    const r = await listarRegras(scope.organizationId, {
      busca: a.busca, limite: a.limite, offset: a.offset,
    })

    return {
      ...r,
      exibidas: r.regras.length,
      ...(r.temMais ? {
        avisoPaginacao: `Faltam ${r.total - r.offset - r.regras.length} regra(s). ` +
          `Chame de novo com offset: ${r.offset + r.regras.length}.`,
      } : {}),
      ...(r.contadorNaoConfiavel > 0 ? {
        avisoContador: `${r.contadorNaoConfiavel} das regras listadas são anteriores a ` +
          `${CONTADOR_VIVO_DESDE}, quando o contador passou a ser escrito. O vezesAplicada delas ` +
          'não distingue "nunca pegou" de "pegou antes da contagem existir" — não use esse zero ' +
          'para dizer que a regra é inútil.',
      } : {}),
    }
  },
}

const FERRAMENTA_REGRAS = 'regras_de_categorizacao'

const entradaPreverRegras = alvo.extend({
  regras: z.array(regraDeLoteSchema).min(1).max(MAX_REGRAS_POR_LOTE),
})

const preverRegrasFerramenta: Ferramenta = {
  nome: 'prever_regras',
  titulo: 'Prever regras de categorização',
  descricao:
    'Mostra o que um lote de regras faria, SEM gravar. Para cada regra: se cria ou ATUALIZA uma já ' +
    'existente (e para onde a existente aponta hoje), e quantos lançamentos a descrição já alcança — ' +
    'o número que revela regra larga demais antes de ela virar dano. ' +
    'ATENÇÃO: regra não reclassifica o passado; ela vale da próxima categorização em diante. ' +
    'Para arrumar o que já está lançado, use prever_classificacao_em_lote. ' +
    'A identidade de uma regra é o par DESCRIÇÃO + CONTA: a mesma descrição sem conta (global) e ' +
    'com conta são regras DIFERENTES, e por isso a prévia pode dizer "criar" para uma descrição ' +
    'que já tem regra — o escopo é outro. Na hora de classificar, a escopada à conta vence a ' +
    'global. ' +
    'Regra inválida sai do lote com o motivo, sem derrubar as outras. ' +
    'Apresente o resumo ao usuário e obtenha o aceite antes de aplicar.',
  entrada: entradaPreverRegras,
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as z.infer<typeof entradaPreverRegras>
    const scope = await escopoDe(ctx, a.organizationId)

    const plano = await planejarRegras(scope.organizationId, a.regras)
    if ('error' in plano) throw new Error(plano.error)

    if (plano.linhas.length === 0) {
      return {
        previaId: null,
        recusadas: plano.recusadas,
        aviso: 'Nenhuma regra do lote é válida. Corrija os motivos abaixo e chame de novo.',
      }
    }

    const resumo = {
      quantidade: plano.linhas.length,
      criar: plano.criar,
      atualizar: plano.atualizar,
      recusadas: plano.recusadas.length,
      assinatura: assinaturaDoPlano(plano),
      linhas: plano.linhas,
    }

    const { previaId, expiraEm } = await registrarPrevia({
      organizationId: scope.organizationId,
      ferramenta: FERRAMENTA_REGRAS,
      userId: ctx.userId,
      clientId: ctx.clientId,
      resumo,
      pedido: { regras: a.regras },
    })

    // Uma regra que já alcança meio extrato quase nunca é o que a pessoa quis
    // dizer — e o casamento é por trecho, então o alcance só cresce com o tempo.
    const largas = plano.linhas.filter(l => l.lancamentosQueCasam > 200)

    return {
      previaId,
      expiraEm,
      resumo,
      ...(plano.recusadas.length ? { recusadas: plano.recusadas } : {}),
      ...(plano.atualizar > 0 ? {
        avisoSobrescrita: `${plano.atualizar} regra(s) já existem e serão SOBRESCRITAS. ` +
          'Confira o campo alvosAtuais de cada uma antes de aceitar.',
      } : {}),
      ...(largas.length ? {
        avisoAbrangencia: largas.map(l =>
          `"${l.descricao}" já casa com ${l.lancamentosQueCasam} lançamentos. ` +
          'Confirme que é isso mesmo — o casamento é por trecho da descrição.'),
      } : {}),
      comoAplicar: `Mostre este resumo ao usuário. Com o aceite dele, chame aplicar_regras ` +
        `com previaId e confirmacao: "${PALAVRA_DE_CONFIRMACAO}".`,
    }
  },
}

const aplicarRegrasFerramenta: Ferramenta = {
  nome: 'aplicar_regras',
  titulo: 'Aplicar regras de categorização',
  descricao:
    'Grava o lote de regras de uma prévia. Exige previaId e a palavra literal "aplicar". Refaz o ' +
    'plano e RECUSA se ele mudou — inclusive se uma regra que ia ser criada passou a existir no ' +
    'intervalo, porque aí o efeito deixa de ser criar e passa a ser sobrescrever.',
  entrada: alvo.extend({
    previaId: z.string().uuid(),
    confirmacao: z.string().describe('A palavra literal "aplicar".'),
  }),
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as { organizationId: string; previaId: string; confirmacao: string }
    const scope = await escopoDe(ctx, a.organizationId)

    const falta = exigirConfirmacao(a.confirmacao)
    if (falta) throw new Error(falta)

    const previa = await consumirPrevia({
      previaId: a.previaId, ferramenta: FERRAMENTA_REGRAS,
      organizationId: scope.organizationId, userId: ctx.userId,
    })
    if (!previa.ok) throw new Error(previa.motivo)

    const regras = (previa.pedido as { regras: RegraDeLote[] }).regras

    const agora = await planejarRegras(scope.organizationId, regras)
    if ('error' in agora) throw new Error(agora.error)

    const problema = divergiu(previa.resumo, { quantidade: agora.linhas.length })
    if (problema) throw new Error(problema)
    if (previa.resumo.assinatura !== assinaturaDoPlano(agora)) {
      throw new Error(
        'O plano mudou desde a prévia: alguma regra deste lote passou a existir (ou deixou de ' +
        'existir) no intervalo. Gere uma prévia nova — o que seria criado agora seria sobrescrito.',
      )
    }

    const inicio = Date.now()
    const r = await aplicarRegras(scope.organizationId, regras, agora)

    await registrarAplicacao({
      organizationId: scope.organizationId, ferramenta: FERRAMENTA_REGRAS,
      previaId: a.previaId, userId: ctx.userId, clientId: ctx.clientId,
      resultado: { ...r }, duracaoMs: Date.now() - inicio,
    })

    return {
      aplicado: true,
      ...r,
      observacao: 'As regras valem da próxima categorização em diante. O que já está lançado não ' +
        'mudou — para reclassificar o passado, use prever_classificacao_em_lote.',
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Importação de lançamentos
// ─────────────────────────────────────────────────────────────────────────────

const FERRAMENTA_IMPORTACAO = 'importacao_de_lancamentos'

/**
 * A entrada tem DOIS NÍVEIS, como o contrato — e é o de cima que faltava.
 *
 * `aplicarImportacao` cravava `reportType: 'other'`, então balanço pelo MCP era
 * impossível, e em silêncio: `getBpData` filtra `report_type='balance_sheet'` e
 * `domainFromReportType('other')` devolve `'dre'`, de modo que uma linha
 * patrimonial só via naturezas de DRE para casar. Também não havia onde informar
 * a data de referência, que é o que vira a coluna de `/balanco`.
 */
const entradaPreverImportacao = alvo.extend({
  origem: z.string().trim().min(2).max(120).describe(
    'Como esta importação se chama, para quem for olhar depois. Ex.: "Extrato Itaú — março/2026". ' +
    'Vira o nome do documento e o rótulo do lote em /transacoes.',
  ),
  tipoDeRelatorio: z.enum(TIPOS_DE_RELATORIO).default('movimentos').describe(
    '"movimentos" (padrão) para extrato, fatura ou relatório de lançamentos — alimenta DRE e fluxo ' +
    'ao mesmo tempo, pelas duas datas. "balanco" para Balanço Patrimonial, que é fotografia numa ' +
    'data: cada linha é conta patrimonial + saldo, sem data e sem sentido próprios.',
  ),
  dataDeReferencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe(
    'OBRIGATÓRIA quando tipoDeRelatorio = "balanco": a data do snapshot (em geral o último dia do ' +
    'mês). É ela que vira a coluna do Balanço e a data de cada linha. Ignorada em movimentos.',
  ),
  conta: z.string().trim().max(200).optional().describe(
    'Nome da conta/cartão do arquivo INTEIRO — um extrato é de uma conta só. Ex.: "Itaú PJ", ' +
    '"Caixa", "Cartão BTG". Preencher aqui CRIA a conta se ela ainda não existir, e ela passa a ' +
    'aparecer em Contas e no filtro de Transações. É o ÚNICO campo desta ferramenta que cria conta: ' +
    'a `conta` de cada LINHA precisa já existir (confira com listar_contas). Vale para as linhas ' +
    'que não declaram conta própria; use `conta` por linha se o arquivo misturar mais de uma.',
  ),
  tipoDeConta: z.enum(TIPOS_DE_CONTA).optional().describe(
    `Tipo da conta do arquivo: ${TIPOS_DE_CONTA.map(t => `${t} (${ROTULO_DE_CONTA[t]})`).join(', ')}.`,
  ),
  numeroDaConta: z.string().trim().max(60).optional().describe(
    'Número ou final da conta/cartão do arquivo, quando o extrato traz.',
  ),
  linhas: z.array(linhaImportadaSchema).min(1).max(MAX_LINHAS_IMPORTACAO),
})

/** O nível de arquivo, validado pelo contrato antes de qualquer leitura de linha. */
function cabecalhoDaEntrada(a: z.infer<typeof entradaPreverImportacao>) {
  return cabecalhoDoArquivoSchema.safeParse({
    tipoDeRelatorio: a.tipoDeRelatorio,
    dataDeReferencia: a.dataDeReferencia ?? null,
    conta: a.conta ?? null,
    tipoDeConta: a.tipoDeConta ?? null,
    numeroDaConta: a.numeroDaConta ?? null,
    moeda: 'BRL',
  })
}

const preverImportacao: Ferramenta = {
  nome: 'prever_importacao',
  titulo: 'Prever importação de lançamentos',
  descricao:
    'Importa lançamentos a partir de linhas que VOCÊ já tabulou — o arquivo não sobe para lugar ' +
    'nenhum. Fluxo: o usuário anexa o extrato ou a planilha na conversa, você lê, converte em ' +
    'linhas e chama esta ferramenta; ela mostra o que entraria, sem gravar. ' +
    'DEDUPLICA: uma linha já presente no banco é ignorada, então reimportar o mesmo arquivo (ou ' +
    'lotes que se sobrepõem) não duplica nada — a prévia diz quantas já existiam. ' +
    'Cada linha pode trazer `categoria` com o código ou o nome do plano de contas; o que casar ' +
    'entra já classificado, o que não casar vai para a fila de classificação. ' +
    'Serve também para BALANÇO PATRIMONIAL: use tipoDeRelatorio "balanco" com dataDeReferencia, e ' +
    'cada linha vira conta patrimonial (`categoria`) + saldo (`valor`). Balanço NÃO deduplica, ' +
    'porque snapshot se substitui — reenviar o balanço corrigido entra de novo, de propósito. ' +
    `Teto de ${MAX_LINHAS_IMPORTACAO} linhas por chamada — arquivo maior vai em chamadas seguidas ` +
    'com a MESMA origem. Mostre o resumo ao usuário e obtenha o aceite antes de aplicar.',
  entrada: entradaPreverImportacao,
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as z.infer<typeof entradaPreverImportacao>
    const scope = await escopoDe(ctx, a.organizationId)

    const cab = cabecalhoDaEntrada(a)
    if (!cab.success) throw new Error(cab.error.issues.map(i => i.message).join(' '))

    const plano = await planejarImportacao(scope.organizationId, cab.data, a.linhas)
    if ('error' in plano) throw new Error(plano.error)

    const resumo = {
      quantidade: plano.novas,
      valorTotal: plano.entradas + plano.saidas,
      duplicadasIgnoradas: plano.duplicadas,
      entradas: plano.entradas,
      saidas: plano.saidas,
      periodo: plano.periodo,
      comNatureza: plano.comNatureza,
      amostra: plano.amostra,
    }

    // Motivos das recusas, montados ANTES do caso zero. Quando todas as linhas
    // são recusadas, `novas` é 0 e a resposta antiga dizia só "nenhuma linha
    // para importar" — o modelo ficava sem saber o que corrigir e tenderia a
    // repetir a chamada igual. Dizer o motivo é o que transforma erro em
    // instrução.
    const motivosRecusa = Array.from(new Set(plano.recusadas.map(r => r.motivo))).slice(0, 5)

    if (plano.novas === 0) {
      return {
        previaId: null,
        resumo,
        recusadas: plano.recusadas.length,
        ...(motivosRecusa.length ? { motivos: motivosRecusa } : {}),
        aviso: plano.recusadas.length > 0
          ? `Nenhuma linha entrou: ${plano.recusadas.length} recusada(s) — ${motivosRecusa.join(' · ')}. ` +
            'Corrija as linhas e chame de novo.'
          : plano.duplicadas > 0
            ? `Todas as ${plano.duplicadas} linhas já estão no banco. Nada a importar — o arquivo ` +
              'já tinha sido importado antes.'
            : 'Nenhuma linha para importar.',
      }
    }

    const { previaId, expiraEm } = await registrarPrevia({
      organizationId: scope.organizationId,
      ferramenta: FERRAMENTA_IMPORTACAO,
      userId: ctx.userId,
      clientId: ctx.clientId,
      resumo,
      pedido: { origem: a.origem, linhas: a.linhas, cabecalho: cab.data },
    })

    const avisos: string[] = []
    if (plano.duplicadas > 0) {
      avisos.push(`${plano.duplicadas} linha(s) já existem no banco e serão ignoradas.`)
    }
    if (plano.recusadas.length > 0) {
      avisos.push(
        `${plano.recusadas.length} linha(s) recusadas e NÃO entram: ${motivosRecusa.join(' · ')}. ` +
        'Corrija e chame prever_importacao de novo, ou siga sem elas.',
      )
    }
    if (plano.tipoDeRelatorio === 'balanco') {
      avisos.push('Balanço não deduplica: se este mês já foi importado, o snapshot novo entra ' +
        'inteiro e passa a ser o que a tela de Balanço mostra.')
    }
    if (plano.naturezasNaoResolvidas.length > 0) {
      avisos.push(
        `Não achei no plano de contas: ${plano.naturezasNaoResolvidas.join(', ')}. ` +
        'Esses lançamentos entram sem natureza e vão para a fila de classificação. ' +
        'Use listar_categorias para conferir os códigos.',
      )
    }
    if (plano.comNatureza < plano.novas) {
      avisos.push(`${plano.novas - plano.comNatureza} lançamento(s) entram sem natureza e serão ` +
        'classificados automaticamente depois.')
    }
    // A conta citada numa LINHA não cria conta. Sem este aviso, o lançamento
    // entraria sem vínculo em silêncio: apareceria em Transações com o nome que
    // o arquivo deu, e não contaria na tela Contas.
    const semCadastro = plano.contasDoArquivo.filter(c => !c.conta)
    if (semCadastro.length > 0) {
      avisos.push(
        `Estas contas aparecem nas linhas e NÃO existem no cadastro: ` +
        `${semCadastro.map(c => `${c.nomeDeclarado} (${c.linhas} linha(s))`).join(', ')}. ` +
        'Os lançamentos entram sem vínculo — não contam na tela Contas. Para criar uma delas, ' +
        'informe-a em `conta` no nível do ARQUIVO (esse campo cria), ou peça ao usuário para ' +
        'criá-la em Contas. Contas conectadas por Open Finance não podem ser citadas por nome.',
      )
    }

    return {
      previaId, expiraEm, resumo,
      ...(avisos.length ? { avisos } : {}),
      comoAplicar: `Mostre este resumo ao usuário — quantidade, período e totais. Com o aceite ` +
        `dele, chame aplicar_importacao com previaId e confirmacao: "${PALAVRA_DE_CONFIRMACAO}".`,
    }
  },
}

const aplicarImportacaoFerramenta: Ferramenta = {
  nome: 'aplicar_importacao',
  titulo: 'Aplicar importação de lançamentos',
  descricao:
    'Grava os lançamentos de uma prévia. Exige previaId e a palavra literal "aplicar". Recalcula do ' +
    'zero e recusa se o conjunto mudou. Depois de gravar, dispara a categorização automática do que ' +
    'entrou sem natureza. Devolve o documentId, que é por onde /transacoes filtra este lote caso ' +
    'seja preciso revisar ou apagar.',
  entrada: alvo.extend({
    previaId: z.string().uuid(),
    confirmacao: z.string().describe('A palavra literal "aplicar".'),
  }),
  escopo: 'escrita',
  async executar(args, ctx) {
    const a = args as { organizationId: string; previaId: string; confirmacao: string }
    const scope = await escopoDe(ctx, a.organizationId)

    const falta = exigirConfirmacao(a.confirmacao)
    if (falta) throw new Error(falta)

    const previa = await consumirPrevia({
      previaId: a.previaId, ferramenta: FERRAMENTA_IMPORTACAO,
      organizationId: scope.organizationId, userId: ctx.userId,
    })
    if (!previa.ok) throw new Error(previa.motivo)

    const pedido = previa.pedido as {
      origem: string
      linhas: LinhaImportada[]
      cabecalho?: unknown
    }

    // O cabeçalho é revalidado pelo contrato em vez de aceito como veio: a
    // prévia mora em `agent_events`, que é jsonb, e aplicar sobre um nível de
    // arquivo não validado gravaria um balanço sem data de referência.
    const cab = cabecalhoDoArquivoSchema.safeParse(pedido.cabecalho ?? {})
    if (!cab.success) throw new Error(cab.error.issues.map(i => i.message).join(' '))

    const agora = await planejarImportacao(scope.organizationId, cab.data, pedido.linhas)
    if ('error' in agora) throw new Error(agora.error)
    const problema = divergiu(previa.resumo, {
      quantidade: agora.novas, valorTotal: agora.entradas + agora.saidas,
    })
    if (problema) throw new Error(problema)

    const inicio = Date.now()
    const r = await aplicarImportacao(
      scope.organizationId, ctx.userId, pedido.origem, cab.data, pedido.linhas, agora,
    )

    // A categorização é assíncrona e pode falhar sem que a importação falhe —
    // os lançamentos já estão no banco. Sinalizar é melhor que desfazer: quem
    // ficou sem natureza aparece na fila de revisão de qualquer jeito.
    let categorizacaoDisparada = true
    if (r.paraCategorizar.length > 0) {
      try {
        await sendCategorizationEvents(r.paraCategorizar, scope.organizationId)
      } catch (e) {
        console.error('[mcp] sendCategorizationEvents falhou', (e as Error).message)
        categorizacaoDisparada = false
      }
    }

    await registrarAplicacao({
      organizationId: scope.organizationId, ferramenta: FERRAMENTA_IMPORTACAO,
      previaId: a.previaId, userId: ctx.userId, clientId: ctx.clientId,
      resultado: { inseridos: r.inseridos, documentId: r.documentId }, duracaoMs: Date.now() - inicio,
    })

    return {
      aplicado: true,
      lancamentosInseridos: r.inseridos,
      ignoradosPorDuplicidade: r.ignoradosPorDuplicidade,
      jaClassificados: r.comNatureza,
      documentId: r.documentId,
      ...(r.paraCategorizar.length > 0 ? {
        emClassificacao: r.paraCategorizar.length,
        ...(categorizacaoDisparada ? {} : {
          aviso: 'Os lançamentos entraram, mas a fila de categorização não aceitou o disparo. ' +
            'O usuário pode rodar "Categorizar agora" em /transacoes.',
        }),
      } : {}),
      observacao: 'Se este lote estiver errado, ele é separável: /transacoes filtra por importação ' +
        'e apaga em lote. Reimportar o mesmo arquivo é seguro — as linhas repetidas são ignoradas.',
    }
  },
}

const CATALOGO: Ferramenta[] = [
  listarOrganizacoes,
  descreverOrganizacao,
  listarCategorias,
  listarContas,
  listarDimensoes,
  listarModelosDeRateio,
  listarVersoesDeOrcamento,
  listarRegrasFerramenta,
  consultar,
  explicarConsulta,
  preverClassificacao,
  aplicarClassificacao,
  preverRegrasFerramenta,
  aplicarRegrasFerramenta,
  preverImportacao,
  aplicarImportacaoFerramenta,
  preverRateio,
  aplicarRateio,
  preverLancamentoOrcado,
  aplicarLancamentoOrcado,
  preverCopiaDoRealizado,
  aplicarCopiaDoRealizado,
  ...FERRAMENTAS_DE_DASHBOARD,
]

/** O que este consentimento enxerga. */
export function ferramentasPara(scopes: Escopo[]): Ferramenta[] {
  return CATALOGO.filter(f => scopes.includes(f.escopo))
}

export function acharFerramenta(nome: string, scopes: Escopo[]): Ferramenta | null {
  return ferramentasPara(scopes).find(f => f.nome === nome) ?? null
}

/**
 * O JSON Schema publicado em `tools/list`.
 *
 * `io: 'input'` é o detalhe que importa: no modo de saída, todo campo com
 * `.default()` viraria obrigatório, e o modelo passaria a preencher à força
 * `filtros`, `limite` e `ordenarPor` em toda chamada.
 *
 * `reused: 'ref'` fatora o que se repete em `$defs`. Sem ele, `adicionar_bloco`
 * publicava 16KB: sete tipos de bloco, e os quatro que consultam repetindo o
 * schema INTEIRO de `query` — filtros, período, medidas e agrupamentos, quatro
 * vezes. Com `$ref` são 7KB. O diagnóstico de 26/ago (achado 7) mediu o efeito
 * disso do lado do cliente: precisou de quatro buscas para achar a ferramenta,
 * inclusive procurando pela descrição literal dela — e é a ferramenta que o
 * próprio `criar_painel` indica como próximo passo.
 */
export function schemaDeEntrada(f: Ferramenta): Record<string, unknown> {
  return z.toJSONSchema(f.entrada, { io: 'input', reused: 'ref' }) as Record<string, unknown>
}

/** Erro de domínio → texto que o modelo consegue corrigir sozinho. */
export function mensagemDeErro(e: unknown): string {
  if (e instanceof ScopeDeniedError) {
    return `${e.message} Use listar_organizacoes para ver quais empresas esta conexão alcança.`
  }
  if (e instanceof QueryValidationError) return e.message
  if (e instanceof z.ZodError) {
    const i = e.issues[0]
    return `${i.path.join('.') || 'argumentos'}: ${i.message}`
  }
  return e instanceof Error ? e.message : 'Falha inesperada.'
}
