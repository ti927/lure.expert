/**
 * Templates CSV pré-definidos para cada dimensão.
 *
 * Os cabeçalhos NÃO são mutáveis — o parser depende dos nomes exatos. Para
 * baixar use `downloadTemplate()` em componente cliente.
 */

const BOM = '﻿'

export type DimensionKind = 'categorias' | 'centros-de-custo' | 'unidades-de-negocio' | 'entidades-juridicas'

interface TemplateSpec {
  filename: string
  headers: readonly string[]
  sampleRows: readonly (readonly string[])[]
}

export const TEMPLATES: Record<DimensionKind, TemplateSpec> = {
  categorias: {
    filename: 'modelo-categorias.csv',
    headers: ['codigo', 'tipo natureza', 'natureza pai', 'natureza filho'] as const,
    sampleRows: [
      ['3.1.01', 'sga', 'Despesas com Pessoal', 'Salários'],
      ['3.1.02', 'sga', 'Despesas com Pessoal', 'Vale Transporte'],
      ['3.2.01', 'sga', 'Despesas Administrativas', 'Aluguel'],
      ['3.2.02', 'sga', 'Despesas Administrativas', 'Energia Elétrica'],
    ],
  },
  'centros-de-custo': {
    filename: 'modelo-centros-de-custo.csv',
    headers: ['codigo', 'nome'] as const,
    sampleRows: [
      ['CC01', 'Comercial'],
      ['CC02', 'Operações'],
      ['CC03', 'Administrativo'],
    ],
  },
  'unidades-de-negocio': {
    filename: 'modelo-unidades-de-negocio.csv',
    headers: ['codigo', 'nome'] as const,
    sampleRows: [
      ['UN01', 'Restaurante'],
      ['UN02', 'Eventos'],
    ],
  },
  'entidades-juridicas': {
    filename: 'modelo-entidades-juridicas.csv',
    headers: ['codigo', 'nome', 'cnpj'] as const,
    sampleRows: [
      ['EJ01', 'Matriz Ltda', '12.345.678/0001-90'],
      ['EJ02', 'Filial SP Ltda', '12.345.678/0002-71'],
    ],
  },
}

export const CATEGORY_HEADERS = TEMPLATES.categorias.headers
export const COST_CENTER_HEADERS = TEMPLATES['centros-de-custo'].headers
export const BUSINESS_UNIT_HEADERS = TEMPLATES['unidades-de-negocio'].headers
export const LEGAL_ENTITY_HEADERS = TEMPLATES['entidades-juridicas'].headers

/**
 * Orçamento — grade de 12 meses, uma linha por lançamento.
 *
 * Formato escolhido porque é o que já existe no mundo: quem tem orçamento hoje
 * tem numa planilha com as categorias nas linhas e os meses nas colunas. Uma
 * linha por ocorrência obrigaria a explodir 12 vezes o que é um lançamento só.
 *
 * `categoria` aceita o código (3.2.01) ou o nome da natureza filho (Aluguel).
 * As colunas opcionais podem ser omitidas do arquivo inteiro.
 */
export const BUDGET_CSV = {
  filename: 'modelo-orcamento.csv',
  required: ['categoria', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
             'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const,
  optional: ['descricao', 'tipo', 'centro de custo', 'unidade de negocio',
             'entidade juridica', 'observacao'] as const,
  sampleRows: [
    ['Receita de vendas', 'Faturamento previsto', 'entrada', '', '', '', '',
     '120000', '120000', '120000', '135000', '135000', '135000', '140000', '140000', '150000', '160000', '190000', '210000'],
    ['Aluguel', 'Aluguel da matriz', 'saida', 'Administrativo', '', '', '',
     '8500', '8500', '8500', '8500', '8900', '8900', '8900', '8900', '8900', '8900', '8900', '8900'],
    ['13º salário', '', 'saida', '', '', '', 'metade em nov, metade em dez',
     '', '', '', '', '', '', '', '', '', '', '42000', '42000'],
  ],
} as const

/** Ordem das colunas no modelo baixado: as opcionais antes da grade de meses. */
const BUDGET_TEMPLATE_HEADERS = [
  'categoria', 'descricao', 'tipo', 'centro de custo', 'unidade de negocio',
  'entidade juridica', 'observacao',
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez',
] as const

export function buildBudgetTemplateCsv(): string {
  const lines = [
    BUDGET_TEMPLATE_HEADERS.join(';'),
    ...BUDGET_CSV.sampleRows.map((r) => r.join(';')),
  ]
  return BOM + lines.join('\r\n') + '\r\n'
}

export function buildTemplateCsv(kind: DimensionKind): string {
  const spec = TEMPLATES[kind]
  const lines = [spec.headers.join(';'), ...spec.sampleRows.map((r) => r.join(';'))]
  return BOM + lines.join('\r\n') + '\r\n'
}

/** Dispara download de um CSV já montado. Só funciona no cliente. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Dispara download do template no navegador. Só funciona em ambiente cliente.
 */
export function downloadTemplate(kind: DimensionKind): void {
  downloadCsv(TEMPLATES[kind].filename, buildTemplateCsv(kind))
}
