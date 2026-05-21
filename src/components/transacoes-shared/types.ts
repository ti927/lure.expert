// Tipos e constantes compartilhados entre a tabela /transacoes e o drill-down /dre.
// Mantido aqui para evitar import cíclico vindo das telas.

export const CATEGORY_TYPE_LABELS: Record<string, string> = {
  receita_operacional:       'Receita Operacional',
  deducoes_tributarias:      'Deduções Tributárias',
  deducoes_operacionais:     'Deduções Operacionais',
  cpv:                       'CPV / CMV / CSP',
  sga:                       'SG&A',
  resultado_financeiro:      'Receitas & Despesas Financeiras',
  ir:                        'Impostos Sobre Renda',
  emprestimos_amortizacoes:  'Empréstimos & Amortizações',
  investimentos_retiradas:   'Investimentos & Retiradas',
  transfer:                  'Transitórios',
  ativo_circulante:          'Ativo Circulante',
  ativo_nao_circulante:      'Ativo Não-Circulante',
  passivo_circulante:        'Passivo Circulante',
  passivo_nao_circulante:    'Passivo Não-Circulante',
  patrimonio_liquido:        'Patrimônio Líquido',
}

export const ACCT_LABELS: Record<string, string> = {
  CHECKING_ACCOUNT: 'C. Corrente',
  SAVINGS_ACCOUNT:  'Poupança',
  CREDIT_CARD:      'Cartão',
}

export interface DimensionOption {
  id: string
  label: string
}

export interface GroupedDimensionOption {
  type: string
  items: DimensionOption[]
}

export interface SimpleDimensionItem {
  id: string
  name: string
  code?: string | null
}

export interface CategoryItem {
  id: string
  name: string
  code: string | null
  type: string
  parentId: string | null
}

export interface BatchFormState {
  categoryId: string
  costCenterId: string
  businessUnitId: string
  legalEntityId: string
}
