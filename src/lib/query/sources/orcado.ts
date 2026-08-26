// Fonte `orcado` — `budget_entries`, as ocorrências materializadas do orçamento.
//
// Espelha `lib/budget-read.ts` (`fetchBudgetRows`) de propósito: mesmo regime,
// mesma exclusão de tipos de balanço, mesma coluna de visibilidade por regime.
// A conciliação em `scripts/verify-query-engine.ts` roda as duas e compara
// célula a célula. Se divergirem, o errado é o motor, não a função que as duas
// telas de orçamento já usam.
//
// `fetchBudgetRows` NÃO foi reescrita. Ela continua servindo `/dre` e
// `/orcamento`; o motor a reproduz para poder responder perguntas que ela não
// responde — agrupar orçado por unidade de negócio, por exemplo.

import { sql } from 'drizzle-orm'
import { BP_TYPES } from '@/lib/bp-types'
import { filtroDeVisibilidade } from '@/lib/category-visibility'
import { QueryValidationError } from '../errors'
import type { SourceDescriptor, JoinId } from './types'

const c = 'cat'
const p = 'catpai'

export const orcado: SourceDescriptor = {
  id:    'orcado',
  from:  sql`budget_entries be`,
  alias: 'be',
  orgColumn: 'be.organization_id',

  periodKind: 'range',
  dateColumns: {
    // Duas datas por lançamento orçado: competência alimenta a DRE Orçada,
    // caixa alimenta o Fluxo Projetado. Diferente do realizado, `cash_date` é
    // NOT NULL aqui, então não precisa de COALESCE.
    competencia: sql`be.competence_date::date`,
    caixa:       sql`be.cash_date::date`,
  },

  supportedDimensions: ['centrosDeCusto', 'unidadesDeNegocio', 'entidadesLegais', 'contatos'],
  // Sem `conta`: orcamento nao escolhe banco.
  filterColumns: { categoria: sql`be.category_id`, direcao: sql`be.direction` },

  measures: {
    valor_liquido:  { expr: sql`SUM(CASE WHEN be.direction = 'inflow' THEN be.amount::numeric ELSE -be.amount::numeric END)` },
    entradas:       { expr: sql`SUM(CASE WHEN be.direction = 'inflow'  THEN be.amount::numeric ELSE 0 END)` },
    saidas:         { expr: sql`SUM(CASE WHEN be.direction = 'outflow' THEN be.amount::numeric ELSE 0 END)` },
    valor_absoluto: { expr: sql`SUM(be.amount::numeric)` },
    // Sem DISTINCT: orçamento não tem rateio, cada linha é uma ocorrência.
    contagem:       { expr: sql`COUNT(*)` },
    ticket_medio:   { expr: sql`SUM(be.amount::numeric) / NULLIF(COUNT(*), 0)` },
  },

  groupings: {
    categoria: {
      chave:  sql`${sql.raw(c)}.id::text`,
      rotulo: sql`${sql.raw(c)}.name`,
      ordem:  sql`${sql.raw(c)}.code`,
      joins:  ['categoria'],
    },
    categoria_pai: {
      chave:  sql`${sql.raw(p)}.id::text`,
      rotulo: sql`${sql.raw(p)}.name`,
      ordem:  sql`${sql.raw(p)}.code`,
      joins:  ['categoria', 'categoria_pai'],
    },
    tipo: {
      chave:  sql`${sql.raw(c)}.type`,
      rotulo: sql`${sql.raw(c)}.type`,
      joins:  ['categoria'],
    },
    opex_capex: {
      chave:  sql`${sql.raw(p)}.opex_capex`,
      rotulo: sql`${sql.raw(p)}.opex_capex`,
      joins:  ['categoria', 'categoria_pai'],
    },
    centro_de_custo:    { chave: sql`cc.id::text`, rotulo: sql`cc.name`, joins: ['centro_de_custo'] },
    unidade_de_negocio: { chave: sql`bu.id::text`, rotulo: sql`bu.name`, joins: ['unidade_de_negocio'] },
    entidade_legal:     { chave: sql`le.id::text`, rotulo: sql`le.name`, joins: ['entidade_legal'] },
    contato:            { chave: sql`ct.id::text`, rotulo: sql`ct.name`, joins: ['contato'] },
    direcao: {
      chave:  sql`be.direction`,
      rotulo: sql`CASE WHEN be.direction = 'inflow' THEN 'Entrada' ELSE 'Saída' END`,
    },
    // `conta` não existe no orçado: orçamento não escolhe banco.
  },

  joins: {
    categoria:          sql`LEFT JOIN categories ${sql.raw(c)} ON be.category_id = ${sql.raw(c)}.id`,
    categoria_pai:      sql`LEFT JOIN categories ${sql.raw(p)} ON ${sql.raw(c)}.parent_id = ${sql.raw(p)}.id`,
    centro_de_custo:    sql`LEFT JOIN cost_centers   cc ON be.cost_center_id   = cc.id`,
    unidade_de_negocio: sql`LEFT JOIN business_units bu ON be.business_unit_id = bu.id`,
    entidade_legal:     sql`LEFT JOIN legal_entities le ON be.legal_entity_id  = le.id`,
    contato:            sql`LEFT JOIN contacts       ct ON be.contact_id       = ct.id`,
  },

  baseFilters: (spec) => {
    const partes = []
    const joins: JoinId[] = []

    // A versão é obrigatória: sem ela, somaria orçamentos concorrentes do mesmo
    // exercício — o rascunho junto do aprovado. Recusar é melhor que escolher.
    if (!spec.filtros.versaoOrcamento) {
      throw new QueryValidationError('filtros.versaoOrcamento',
        'A fonte "orcado" exige filtros.versaoOrcamento. Sem ela, versões ' +
        'concorrentes do mesmo exercício seriam somadas — o rascunho junto do aprovado.')
    }
    partes.push(sql`AND be.version_id = ${spec.filtros.versaoOrcamento}::uuid`)

    if (spec.filtros.excluirBalanco) {
      joins.push('categoria')
      partes.push(sql`AND (${sql.raw(c)}.type IS NULL OR ${sql.raw(c)}.type NOT IN (${
        sql.join(BP_TYPES.map(x => sql`${x}`), sql`, `)
      }))`)
    }
    // O selo herda do PAI (26/ago): ocultar uma Natureza Pai oculta o ramo. O
    // join do pai NÃO é necessário — `filtroDeVisibilidade` usa um EXISTS com
    // alias próprio, então o predicado vale mesmo quando a consulta não agrupa
    // por natureza pai.
    if (spec.filtros.visibilidade === 'dre') {
      joins.push('categoria')
      partes.push(filtroDeVisibilidade(c, 'hide_in_dre'))
    }
    if (spec.filtros.visibilidade === 'caixa') {
      joins.push('categoria')
      partes.push(filtroDeVisibilidade(c, 'hide_in_cashflow'))
    }

    return { where: sql.join(partes, sql` `), joins }
  },
}
