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
import { memberships, organizations, transactions, categories } from '@/db/schema'
import { scopeFromMcpGrant } from '@/lib/query/scope'
import { runQuery, explicarQuery } from '@/lib/query/engine'
import { querySpecSchema } from '@/lib/query/spec'
import { QueryValidationError, ScopeDeniedError } from '@/lib/query/errors'
import type { Escopo } from '@/lib/oauth/clients'

export interface ContextoMcp {
  userId: string
  organizationIds: string[]
  scopes: Escopo[]
}

export interface Ferramenta {
  nome: string
  titulo: string
  descricao: string
  /** Zod de entrada. O JSON Schema publicado sai daqui, então não divergem. */
  entrada: z.ZodType
  /** `escrita` some do catálogo quando o consentimento não a tem. */
  escopo: Escopo
  executar: (args: Record<string, unknown>, ctx: ContextoMcp) => Promise<unknown>
}

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

    const [plano] = await db
      .select({ naturezas: sql<number>`COUNT(*)::int` })
      .from(categories)
      .where(eq(categories.organizationId, scope.organizationId))

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

const entradaConsulta = querySpecSchema.extend(alvo.shape)

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
    'as medidas que seriam usados. Serve para conferir um pedido caro ou ambíguo antes de rodar.',
  entrada: entradaConsulta.partial({ organizationId: true }),
  escopo: 'leitura',
  async executar(args) {
    const { organizationId: _ignorado, ...spec } = args as Record<string, unknown>
    return explicarQuery(spec as never)
  },
}

const CATALOGO: Ferramenta[] = [
  listarOrganizacoes,
  descreverOrganizacao,
  consultar,
  explicarConsulta,
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
 */
export function schemaDeEntrada(f: Ferramenta): Record<string, unknown> {
  return z.toJSONSchema(f.entrada, { io: 'input' }) as Record<string, unknown>
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
