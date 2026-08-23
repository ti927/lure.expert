// Fonte `realizado` — o que de fato aconteceu.
//
// Lê `transaction_lines`, NUNCA `transactions`. A view devolve uma linha por
// lançamento sem rateio e uma por parte quando há rateio, com valor e dimensões
// vindos da parte. É a regra da Fase 10.3, e é o que torna correto agrupar por
// centro de custo num lançamento dividido entre dois.
//
// Consequência: `contagem` é sempre `COUNT(DISTINCT transaction_id)`. Sem o
// DISTINCT, um lançamento rateado em três contaria como três, e o campo promete
// lançamentos.

import { sql } from 'drizzle-orm'
import { BP_TYPES } from '@/lib/bp-types'
import type { SourceDescriptor, JoinId } from './types'

const t = 'tl'
const c = 'cat'
const p = 'catpai'

/** Valor com sinal, na convenção do app: entrada soma, saída subtrai. */
const liquido = sql`SUM(CASE WHEN tl.direction = 'inflow' THEN tl.amount::numeric ELSE -tl.amount::numeric END)`

export const realizado: SourceDescriptor = {
  id:    'realizado',
  from:  sql`transaction_lines tl`,
  alias: t,
  orgColumn: 'tl.organization_id',

  periodKind: 'range',
  dateColumns: {
    competencia: sql`tl.date::date`,
    // COALESCE por compatibilidade retroativa: `effective_date` só passou a ser
    // preenchida na Fase 6 (migration 0021), e o histórico anterior é nulo.
    caixa:       sql`COALESCE(tl.effective_date, tl.date)::date`,
  },

  supportedDimensions: ['centrosDeCusto', 'unidadesDeNegocio', 'entidadesLegais', 'contatos'],

  measures: {
    valor_liquido:  { expr: liquido },
    entradas:       { expr: sql`SUM(CASE WHEN tl.direction = 'inflow'  THEN tl.amount::numeric ELSE 0 END)` },
    saidas:         { expr: sql`SUM(CASE WHEN tl.direction = 'outflow' THEN tl.amount::numeric ELSE 0 END)` },
    valor_absoluto: { expr: sql`SUM(tl.amount::numeric)` },
    contagem:       { expr: sql`COUNT(DISTINCT tl.transaction_id)` },
    ticket_medio:   { expr: sql`SUM(tl.amount::numeric) / NULLIF(COUNT(DISTINCT tl.transaction_id), 0)` },
  },

  groupings: {
    mes: {
      chave:  sql`TO_CHAR(DATE_TRUNC('month', tl.date::date), 'YYYY-MM')`,
      rotulo: sql`TO_CHAR(DATE_TRUNC('month', tl.date::date), 'YYYY-MM')`,
    },
    trimestre: {
      chave:  sql`TO_CHAR(DATE_TRUNC('quarter', tl.date::date), 'YYYY-"T"Q')`,
      rotulo: sql`TO_CHAR(DATE_TRUNC('quarter', tl.date::date), 'YYYY-"T"Q')`,
    },
    ano: {
      chave:  sql`TO_CHAR(DATE_TRUNC('year', tl.date::date), 'YYYY')`,
      rotulo: sql`TO_CHAR(DATE_TRUNC('year', tl.date::date), 'YYYY')`,
    },
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
    centro_de_custo: {
      chave:  sql`cc.id::text`,
      rotulo: sql`cc.name`,
      joins:  ['centro_de_custo'],
    },
    unidade_de_negocio: {
      chave:  sql`bu.id::text`,
      rotulo: sql`bu.name`,
      joins:  ['unidade_de_negocio'],
    },
    entidade_legal: {
      chave:  sql`le.id::text`,
      rotulo: sql`le.name`,
      joins:  ['entidade_legal'],
    },
    contato: {
      chave:  sql`ct.id::text`,
      rotulo: sql`ct.name`,
      joins:  ['contato'],
    },
    conta: {
      chave:  sql`tl.account_id`,
      rotulo: sql`COALESCE(tl.account_name, tl.account_number)`,
    },
    direcao: {
      chave:  sql`tl.direction`,
      rotulo: sql`CASE WHEN tl.direction = 'inflow' THEN 'Entrada' ELSE 'Saída' END`,
    },
  },

  // LEFT JOIN em tudo, inclusive natureza. A DRE usa INNER porque desenha uma
  // hierarquia e linha sem pai não tem onde entrar; o motor é genérico e
  // esconder o "sem natureza" faria o total não fechar com o extrato.
  joins: {
    categoria:          sql`LEFT JOIN categories ${sql.raw(c)} ON tl.category_id = ${sql.raw(c)}.id`,
    categoria_pai:      sql`LEFT JOIN categories ${sql.raw(p)} ON ${sql.raw(c)}.parent_id = ${sql.raw(p)}.id`,
    centro_de_custo:    sql`LEFT JOIN cost_centers   cc ON tl.cost_center_id   = cc.id`,
    unidade_de_negocio: sql`LEFT JOIN business_units bu ON tl.business_unit_id = bu.id`,
    entidade_legal:     sql`LEFT JOIN legal_entities le ON tl.legal_entity_id  = le.id`,
    contato:            sql`LEFT JOIN contacts       ct ON tl.contact_id       = ct.id`,
  },

  baseFilters: (spec) => {
    const partes = [
      // Sempre: pendente ainda não é lançamento, duplicado já foi contado.
      sql`AND tl.status NOT IN ('pending', 'duplicate')`,
    ]
    const joins: JoinId[] = []

    if (spec.filtros.excluirBalanco) {
      joins.push('categoria')
      partes.push(sql`AND (${sql.raw(c)}.type IS NULL OR ${sql.raw(c)}.type NOT IN (${
        sql.join(BP_TYPES.map(x => sql`${x}`), sql`, `)
      }))`)
    }
    if (spec.filtros.visibilidade === 'dre') {
      joins.push('categoria')
      partes.push(sql`AND COALESCE(${sql.raw(c)}.hide_in_dre, false) = false`)
    }
    if (spec.filtros.visibilidade === 'caixa') {
      joins.push('categoria')
      partes.push(sql`AND COALESCE(${sql.raw(c)}.hide_in_cashflow, false) = false`)
    }

    return { where: sql.join(partes, sql` `), joins }
  },
}
