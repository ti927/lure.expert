// O que se soma. O SQL de cada medida vive no descritor da FONTE — o mesmo
// `valor_liquido` é um CASE sobre `direction` no realizado e uma soma simples no
// orçado. Aqui ficam só o identificador, o rótulo e a semântica, que é o que a
// ferramenta MCP descreve para o modelo escolher.

export const MEASURE_IDS = [
  'valor_liquido',
  'entradas',
  'saidas',
  'valor_absoluto',
  'contagem',
  'ticket_medio',
] as const

export type MeasureId = (typeof MEASURE_IDS)[number]

export interface MeasureMeta {
  rotulo:    string
  descricao: string
  formato:   'moeda' | 'inteiro'
}

export const MEASURES: Record<MeasureId, MeasureMeta> = {
  valor_liquido: {
    rotulo: 'Valor líquido',
    descricao:
      'Entradas menos saídas, com sinal. É a convenção do app: receita positiva, ' +
      'despesa negativa. Use para resultado; para ranking de despesa prefira `saidas`.',
    formato: 'moeda',
  },
  entradas: {
    rotulo: 'Entradas',
    descricao: 'Soma apenas do que entrou, sempre positiva.',
    formato: 'moeda',
  },
  saidas: {
    rotulo: 'Saídas',
    descricao:
      'Soma apenas do que saiu, sempre positiva. É a medida certa para ' +
      '"maiores despesas" — `valor_liquido` compensaria com eventuais estornos.',
    formato: 'moeda',
  },
  valor_absoluto: {
    rotulo: 'Movimentação',
    descricao: 'Soma dos valores ignorando o sentido. Serve para volume, não para resultado.',
    formato: 'moeda',
  },
  contagem: {
    rotulo: 'Lançamentos',
    descricao:
      'Quantos lançamentos, não quantas linhas. Um lançamento rateado em três ' +
      'partes conta como um.',
    formato: 'inteiro',
  },
  ticket_medio: {
    rotulo: 'Ticket médio',
    descricao: 'Movimentação dividida pela quantidade de lançamentos.',
    formato: 'moeda',
  },
}
