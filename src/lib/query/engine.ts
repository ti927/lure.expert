// O motor. A ÚNICA função de `src/lib/query/**` que chama o banco.
//
// Duas invariantes valem para tudo que sai daqui:
//
// 1. O predicado de organização é emitido PELO MOTOR, a partir de
//    `scope.organizationId` e de `src.orgColumn`. A fonte não escreve a
//    cláusula, então fonte nova não tem onde esquecê-la.
// 2. Nada que venha do chamador chega a `sql.raw`. Todo fragmento cru sai de um
//    descritor indexado por enum Zod — é a mesma defesa que `sql-dimensions.ts`
//    já documenta, estendida a medidas, agrupamentos e joins.

import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { DIM_NONE } from '@/lib/dre-types'
import { GROUPINGS, type GroupingId } from './groupings'
import { MEASURES, type MeasureId } from './measures'
import { SOURCES, type JoinId, type GroupingSql } from './sources'
import { QueryValidationError } from './errors'
import type { QueryScope } from './scope'
import {
  querySpecSchema, type QueryInput, type QuerySpec, type QueryResult, type QueryRow,
} from './spec'

/**
 * Agrupamentos de tempo, construídos pelo motor.
 *
 * O formato entra por `sql.raw` a partir deste mapa fechado — nunca do
 * chamador. A unidade vai parametrizada.
 */
const GRUPO_TEMPORAL: Partial<Record<GroupingId, { unidade: string; formato: string }>> = {
  dia:       { unidade: 'day',     formato: 'YYYY-MM-DD' },
  // A chave é a segunda-feira (DATE_TRUNC('week') é ISO, semana começa na
  // segunda) — a mesma convenção do agrupamento que o dashboard fazia no
  // cliente com `startOfWeek(…, { weekStartsOn: 1 })`.
  semana:    { unidade: 'week',    formato: 'YYYY-MM-DD' },
  mes:       { unidade: 'month',   formato: 'YYYY-MM' },
  trimestre: { unidade: 'quarter', formato: 'YYYY-"T"Q' },
  ano:       { unidade: 'year',    formato: 'YYYY' },
}

/** Dimensão do filtro → coluna da view. Union fechado; nada vem do chamador. */
const COLUNA_DIMENSAO = {
  centrosDeCusto:    'cost_center_id',
  unidadesDeNegocio: 'business_unit_id',
  entidadesLegais:   'legal_entity_id',
  contatos:          'contact_id',
} as const
type ChaveDimensao = keyof typeof COLUNA_DIMENSAO

/**
 * Resolve o período em datas concretas.
 *
 * `relativo` vira intervalo aqui, e não no SQL, para o resultado poder dizer
 * qual janela foi de fato consultada — um gráfico de "últimos 12 meses" que não
 * declara o período fica impossível de conferir.
 *
 * O tipo de retorno mantém a forma `{ em }` porque `QueryResult.periodo` a
 * declara: quando o balanço virar fonte, a variante `snapshot` volta ao schema e
 * este é o ponto que a produz.
 */
function resolverPeriodo(spec: QuerySpec): { de: string; ate: string } | { em: string } {
  const p = spec.periodo
  if (p.tipo === 'intervalo') {
    if (p.de > p.ate) {
      throw new QueryValidationError('periodo', `A data inicial (${p.de}) é depois da final (${p.ate}).`)
    }
    return { de: p.de, ate: p.ate }
  }
  // Relativo: fecha no último dia do mês corrente e volta N meses.
  const hoje = new Date()
  const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0))
  const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - (p.meses - 1), 1))
  return { de: ini.toISOString().slice(0, 10), ate: fim.toISOString().slice(0, 10) }
}

/**
 * Filtro de uma dimensão, com o sentinela `__null__`.
 *
 * Mesma semântica de `dimensionFilters`: só o sentinela vira `IS NULL`;
 * sentinela junto de ids vira disjunção — sem isso, marcar "Sem centro de
 * custo" e "Comercial" devolveria só o Comercial.
 */
function filtroDimensao(alias: string, coluna: string, ids: string[] | undefined): SQL | null {
  if (!ids?.length) return null
  const col = sql.raw(`${alias}.${coluna}`)
  const uuids = ids.filter(id => id !== DIM_NONE)
  const querNulo = uuids.length !== ids.length

  if (uuids.length === 0) return sql`${col} IS NULL`
  const lista = sql`${col} IN (${sql.join(uuids.map(id => sql`${id}::uuid`), sql`, `)})`
  return querNulo ? sql`(${lista} OR ${col} IS NULL)` : lista
}

/**
 * Arredonda a medida conforme o formato que ela declara.
 *
 * Somas de `numeric` já vêm com 2 casas do Postgres, mas as medidas que DIVIDEM
 * (hoje `ticket_medio`) voltavam com a precisão inteira do float:
 * `3644.0337614678897` ao lado de `197900.26`. Quem lê conclui que a medida tem
 * outra natureza, e um modelo repassa o número cru ao usuário. Achado 6 do
 * diagnóstico de 26/ago.
 */
function arredondar(id: MeasureId, bruto: unknown): number {
  const n = Number(bruto ?? 0)
  if (!Number.isFinite(n)) return 0
  return MEASURES[id].formato === 'moeda' ? Math.round(n * 100) / 100 : n
}

export async function runQuery(scope: QueryScope, input: QueryInput): Promise<QueryResult> {
  const parsed = querySpecSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new QueryValidationError(issue.path.join('.') || 'spec', issue.message)
  }
  const spec = parsed.data

  const src = SOURCES[spec.fonte]
  if (!src) {
    throw new QueryValidationError('fonte', `Fonte "${spec.fonte}" ainda não está disponível.`,
      Object.keys(SOURCES))
  }

  // ── Período e regime ──────────────────────────────────────────────────────
  const periodo = resolverPeriodo(spec)
  // Fonte de snapshot com o schema atual é combinação impossível — a variante
  // `snapshot` saiu do período em 26/ago, junto com a fonte `balanco`. A guarda
  // fica porque `periodKind` continua no descritor: uma fonte declarada
  // 'snapshot' hoje seria consultada como intervalo, em silêncio, e o número
  // sairia errado sem ninguém perceber.
  if (src.periodKind === 'snapshot') {
    throw new QueryValidationError('fonte',
      `A fonte "${spec.fonte}" é uma foto numa data e ainda não é consultável por aqui.`,
      Object.keys(SOURCES))
  }

  const regime = spec.periodo.regime
  const colunaData = src.dateColumns[regime]
  if (!colunaData) {
    throw new QueryValidationError('periodo.regime',
      `A fonte "${spec.fonte}" não suporta o regime "${regime}".`,
      Object.keys(src.dateColumns))
  }

  // ── Agrupamentos e medidas ────────────────────────────────────────────────
  const joins = new Set<JoinId>()

  const grupos = spec.agruparPor.map((g: GroupingId) => {
    // Temporais são construídos aqui, sobre a coluna de data JÁ RESOLVIDA pelo
    // regime. Deixar isso na fonte prenderia o agrupamento a uma coluna fixa e
    // faria "por mês em regime de caixa" agrupar pela data de competência.
    const temporal = GRUPO_TEMPORAL[g]
    if (temporal) {
      // Unidade e formato entram por `raw` a partir do mapa fechado acima, e
      // não como parâmetro: parametrizados, cada ocorrência da expressão vira
      // um placeholder diferente, e o Postgres deixa de reconhecer SELECT e
      // GROUP BY como a mesma coisa.
      const expr = sql`TO_CHAR(DATE_TRUNC(${sql.raw(`'${temporal.unidade}'`)}, ${colunaData}), ${sql.raw(`'${temporal.formato}'`)})`
      return { id: g, d: { chave: expr, rotulo: expr } as GroupingSql }
    }

    const d = src.groupings[g]
    if (!d) {
      throw new QueryValidationError('agruparPor',
        `A fonte "${spec.fonte}" não pode ser agrupada por "${g}".`,
        [...Object.keys(src.groupings), ...Object.keys(GRUPO_TEMPORAL)])
    }
    d.joins?.forEach(j => joins.add(j))
    return { id: g, d }
  })

  const medidas = spec.medidas.map((m: MeasureId) => {
    const d = src.measures[m]
    if (!d) {
      throw new QueryValidationError('medidas',
        `A medida "${m}" não existe na fonte "${spec.fonte}".`,
        Object.keys(src.measures))
    }
    d.joins?.forEach(j => joins.add(j))
    return { id: m, d }
  })

  const base = src.baseFilters(spec)
  base.joins.forEach(j => joins.add(j))

  // ── Filtros de dimensão ───────────────────────────────────────────────────
  const condicoes: SQL[] = []
  for (const chave of Object.keys(COLUNA_DIMENSAO) as ChaveDimensao[]) {
    const ids = spec.filtros[chave]
    if (!ids?.length) continue
    if (!src.supportedDimensions.includes(chave)) {
      throw new QueryValidationError(`filtros.${chave}`,
        `A fonte "${spec.fonte}" não tem a dimensão "${chave}".`,
        src.supportedDimensions)
    }
    const f = filtroDimensao(src.alias, COLUNA_DIMENSAO[chave], ids)
    if (f) condicoes.push(f)
  }

  const exigeColuna = (chave: 'categoria' | 'conta' | 'direcao', campo: string) => {
    const col = src.filterColumns[chave]
    if (!col) {
      throw new QueryValidationError(`filtros.${campo}`,
        `A fonte "${spec.fonte}" não tem "${chave}".`,
        Object.keys(src.filterColumns))
    }
    return col
  }

  if (spec.filtros.direcao) {
    condicoes.push(sql`${exigeColuna('direcao', 'direcao')} = ${spec.filtros.direcao}`)
  }
  if (spec.filtros.categorias?.length) {
    condicoes.push(sql`${exigeColuna('categoria', 'categorias')} IN (${
      sql.join(spec.filtros.categorias.map(id => sql`${id}::uuid`), sql`, `)
    })`)
  }
  if (spec.filtros.contas?.length) {
    condicoes.push(sql`${exigeColuna('conta', 'contas')} IN (${
      sql.join(spec.filtros.contas.map(a => sql`${a}`), sql`, `)
    })`)
  }
  if (spec.filtros.tiposDeCategoria?.length) {
    joins.add('categoria')
    condicoes.push(sql`cat.type IN (${
      sql.join(spec.filtros.tiposDeCategoria.map(x => sql`${x}`), sql`, `)
    })`)
  }

  // ── Montagem ──────────────────────────────────────────────────────────────
  const joinSql = Array.from(joins)
    .map(j => src.joins[j])
    .filter((x): x is SQL => !!x)

  // GROUP BY por POSIÇÃO, não repetindo a expressão. Repetir obriga o Postgres
  // a reconhecer os dois textos como equivalentes — o que falha assim que a
  // expressão tem qualquer parâmetro — e ainda avalia a expressão duas vezes.
  const selects: SQL[] = []
  const groupBy: SQL[] = []
  let pos = 0
  const posicionar = (expr: SQL, alias: string) => {
    selects.push(sql`${expr} AS ${sql.raw(alias)}`)
    pos += 1
    groupBy.push(sql.raw(String(pos)))
  }
  grupos.forEach((g, i) => {
    posicionar(g.d.chave,  `k${i}`)
    posicionar(g.d.rotulo, `l${i}`)
    if (g.d.ordem) posicionar(g.d.ordem, `o${i}`)
  })
  medidas.forEach((m, i) => selects.push(sql`${m.d.expr} AS ${sql.raw(`m${i}`)}`))

  const ordenacao = montarOrdenacao(spec, grupos, medidas)
  const periodoSql = 'em' in periodo
    ? sql`AND ${colunaData} <= ${periodo.em}::date`
    : sql`AND ${colunaData} >= ${periodo.de}::date AND ${colunaData} <= ${periodo.ate}::date`

  const where = condicoes.length > 0
    ? sql` AND ${sql.join(condicoes, sql` AND `)}`
    : sql``

  // O `limite + 1` é o que permite dizer "truncado" sem uma segunda contagem.
  const query = sql`
    SELECT ${sql.join(selects, sql`, `)}
    FROM ${src.from}
    ${joinSql.length ? sql.join(joinSql, sql` `) : sql``}
    WHERE ${sql.raw(src.orgColumn)} = ${scope.organizationId}::uuid
      ${periodoSql}
      ${base.where}
      ${where}
    ${groupBy.length ? sql`GROUP BY ${sql.join(groupBy, sql`, `)}` : sql``}
    ${ordenacao}
    LIMIT ${spec.limite + 1}
  `

  const linhasBrutas = await db.execute<Record<string, unknown>>(query)
  const truncado = linhasBrutas.length > spec.limite
  const usadas = truncado ? linhasBrutas.slice(0, spec.limite) : linhasBrutas

  const linhas: QueryRow[] = usadas.map(r => ({
    chaves: grupos.map((g, i) => {
      const id = r[`k${i}`]
      const rotulo = r[`l${i}`]
      return {
        campo:  g.id,
        id:     id === null || id === undefined ? null : String(id),
        rotulo: rotulo === null || rotulo === undefined
          ? GROUPINGS[g.id].rotuloVazio
          : String(rotulo),
      }
    }),
    medidas: Object.fromEntries(medidas.map((m, i) => [m.id, arredondar(m.id, r[`m${i}`])])),
  }))

  return {
    fonte:      spec.fonte,
    agruparPor: spec.agruparPor,
    medidas:    spec.medidas,
    linhas,
    truncado,
    periodo,
  }
}

/**
 * ORDER BY.
 *
 * Sem ordenação explícita: agrupamento temporal ordena cronologicamente (um
 * gráfico de meses fora de ordem é inútil), e qualquer outro ordena pela
 * primeira medida, decrescente — que é o que "top N" quer dizer.
 */
function montarOrdenacao(
  spec: QuerySpec,
  grupos: Array<{ id: GroupingId }>,
  medidas: Array<{ id: MeasureId }>,
): SQL {
  const alvos: SQL[] = []

  for (const o of spec.ordenarPor) {
    const iGrupo = grupos.findIndex(g => g.id === o.por)
    const iMedida = medidas.findIndex(m => m.id === o.por)
    if (iGrupo === -1 && iMedida === -1) {
      throw new QueryValidationError('ordenarPor',
        `"${o.por}" não está entre os agrupamentos nem as medidas desta consulta.`,
        [...grupos.map(g => g.id), ...medidas.map(m => m.id)])
    }
    const col = iGrupo >= 0 ? `k${iGrupo}` : `m${iMedida}`
    alvos.push(sql`${sql.raw(col)} ${sql.raw(o.direcao === 'asc' ? 'ASC' : 'DESC')} NULLS LAST`)
  }

  if (alvos.length === 0) {
    const iTemporal = grupos.findIndex(g => GROUPINGS[g.id].temporal)
    if (iTemporal >= 0) alvos.push(sql`${sql.raw(`k${iTemporal}`)} ASC NULLS LAST`)
    else if (grupos.length > 0 && medidas.length > 0) alvos.push(sql`m0 DESC NULLS LAST`)
  }

  return alvos.length ? sql`ORDER BY ${sql.join(alvos, sql`, `)}` : sql``
}

/**
 * Resolve a consulta sem executá-la — para o modelo conferir o que pediu antes
 * de gastar uma ida ao banco, e para a tela mostrar o que um bloco vai fazer.
 */
export function explicarQuery(input: QueryInput) {
  const parsed = querySpecSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new QueryValidationError(issue.path.join('.') || 'spec', issue.message)
  }
  const spec = parsed.data
  const src = SOURCES[spec.fonte]
  if (!src) {
    throw new QueryValidationError('fonte', `Fonte "${spec.fonte}" ainda não está disponível.`,
      Object.keys(SOURCES))
  }
  return {
    fonte:      spec.fonte,
    periodo:    resolverPeriodo(spec),
    regime:     spec.periodo.regime,
    agruparPor: spec.agruparPor.map(g => ({ id: g, rotulo: GROUPINGS[g].rotulo })),
    medidas:    spec.medidas.map(m => ({ id: m, rotulo: MEASURES[m].rotulo, formato: MEASURES[m].formato })),
    limite:     spec.limite,
  }
}
