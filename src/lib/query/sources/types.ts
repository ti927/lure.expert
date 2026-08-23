import type { SQL } from 'drizzle-orm'
import type { MeasureId } from '../measures'
import type { GroupingId } from '../groupings'
import type { QuerySource, QuerySpec } from '../spec'

/** Chave de um JOIN opcional. O motor só emite os que os agrupamentos pedem. */
export type JoinId =
  | 'categoria' | 'categoria_pai'
  | 'centro_de_custo' | 'unidade_de_negocio' | 'entidade_legal' | 'contato'

export interface MeasureSql {
  /** A expressão agregada. Ex: `SUM(CASE WHEN … END)`. */
  expr: SQL
  /** Alguns agregados dependem de JOIN (raro, mas o motor precisa saber). */
  joins?: JoinId[]
}

export interface GroupingSql {
  /** Identificador da linha — vira `QueryKey.id`. Pode ser nulo. */
  chave: SQL
  /** Texto exibido. Quando nulo, o motor usa `rotuloVazio` do catálogo. */
  rotulo: SQL
  joins?: JoinId[]
  /** Ordenação natural, quando difere do rótulo (ex: código numérico). */
  ordem?: SQL
}

/**
 * Tudo que o motor precisa saber sobre uma fonte.
 *
 * O que NÃO está aqui é tão importante quanto o que está: **a fonte não escreve
 * a cláusula de organização**. Ela declara `orgColumn` e o motor emite o
 * predicado. Uma fonte nova não tem onde esquecer o filtro, porque não tem onde
 * escrevê-lo — é essa a diferença entre garantia e disciplina.
 */
export interface SourceDescriptor {
  id:    QuerySource
  /** Tabela ou view, já com alias. Ex: `sql\`transaction_lines t\`` */
  from:  SQL
  alias: string
  /** Coluna de organização, qualificada. O MOTOR emite o predicado com ela. */
  orgColumn: string

  /**
   * `range` aceita `{de, ate}`; `snapshot` aceita `{em}`. O balanço é snapshot:
   * modelá-lo como intervalo produziria número errado em silêncio.
   */
  periodKind: 'range' | 'snapshot'
  /** Coluna de data por regime. Ausente = regime não suportado pela fonte. */
  dateColumns: Partial<Record<'competencia' | 'caixa', SQL>>

  /** Dimensões que a fonte realmente tem. NF-e só tem entidade e contato. */
  supportedDimensions: Array<'centrosDeCusto' | 'unidadesDeNegocio' | 'entidadesLegais' | 'contatos'>

  measures:  Partial<Record<MeasureId, MeasureSql>>
  groupings: Partial<Record<GroupingId, GroupingSql>>

  /** SQL de cada JOIN opcional. */
  joins: Partial<Record<JoinId, SQL>>

  /**
   * Condições sempre verdadeiras para esta fonte, mais as que dependem da spec
   * (visibilidade, exclusão de balanço). Fragmentos já prefixados com `AND`.
   *
   * Declara os JOINs de que depende: a exclusão de tipos de balanço fala sobre
   * a natureza, e sem isso o SQL referenciaria um alias que só existe quando
   * algum agrupamento pediu aquele JOIN.
   */
  baseFilters: (spec: QuerySpec) => { where: SQL; joins: JoinId[] }
}
