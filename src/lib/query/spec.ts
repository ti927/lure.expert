// A especificação de consulta — um Zod, três consumidores: o motor, a
// ferramenta MCP `consultar` (via `z.toJSONSchema()` nativo do Zod 4) e o bloco
// do dashboard configurável.
//
// Ter um schema só é o que impede o dashboard e o MCP de divergirem sobre o que
// é uma consulta válida.

import { z } from 'zod'
import { MEASURE_IDS } from './measures'
import { GROUPING_IDS } from './groupings'

export const SOURCE_IDS = ['realizado', 'orcado', 'nfe', 'balanco'] as const
export type QuerySource = (typeof SOURCE_IDS)[number]

const uuid = z.string().uuid()
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')

/**
 * Tetos.
 *
 * Sem eles, o modelo pede a grade cartesiana de quatro dimensões sobre doze
 * meses e derruba o banco — e o resultado seria ilegível de qualquer forma.
 * `agruparPor` em 2 porque tabela e gráfico param de fazer sentido no terceiro
 * eixo.
 */
export const LIMITE_MAX      = 500
export const AGRUPAR_MAX     = 2
export const MEDIDAS_MAX     = 4

/** Seleção de dimensão. `__null__` (DIM_NONE) significa "sem esta dimensão". */
const selecaoDimensao = z.array(z.string()).max(200).optional()

export const periodoSchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('intervalo'),
    de:   dataIso,
    ate:  dataIso,
    /**
     * Competência usa a data do fato econômico (`date`); caixa usa a data em
     * que o dinheiro se moveu (`COALESCE(effective_date, date)`). A distinção é
     * convenção do projeto e alimenta DRE vs Fluxo.
     */
    regime: z.enum(['competencia', 'caixa']).default('competencia'),
  }),
  z.object({
    tipo:   z.literal('relativo'),
    meses:  z.number().int().min(1).max(60),
    regime: z.enum(['competencia', 'caixa']).default('competencia'),
  }),
  z.object({
    // Só `balanco`: o BP não é série temporal, é foto numa data. Ver a Decisão
    // registrada no plano — `getBpData` busca o documento mais recente com
    // `reference_date <= X`, não um intervalo.
    tipo: z.literal('snapshot'),
    em:   dataIso,
  }),
])
export type Periodo = z.infer<typeof periodoSchema>

export const filtrosSchema = z.object({
  centrosDeCusto:     selecaoDimensao,
  unidadesDeNegocio:  selecaoDimensao,
  entidadesLegais:    selecaoDimensao,
  contatos:           selecaoDimensao,
  categorias:         z.array(uuid).max(200).optional(),
  tiposDeCategoria:   z.array(z.string()).max(20).optional(),
  contas:             z.array(z.string()).max(50).optional(),
  direcao:            z.enum(['inflow', 'outflow']).optional(),
  versaoOrcamento:    uuid.optional(),

  /**
   * Tipos de balanço patrimonial ficam fora por padrão: o app é orientado a
   * resultado, e somar ativo com receita produz número sem significado.
   */
  excluirBalanco: z.boolean().default(true),

  /**
   * Respeita as marcações `hide_in_dre` / `hide_in_cashflow` do plano de contas.
   * Padrão `todas` — a ocultação é decisão de apresentação de uma tela
   * específica, e o motor não deve escondê-la por conta própria.
   */
  visibilidade: z.enum(['dre', 'caixa', 'todas']).default('todas'),
// No Zod 4 o default de um objeto é o valor de SAÍDA, então os dois campos com
// default precisam aparecer aqui — omitir `filtros` inteiro tem de produzir o
// mesmo resultado que passar `{}`.
}).default({ excluirBalanco: true, visibilidade: 'todas' })

export const ordenacaoSchema = z.object({
  por:     z.string(),
  direcao: z.enum(['asc', 'desc']).default('desc'),
})

export const querySpecSchema = z.object({
  fonte:      z.enum(SOURCE_IDS).default('realizado'),
  medidas:    z.array(z.enum(MEASURE_IDS)).min(1).max(MEDIDAS_MAX).default(['valor_liquido']),
  agruparPor: z.array(z.enum(GROUPING_IDS)).max(AGRUPAR_MAX).default([]),
  periodo:    periodoSchema,
  filtros:    filtrosSchema,
  ordenarPor: z.array(ordenacaoSchema).max(2).default([]),
  limite:     z.number().int().min(1).max(LIMITE_MAX).default(50),
})

export type QuerySpec  = z.infer<typeof querySpecSchema>
export type QueryInput = z.input<typeof querySpecSchema>
export type Filtros    = z.infer<typeof filtrosSchema>

// ─── Resultado ───────────────────────────────────────────────────────────────

export interface QueryKey {
  campo:  string
  /** `null` quando a dimensão está vazia — o rótulo diz o quê. */
  id:     string | null
  rotulo: string
}

export interface QueryRow {
  chaves:  QueryKey[]
  medidas: Record<string, number>
}

export interface QueryResult {
  fonte:      QuerySource
  agruparPor: string[]
  medidas:    string[]
  linhas:     QueryRow[]
  /** Bateu no limite — há mais linhas que não vieram. */
  truncado:   boolean
  /** Período efetivamente consultado, já resolvido (útil no relativo). */
  periodo:    { de: string; ate: string } | { em: string }
}
