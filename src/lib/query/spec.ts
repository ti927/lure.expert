// A especificação de consulta — um Zod, três consumidores: o motor, a
// ferramenta MCP `consultar` (via `z.toJSONSchema()` nativo do Zod 4) e o bloco
// do dashboard configurável.
//
// Ter um schema só é o que impede o dashboard e o MCP de divergirem sobre o que
// é uma consulta válida.

import { z } from 'zod'
import { MEASURE_IDS } from './measures'
import { GROUPING_IDS } from './groupings'

/**
 * As fontes que o motor RESPONDE hoje.
 *
 * `balanco` saiu daqui em 26/ago (achado 1 do diagnóstico do MCP). Ele estava no
 * enum sem ter descritor em `sources/index.ts`, então toda chamada com
 * `fonte: 'balanco'` era aceita pelo Zod e recusada pelo motor — um contrato que
 * oferece o que não entrega. O tipo `QuerySource` continua com ele (é a
 * preparação do descritor, legítima), mas o SCHEMA só publica o que funciona.
 */
export const SOURCE_IDS = ['realizado', 'orcado', 'nfe'] as const

/**
 * O tipo interno do motor, que já conhece o balanço.
 *
 * A separação existe porque `SourceDescriptor` precisa poder declarar
 * `id: 'balanco'` e `periodKind: 'snapshot'` quando a fonte for construída —
 * o que não deve implicar anunciá-la antes da hora.
 */
export type QuerySource = (typeof SOURCE_IDS)[number] | 'balanco'

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
  // A variante `snapshot` (foto numa data, para o Balanço Patrimonial) saiu em
  // 26/ago junto com a fonte `balanco` — achado 1 do diagnóstico. Ela só servia
  // a uma fonte com `periodKind: 'snapshot'`, e nenhuma das três existentes é
  // assim: toda chamada com `tipo: 'snapshot'` passava no Zod e morria no motor
  // com "esta fonte cobre um intervalo". As duas voltam juntas quando o balanço
  // virar fonte de verdade.
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
  excluirBalanco: z.boolean().default(true)
    .describe(
      'Deixa de fora as naturezas de Balanço (ativo, passivo, patrimônio líquido). ' +
      'Padrão true: somar ativo com receita produz número sem significado.'),

  /**
   * Respeita as marcações `hide_in_dre` / `hide_in_cashflow` do plano de contas.
   *
   * Padrão `todas` — a ocultação é decisão de apresentação de uma tela
   * específica, e o motor não deve escondê-la por conta própria.
   *
   * A `.describe()` existe porque a JSDoc NÃO chega ao modelo: `z.toJSONSchema`
   * só publica o que vem de `.describe()`. Sem ela o modelo via o enum cru
   * `['dre','caixa','todas']` e nenhuma pista do que escolher — foi assim que,
   * em 26/ago, o expert concluiu que não dava para montar um gráfico OPEX ×
   * CAPEX: ele estava somando as transferências, que o cliente já havia marcado
   * como ocultas, e não sabia que existia um filtro que as respeitasse.
   */
  visibilidade: z.enum(['dre', 'caixa', 'todas']).default('todas')
    .describe(
      'Respeita os selos "ocultar na DRE" / "ocultar no Fluxo" do plano de contas — que o cliente ' +
      'usa para tirar de análise o que é transitório (transferência entre contas próprias, ' +
      'devolução, suprimento de caixa). Ocultar uma natureza PAI oculta o ramo inteiro. ' +
      'Padrão "todas": nada é escondido, e é a escolha certa para conferir contra o extrato. ' +
      'Use "caixa" em qualquer leitura de fluxo de caixa e "dre" em leitura de resultado — ' +
      'INCLUSIVE ao agrupar por opex_capex, senão as transferências entram no balde CAPEX e ' +
      'distorcem o número (medido numa base real: CAPEX ia de -50.572 para -88.528 ao filtrar).'),
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
  agruparPor: z.array(z.enum(GROUPING_IDS)).max(AGRUPAR_MAX).default([])
    .describe(
      `Até ${AGRUPAR_MAX} eixos. "opex_capex" separa operacional de não-operacional e vem da ` +
      'natureza PAI — combine com filtros.visibilidade = "caixa", ou as transferências entre ' +
      'contas próprias caem no balde CAPEX.'),
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
