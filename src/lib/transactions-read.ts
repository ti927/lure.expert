// A leitura de lançamento individual — `detalhar_lancamentos` no MCP.
//
// Até 20/out o MCP só somava: `consultar` agrupa, e nenhuma ferramenta devolvia
// o lançamento em si. Toda investigação parava no primeiro "por quê" ("quais
// são esses 12?") e o expert respondia que não tinha acesso — pendência R3 do
// relatório de capacidade analítica, registrada desde a 3.2.
//
// É leitura OPERACIONAL (uma linha por lançamento), então lê `transactions` e
// pergunta natureza/dimensão às linhas pela view — a regra do CLAUDE.md. O
// rateado vem UMA vez, com as partes dentro.
//
// O filtro estende o vocabulário das escritas em lote (`filtroLancamentosBase`):
// quem aprendeu a descrever um lote para classificar já sabe descrevê-lo para
// ler, e o mesmo filtro passado a `prever_classificacao_em_lote` atinge o que
// esta leitura mostrou.

import { z } from 'zod'
import { and, ne, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { transactions, transactionAllocations } from '@/db/schema'
import { DIM_NONE } from '@/lib/dre-types'
import { dimensionExistsFilter, type DimensionColumn } from '@/lib/sql-dimensions'
import { descricaoNormalizadaSql } from '@/lib/descricao-normalizada'
import { filtroLancamentosBase, condicoes } from '@/lib/transactions-write'
import { validarFiltros } from '@/lib/query/validate-filters'
import type { Filtros } from '@/lib/query/spec'

export const LIMITE_DETALHE = 200

const selecaoDimensao = z.array(z.string()).max(200).optional()

export const filtroDeLeituraSchema = filtroLancamentosBase.extend({
  regime: z.enum(['competencia', 'caixa']).default('competencia')
    .describe('Qual data `de`/`ate` limitam: "competencia" (data do fato, a da DRE) ou "caixa" ' +
      '(data em que o dinheiro se moveu, a do fluxo).'),
  descricaoNormalizada: z.string().trim().min(1).max(200).optional()
    .describe('Só lançamentos cuja descrição normalizada é exatamente esta — passe o rótulo que ' +
      '`consultar` devolveu agrupando por "descricao_normalizada" para ver os lançamentos do grupo.'),
  descricaoExata: z.string().max(300).optional()
    .describe('Só lançamentos com exatamente esta descrição — o rótulo do agrupamento "descricao".'),
  tiposDeCategoria: z.array(z.string()).max(20).optional()
    .describe('Tipos do plano de contas (ex.: "receita_operacional", "despesas_administrativas"), ' +
      'como `listar_categorias` mostra no campo tipo.'),
  centrosDeCusto:    selecaoDimensao.describe('Ids de `listar_dimensoes`; "__null__" = sem centro de custo.'),
  unidadesDeNegocio: selecaoDimensao.describe('Ids de `listar_dimensoes`; "__null__" = sem unidade.'),
  entidadesLegais:   selecaoDimensao.describe('Ids de `listar_dimensoes`; "__null__" = sem entidade.'),
  contatos:          selecaoDimensao.describe('Ids de `listar_dimensoes`; "__null__" = sem contato.'),
  precisaRevisao: z.boolean().optional()
    .describe('true = só os que o expert classificou com dúvida e aguardam revisão humana.'),
  rateado: z.boolean().optional()
    .describe('true = só lançamentos rateados; false = só os não rateados.'),
}).default({ regime: 'competencia' })

export const detalharSchema = z.object({
  filtros: filtroDeLeituraSchema,
  ordenarPor: z.enum(['data', 'valor', 'descricao']).default('data'),
  direcao: z.enum(['asc', 'desc']).default('desc'),
  limite: z.number().int().min(1).max(LIMITE_DETALHE).default(50)
    .describe(`Lançamentos por página, até ${LIMITE_DETALHE}.`),
  offset: z.number().int().min(0).default(0)
    .describe('Quantos pular — para a próxima página, some o limite. `temMais` diz se há mais.'),
})

export type DetalharInput = z.input<typeof detalharSchema>

type Ref = { id: string; nome: string } | null

export interface ParteDetalhada {
  valor: number
  natureza: Ref
  centroDeCusto: Ref
  unidadeDeNegocio: Ref
  entidadeLegal: Ref
  contato: Ref
}

export interface LancamentoDetalhado {
  id: string
  data: string
  dataCaixa: string
  descricao: string
  /** Sempre positivo; o sinal está em `sentido`. */
  valor: number
  sentido: 'entrada' | 'saida'
  conta: { id: string | null; nome: string | null; tipo: string | null; numero: string | null }
  /** Nula num rateado — a natureza vive nas partes. */
  natureza: (Ref & { codigo: string | null; pai: string | null; tipo: string | null }) | null
  centroDeCusto: Ref
  unidadeDeNegocio: Ref
  entidadeLegal: Ref
  contato: Ref
  rateado: boolean
  partes?: ParteDetalhada[]
  precisaRevisao: boolean
  classificadoPor: string | null
  confianca: number | null
}

export interface ResultadoDetalhe {
  total: number
  totais: { entradas: number; saidas: number; liquido: number }
  limite: number
  offset: number
  temMais: boolean
  lancamentos: LancamentoDetalhado[]
}

const ref = (id: unknown, nome: unknown): Ref =>
  id ? { id: String(id), nome: nome ? String(nome) : '(sem nome)' } : null

/** Seleção com o sentinela `__null__` → o formato de `dimensionExistsFilter`. */
function porLinha(col: DimensionColumn, ids: string[] | undefined): SQL | null {
  if (!ids?.length) return null
  const reais = ids.filter(i => i !== DIM_NONE)
  return dimensionExistsFilter(sql`${transactions}.id`, col, {
    ids: reais, includeNone: reais.length !== ids.length, includeClassified: false,
  })
}

export async function detalharLancamentos(
  organizationId: string,
  input: DetalharInput,
): Promise<ResultadoDetalhe> {
  const spec = detalharSchema.parse(input)
  const f = spec.filtros

  // Id errado (ou o NOME no lugar do id) devolveria lista vazia em silêncio, e
  // o vazio passaria por resposta — achado 10. A mesma checagem do motor: os
  // campos têm os mesmos nomes de propósito.
  await validarFiltros(organizationId, f as unknown as Filtros)

  const colunaData = f.regime === 'caixa'
    ? sql`COALESCE(${transactions}.effective_date, ${transactions}.date)::date`
    : sql`${transactions}.date::date`

  const cond: SQL[] = [
    ...condicoes(organizationId, f, colunaData),
    // Duplicado já foi contado em outro lançamento — o mesmo corte do motor,
    // senão a contagem daqui não fecharia com a de `consultar`.
    ne(transactions.status, 'duplicate'),
  ]

  if (f.descricaoNormalizada) {
    cond.push(sql`${descricaoNormalizadaSql(sql`${transactions}.description`)} = ${
      descricaoNormalizadaSql(sql`${f.descricaoNormalizada}::text`)}`)
  }
  if (f.descricaoExata !== undefined) cond.push(sql`${transactions}.description = ${f.descricaoExata}`)
  if (f.tiposDeCategoria?.length) {
    cond.push(sql`EXISTS (
      SELECT 1 FROM transaction_lines tl JOIN categories c_tipo ON c_tipo.id = tl.category_id
      WHERE tl.transaction_id = ${transactions}.id
        AND c_tipo.type IN (${sql.join(f.tiposDeCategoria.map(x => sql`${x}`), sql`, `)})
    )`)
  }
  for (const [col, ids] of [
    ['cost_center_id', f.centrosDeCusto],
    ['business_unit_id', f.unidadesDeNegocio],
    ['legal_entity_id', f.entidadesLegais],
    ['contact_id', f.contatos],
  ] as const) {
    const c = porLinha(col, ids)
    if (c) cond.push(c)
  }
  if (f.precisaRevisao !== undefined) cond.push(sql`${transactions}.needs_review = ${f.precisaRevisao}`)

  const ehRateado = sql`EXISTS (SELECT 1 FROM transaction_allocations a_r WHERE a_r.transaction_id = ${transactions}.id)`
  if (f.rateado === true)  cond.push(ehRateado)
  if (f.rateado === false) cond.push(sql`NOT ${ehRateado}`)

  const where = and(...cond)!

  const ordem = {
    data:      colunaData,
    valor:     sql`${transactions}.amount`,
    descricao: sql`${transactions}.description`,
  }[spec.ordenarPor]
  const dir = sql.raw(spec.direcao === 'asc' ? 'ASC' : 'DESC')

  const [agregado, linhas] = await Promise.all([
    db.execute<{ total: string; entradas: string | null; saidas: string | null }>(sql`
      SELECT COUNT(*)::text AS total,
             SUM(CASE WHEN ${transactions}.direction = 'inflow'  THEN ${transactions}.amount ELSE 0 END)::text AS entradas,
             SUM(CASE WHEN ${transactions}.direction = 'outflow' THEN ${transactions}.amount ELSE 0 END)::text AS saidas
        FROM ${transactions}
       WHERE ${where}`),
    db.execute<Record<string, unknown>>(sql`
      SELECT ${transactions}.id::text                         AS id,
             ${transactions}.date::text                       AS data,
             COALESCE(${transactions}.effective_date, ${transactions}.date)::text AS data_caixa,
             ${transactions}.description                      AS descricao,
             ${transactions}.amount::text                     AS valor,
             ${transactions}.direction                        AS sentido,
             ${transactions}.account_id                       AS conta_id,
             ${transactions}.account_name                     AS conta_nome,
             ${transactions}.account_type                     AS conta_tipo,
             ${transactions}.account_number                   AS conta_numero,
             ${transactions}.category_id::text                AS cat_id,
             c.name AS cat_nome, c.code AS cat_codigo, c.type AS cat_tipo, cp.name AS cat_pai,
             ${transactions}.cost_center_id::text   AS cc_id, cc.name AS cc_nome,
             ${transactions}.business_unit_id::text AS bu_id, bu.name AS bu_nome,
             ${transactions}.legal_entity_id::text  AS le_id, le.name AS le_nome,
             ${transactions}.contact_id::text       AS ct_id, ct.name AS ct_nome,
             ${ehRateado}                                     AS rateado,
             ${transactions}.needs_review                     AS precisa_revisao,
             ${transactions}.categorization_method            AS metodo,
             ${transactions}.categorization_confidence        AS confianca
        FROM ${transactions}
        LEFT JOIN categories c      ON c.id  = ${transactions}.category_id
        LEFT JOIN categories cp     ON cp.id = c.parent_id
        LEFT JOIN cost_centers cc   ON cc.id = ${transactions}.cost_center_id
        LEFT JOIN business_units bu ON bu.id = ${transactions}.business_unit_id
        LEFT JOIN legal_entities le ON le.id = ${transactions}.legal_entity_id
        LEFT JOIN contacts ct       ON ct.id = ${transactions}.contact_id
       WHERE ${where}
       ORDER BY ${ordem} ${dir} NULLS LAST, ${transactions}.id
       LIMIT ${spec.limite} OFFSET ${spec.offset}`),
  ])

  // As partes dos rateados da página, numa ida só.
  const rateados = linhas.filter(l => l.rateado === true).map(l => String(l.id))
  const partesPorTx = new Map<string, ParteDetalhada[]>()
  if (rateados.length > 0) {
    const partes = await db.execute<Record<string, unknown>>(sql`
      SELECT a.transaction_id::text AS tx, a.amount::text AS valor,
             a.category_id::text AS cat_id, c.name AS cat_nome,
             a.cost_center_id::text AS cc_id, cc.name AS cc_nome,
             a.business_unit_id::text AS bu_id, bu.name AS bu_nome,
             a.legal_entity_id::text AS le_id, le.name AS le_nome,
             a.contact_id::text AS ct_id, ct.name AS ct_nome
        FROM ${transactionAllocations} a
        LEFT JOIN categories c      ON c.id  = a.category_id
        LEFT JOIN cost_centers cc   ON cc.id = a.cost_center_id
        LEFT JOIN business_units bu ON bu.id = a.business_unit_id
        LEFT JOIN legal_entities le ON le.id = a.legal_entity_id
        LEFT JOIN contacts ct       ON ct.id = a.contact_id
       WHERE a.transaction_id IN (${sql.join(rateados.map(id => sql`${id}::uuid`), sql`, `)})
       ORDER BY a.transaction_id, a.sequence`)
    for (const p of partes) {
      const lista = partesPorTx.get(String(p.tx)) ?? []
      lista.push({
        valor: Number(p.valor),
        natureza: ref(p.cat_id, p.cat_nome),
        centroDeCusto: ref(p.cc_id, p.cc_nome),
        unidadeDeNegocio: ref(p.bu_id, p.bu_nome),
        entidadeLegal: ref(p.le_id, p.le_nome),
        contato: ref(p.ct_id, p.ct_nome),
      })
      partesPorTx.set(String(p.tx), lista)
    }
  }

  const total = Number(agregado[0]?.total ?? 0)
  const entradas = Math.round(Number(agregado[0]?.entradas ?? 0) * 100) / 100
  const saidas = Math.round(Number(agregado[0]?.saidas ?? 0) * 100) / 100

  return {
    total,
    totais: { entradas, saidas, liquido: Math.round((entradas - saidas) * 100) / 100 },
    limite: spec.limite,
    offset: spec.offset,
    temMais: spec.offset + linhas.length < total,
    lancamentos: linhas.map(l => {
      const rateado = l.rateado === true
      return {
        id: String(l.id),
        data: String(l.data),
        dataCaixa: String(l.data_caixa),
        descricao: String(l.descricao ?? ''),
        valor: Number(l.valor),
        sentido: l.sentido === 'inflow' ? 'entrada' : 'saida',
        conta: {
          id: (l.conta_id as string) ?? null, nome: (l.conta_nome as string) ?? null,
          tipo: (l.conta_tipo as string) ?? null, numero: (l.conta_numero as string) ?? null,
        },
        natureza: l.cat_id ? {
          id: String(l.cat_id), nome: String(l.cat_nome ?? '(sem nome)'),
          codigo: (l.cat_codigo as string) ?? null, pai: (l.cat_pai as string) ?? null,
          tipo: (l.cat_tipo as string) ?? null,
        } : null,
        centroDeCusto: ref(l.cc_id, l.cc_nome),
        unidadeDeNegocio: ref(l.bu_id, l.bu_nome),
        entidadeLegal: ref(l.le_id, l.le_nome),
        contato: ref(l.ct_id, l.ct_nome),
        rateado,
        ...(rateado ? { partes: partesPorTx.get(String(l.id)) ?? [] } : {}),
        precisaRevisao: l.precisa_revisao === true,
        classificadoPor: (l.metodo as string) ?? null,
        confianca: l.confianca == null ? null : Number(l.confianca),
      }
    }),
  }
}
