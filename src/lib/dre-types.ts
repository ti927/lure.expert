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

/**
 * Sentinela de "sem esta dimensão preenchida" nos filtros de dimensão.
 *
 * Mora aqui, e não em `dim-filter.tsx` (client) nem em `sql-dimensions.ts`
 * (server-only, importa drizzle), porque os dois lados precisam do MESMO valor:
 * o cliente o emite e o SQL o traduz para `IS NULL`.
 */
export const DIM_NONE = '__null__'

export interface DreFilters {
  from: string               // YYYY-MM-DD
  to: string                 // YYYY-MM-DD
  costCenterIds?: string[]
  businessUnitIds?: string[]
  legalEntityIds?: string[]
  contactIds?: string[]
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
  id:                  string
  date:                string
  description:         string
  direction:           string
  amount:              number
  netAmount:           number
  categoryId:          string | null
  categoryName:        string | null
  costCenterId:        string | null
  costCenterName:      string | null
  businessUnitId:      string | null
  businessUnitName:    string | null
  legalEntityId:       string | null
  legalEntityName:     string | null
  contactId:           string | null
  contactName:         string | null
  /**
   * Preenchidos pela view `transaction_lines`. Quando `isAllocated` é true esta
   * linha é uma PARTE de um lançamento rateado: as dimensões vieram da parte, e
   * editá-las direto no lançamento seria recusado pelo banco (com rateio, as
   * dimensões do pai têm de ficar vazias). A UI trata a célula como leitura até
   * a 10.4 trazer a edição da parte.
   */
  allocationId:        string | null
  isAllocated:         boolean
  // Contexto da conta bancária (Sessão drill-down v2)
  accountId:           string | null
  accountName:         string | null
  accountType:         string | null
  accountNumber:       string | null
  connectionLogoUrl:   string | null
  connectionBadge:     string | null
  // Hierarquia da categoria (usado nos subtotais do drill-down)
  parentCategoryId:    string | null
  parentCategoryName:  string | null
  parentCategoryType:  string | null
}

export interface LeafCategory {
  id:       string
  name:     string
  code:     string | null
  type:     string
  parentId: string | null
}
