// Por que se quebra. Como nas medidas, o SQL vive no descritor da fonte; aqui
// ficam identificador, rótulo e o que a linha vazia significa.
//
// É este catálogo que resolve o pedido que originou o motor: "top 5 UENs" é
// `agruparPor: ['unidade_de_negocio']`. Até a Fase 1 nenhuma consulta do app
// agrupava por unidade de negócio — `getTopExpenseCategories` só sabia
// categoria, com `LIMIT 5` cravado no SQL.

export const GROUPING_IDS = [
  'dia',
  'semana',
  'mes',
  'trimestre',
  'ano',
  'categoria',
  'categoria_pai',
  'tipo',
  'centro_de_custo',
  'unidade_de_negocio',
  'entidade_legal',
  'contato',
  'conta',
  'direcao',
  'opex_capex',
] as const

export type GroupingId = (typeof GROUPING_IDS)[number]

export interface GroupingMeta {
  rotulo: string
  /** O que aparece quando o campo está vazio. Nunca esconder a linha. */
  rotuloVazio: string
  /** Agrupamento de tempo — o motor usa para ordenar cronologicamente. */
  temporal?: boolean
}

export const GROUPINGS: Record<GroupingId, GroupingMeta> = {
  dia:                { rotulo: 'Dia',                 rotuloVazio: 'Sem data',              temporal: true },
  // A chave é a segunda-feira da semana (DATE_TRUNC('week') é ISO) — a mesma
  // convenção do agrupamento semanal que o dashboard sempre fez no cliente.
  semana:             { rotulo: 'Semana',              rotuloVazio: 'Sem data',              temporal: true },
  mes:                { rotulo: 'Mês',                 rotuloVazio: 'Sem data',              temporal: true },
  trimestre:          { rotulo: 'Trimestre',           rotuloVazio: 'Sem data',              temporal: true },
  ano:                { rotulo: 'Ano',                 rotuloVazio: 'Sem data',              temporal: true },
  categoria:          { rotulo: 'Natureza',            rotuloVazio: 'Sem natureza' },
  categoria_pai:      { rotulo: 'Natureza pai',        rotuloVazio: 'Sem natureza' },
  tipo:               { rotulo: 'Tipo',                rotuloVazio: 'Sem natureza' },
  centro_de_custo:    { rotulo: 'Centro de custo',     rotuloVazio: 'Sem centro de custo' },
  unidade_de_negocio: { rotulo: 'Unidade de negócio',  rotuloVazio: 'Sem unidade' },
  entidade_legal:     { rotulo: 'Entidade jurídica',   rotuloVazio: 'Sem entidade' },
  contato:            { rotulo: 'Cliente/fornecedor',  rotuloVazio: 'Sem contato' },
  conta:              { rotulo: 'Conta',               rotuloVazio: 'Sem conta' },
  direcao:            { rotulo: 'Sentido',             rotuloVazio: '—' },
  opex_capex:         { rotulo: 'OPEX/CAPEX',          rotuloVazio: 'Não classificado' },
}
