// Constantes e tipos públicos do DRE — importáveis por client e server components
// (sem 'use server', pois exporta objetos e tipos além de funções)

export const DRE_TYPES = [
  'receita_operacional',
  'deducoes_tributarias',
  'deducoes_operacionais',
  'cpv',
  'sga',
  'resultado_financeiro',
  'ir',
  'emprestimos_amortizacoes',
  'investimentos_retiradas',
  'transfer',
] as const

export type DreType = (typeof DRE_TYPES)[number]

export const DRE_TYPE_LABELS: Record<DreType, string> = {
  receita_operacional:      'Receita Operacional',
  deducoes_tributarias:     'Deduções Tributárias',
  deducoes_operacionais:    'Deduções Operacionais',
  cpv:                      'Custo dos Produtos/Serviços Vendidos',
  sga:                      'Despesas SG&A',
  resultado_financeiro:     'Resultado Financeiro',
  ir:                       'IR e CSLL',
  emprestimos_amortizacoes: 'Empréstimos e Amortizações',
  investimentos_retiradas:  'Investimentos e Retiradas',
  transfer:                 'Transferências',
}

// Tipos de BP — excluídos da DRE (não aparecem no P&L operacional)
export const BP_TYPES = [
  'ativo_circulante',
  'ativo_nao_circulante',
  'passivo_circulante',
  'passivo_nao_circulante',
  'patrimonio_liquido',
] as const

export interface DreFilters {
  from: string               // YYYY-MM-DD
  to: string                 // YYYY-MM-DD
  costCenterIds?: string[]
  businessUnitIds?: string[]
  legalEntityIds?: string[]
}

export interface DreCategoryRow {
  categoryId:       string
  categoryName:     string
  categoryCode:     string
  categoryType:     DreType
  parentId:         string
  parentName:       string
  parentCode:       string
  month:            string   // YYYY-MM
  // net_amount = SUM(inflow) - SUM(outflow) com sinal:
  // positivo = mais entradas que saídas (bom para receitas)
  // negativo = mais saídas que entradas (esperado para custos/despesas)
  netAmount:        number
  totalInflow:      number
  totalOutflow:     number
  transactionCount: number
}

export interface DreMonthSubtotals {
  month:                    string
  receitaBruta:             number
  deducoes:                 number
  receitaLiquida:           number
  cpv:                      number
  lucroBruto:               number
  sga:                      number
  ebitda:                   number
  resultadoFinanceiro:      number
  lair:                     number
  ir:                       number
  lucroLiquido:             number
  // Abaixo da linha (financiamento/investimento)
  emprestimosAmortizacoes:  number
  investimentosRetiradas:   number
  transferencias:           number
  // Variação de caixa total
  variacaoCaixa:            number
}

export interface DreData {
  months:    string[]
  rows:      DreCategoryRow[]
  subtotals: DreMonthSubtotals[]
}

export interface DrillDownTransaction {
  id:          string
  date:        string
  description: string
  direction:   string
  amount:      number
  netAmount:   number  // positivo=inflow, negativo=outflow
}
