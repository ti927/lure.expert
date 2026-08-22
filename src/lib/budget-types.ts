// Constantes, tipos e schemas Zod do módulo de Orçamento — importáveis por
// client e server components (sem 'use server', pois exporta objetos além de funções).
//
// ─── Duas convenções que valem para o módulo inteiro ─────────────────────────
//
// SINAL:  `amount` é SEMPRE positivo; o sinal vem de `direction`, idêntico a
//         `transactions`. Na comparação, com netAmount (despesa negativa),
//         `variação = realizado − orçado` já é "favorável quando positivo"
//         tanto para receita quanto para despesa.
//
// DATA:   `competenceDate` alimenta a DRE Orçada; `cashDate` alimenta o Fluxo
//         Projetado — espelha `transactions.date` vs `effective_date`.
//
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod'
import type { DreType } from './dre-types'

// ─── Status da versão ─────────────────────────────────────────────────────────

export const BUDGET_STATUSES = ['rascunho', 'aprovado', 'arquivado'] as const
export type BudgetStatus = (typeof BUDGET_STATUSES)[number]

export const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  rascunho:  'Rascunho',
  aprovado:  'Aprovado',
  arquivado: 'Arquivado',
}

// ─── Origem da série ──────────────────────────────────────────────────────────

export const BUDGET_SOURCES = [
  'manual',
  'copia_realizado',
  'csv',
  'recorrencia_detectada',
  'duplicacao',
] as const
export type BudgetSource = (typeof BUDGET_SOURCES)[number]

export const BUDGET_SOURCE_LABELS: Record<BudgetSource, string> = {
  manual:                'Manual',
  copia_realizado:       'Copiado do realizado',
  csv:                   'Importado de planilha',
  recorrencia_detectada: 'Recorrência detectada',
  duplicacao:            'Duplicação de versão',
}

// ─── Modo de valor da série ───────────────────────────────────────────────────

export const AMOUNT_MODES = ['fixo', 'reajuste', 'sazonal', 'parcelado'] as const
export type AmountMode = (typeof AMOUNT_MODES)[number]

export const AMOUNT_MODE_LABELS: Record<AmountMode, string> = {
  fixo:      'Valor fixo',
  reajuste:  'Com reajuste',
  sazonal:   'Valor por mês',
  parcelado: 'Parcelamento de um total',
}

export const AMOUNT_MODE_HINTS: Record<AmountMode, string> = {
  fixo:      'O mesmo valor em todas as ocorrências.',
  reajuste:  'O valor sobe (ou desce) um percentual a cada N ocorrências. Sempre calculado sobre o valor inicial, nunca sobre o anterior.',
  sazonal:   'Você informa o valor de cada ocorrência — para receita com pico em dezembro, 13º em nov/dez, etc.',
  parcelado: 'Você informa o total e o sistema divide em parcelas. A última absorve a sobra de centavos.',
}

// ─── Periodicidade ────────────────────────────────────────────────────────────
// `intervalMonths` no lugar de um enum de frequência: mata o mapa enum→meses e
// o valor "único", que é redundante com `occurrences = 1`.

export const INTERVAL_OPTIONS = [1, 2, 3, 6, 12] as const

export const INTERVAL_LABELS: Record<number, string> = {
  1:  'Mensal',
  2:  'Bimestral',
  3:  'Trimestral',
  6:  'Semestral',
  12: 'Anual',
}

export function intervalLabel(months: number): string {
  return INTERVAL_LABELS[months] ?? `A cada ${months} meses`
}

// ─── Escopo de edição/exclusão de série ───────────────────────────────────────

export const EDIT_SCOPES = ['esta', 'daqui', 'todas'] as const
export type EditScope = (typeof EDIT_SCOPES)[number]

export const EDIT_SCOPE_LABELS: Record<EditScope, string> = {
  esta:  'Somente este mês',
  daqui: 'Este e os próximos',
  todas: 'Toda a série',
}

export const EDIT_SCOPE_HINTS: Record<EditScope, string> = {
  esta:  'Só esta ocorrência muda. A regra do lançamento fica intacta.',
  daqui: 'Vale desta ocorrência em diante. A regra fica como está — as ocorrências alteradas ficam marcadas como ajustadas.',
  todas: 'Atualiza a regra e todas as ocorrências, inclusive as passadas.',
}

/**
 * Campos que mudam a ESTRUTURA da recorrência. Alterá-los é necessariamente
 * uma operação de série inteira — não existe "mudar a periodicidade só deste
 * mês" —, então o escopo é promovido para "toda a série" automaticamente.
 */
export const SERIES_STRUCTURAL_FIELDS = [
  'startMonth', 'occurrences', 'intervalMonths', 'dayOfMonth', 'cashLagDays',
] as const

/** Campos que redefinem o valor gerado. */
export const SERIES_VALUE_FIELDS = [
  'amountMode', 'baseAmount', 'totalAmount', 'adjustmentRate', 'adjustmentEvery', 'seasonalAmounts',
] as const

/** Campos copiados para cada ocorrência e sobrescrevíveis nela. */
export const SERIES_ATTR_FIELDS = [
  'description', 'direction', 'categoryId', 'costCenterId',
  'businessUnitId', 'legalEntityId', 'contactId', 'notes',
] as const

// ─── Campos que uma ocorrência pode sobrescrever ──────────────────────────────
// Guardados em `budget_entries.adjusted_fields`. Uma alteração em lote do campo F
// pula apenas as ocorrências onde F está nesse array.

export const ADJUSTABLE_FIELDS = [
  'amount',
  'description',
  'category_id',
  'cost_center_id',
  'business_unit_id',
  'legal_entity_id',
  'contact_id',
  'competence_date',
  'cash_date',
  'notes',
] as const
export type AdjustableField = (typeof ADJUSTABLE_FIELDS)[number]

export const ADJUSTABLE_FIELD_LABELS: Record<AdjustableField, string> = {
  amount:           'valor',
  description:      'descrição',
  category_id:      'categoria',
  cost_center_id:   'centro de custo',
  business_unit_id: 'unidade de negócio',
  legal_entity_id:  'entidade legal',
  contact_id:       'contato',
  competence_date:  'data de competência',
  cash_date:        'data de caixa',
  notes:            'observação',
}

// ─── Cópia do realizado ───────────────────────────────────────────────────────
// Duas escolhas independentes, deliberadamente separadas: uma diz o FORMATO no
// tempo, a outra o DETALHAMENTO por dimensão. Um parâmetro só ("granularidade")
// misturaria as duas e viraria adivinhação na hora de usar.

export const COPY_SHAPES = ['mensal', 'media'] as const
export type CopyShape = (typeof COPY_SHAPES)[number]

export const COPY_SHAPE_LABELS: Record<CopyShape, string> = {
  mensal: 'Mês a mês',
  media:  'Média mensal',
}

export const COPY_SHAPE_HINTS: Record<CopyShape, string> = {
  mensal: 'Preserva a sazonalidade: cada mês do orçado recebe o valor do mês correspondente do período de origem.',
  media:  'Distribui o total do período em 12 parcelas iguais. Achata a sazonalidade — use quando o histórico é irregular demais para servir de padrão.',
}

export const COPY_GRANULARITIES = ['categoria', 'dimensoes'] as const
export type CopyGranularity = (typeof COPY_GRANULARITIES)[number]

export const COPY_GRANULARITY_LABELS: Record<CopyGranularity, string> = {
  categoria: 'Por categoria',
  dimensoes: 'Categoria + dimensões',
}

export const COPY_GRANULARITY_HINTS: Record<CopyGranularity, string> = {
  categoria: 'Um lançamento por categoria. As dimensões ficam em branco e podem ser preenchidas depois.',
  dimensoes: 'Um lançamento por combinação de categoria, centro de custo, unidade e entidade. Gera mais linhas — e só faz sentido se o realizado tiver essas dimensões preenchidas.',
}

// ─── Schemas Zod ──────────────────────────────────────────────────────────────

const uuidOrNull = z.string().uuid().nullable()
const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido (use AAAA-MM)')

export const budgetVersionInputSchema = z.object({
  name:        z.string().trim().min(1, 'Nome obrigatório').max(120, 'Máximo 120 caracteres'),
  fiscalYear:  z.number().int().min(2000, 'Exercício inválido').max(2100, 'Exercício inválido'),
  description: z.string().trim().max(500, 'Máximo 500 caracteres').nullable(),
})
export type BudgetVersionInput = z.infer<typeof budgetVersionInputSchema>

export const budgetSeriesInputSchema = z.object({
  versionId:        z.string().uuid(),
  description:      z.string().trim().min(1, 'Descrição obrigatória').max(200, 'Máximo 200 caracteres'),
  direction:        z.enum(['inflow', 'outflow']),
  categoryId:       z.string().uuid('Categoria obrigatória'),
  costCenterId:     uuidOrNull,
  businessUnitId:   uuidOrNull,
  legalEntityId:    uuidOrNull,
  contactId:        uuidOrNull,

  startMonth:       monthString,                                  // 'YYYY-MM' na borda; vira date no banco
  occurrences:      z.number().int().min(1, 'Mínimo 1 ocorrência').max(12, 'Máximo 12 ocorrências'),
  intervalMonths:   z.number().int().min(1).max(12),
  dayOfMonth:       z.number().int().min(1).max(31),
  cashLagDays:      z.number().int().min(0, 'Prazo não pode ser negativo').max(365, 'Prazo máximo de 365 dias'),

  amountMode:       z.enum(AMOUNT_MODES),
  baseAmount:       z.number().nonnegative('Valor não pode ser negativo').nullable(),
  totalAmount:      z.number().nonnegative('Total não pode ser negativo').nullable(),
  adjustmentRate:   z.number().gt(-1, 'Reajuste inválido').nullable(),   // fração decimal: 0.05 = 5%
  adjustmentEvery:  z.number().int().min(1),
  seasonalAmounts:  z.array(z.number().nonnegative()).nullable(),

  notes:            z.string().trim().max(500, 'Máximo 500 caracteres').nullable(),
}).superRefine((v, ctx) => {
  // Coerência entre o modo e os campos que ele exige — espelha os CHECKs da 0024
  if ((v.amountMode === 'fixo' || v.amountMode === 'reajuste') && v.baseAmount === null) {
    ctx.addIssue({ code: 'custom', path: ['baseAmount'], message: 'Informe o valor.' })
  }
  if (v.amountMode === 'reajuste' && v.adjustmentRate === null) {
    ctx.addIssue({ code: 'custom', path: ['adjustmentRate'], message: 'Informe o percentual de reajuste.' })
  }
  if (v.amountMode === 'parcelado' && v.totalAmount === null) {
    ctx.addIssue({ code: 'custom', path: ['totalAmount'], message: 'Informe o valor total a parcelar.' })
  }
  if (v.amountMode === 'sazonal') {
    if (!v.seasonalAmounts) {
      ctx.addIssue({ code: 'custom', path: ['seasonalAmounts'], message: 'Informe o valor de cada ocorrência.' })
    } else if (v.seasonalAmounts.length !== v.occurrences) {
      ctx.addIssue({
        code: 'custom',
        path: ['seasonalAmounts'],
        message: `Informe exatamente ${v.occurrences} valores (um por ocorrência).`,
      })
    }
  }
})
export type BudgetSeriesInput = z.infer<typeof budgetSeriesInputSchema>

// Edição de uma ocorrência isolada. Campo ausente = não alterar.
export const budgetEntryUpdateSchema = z.object({
  description:     z.string().trim().min(1).max(200).optional(),
  amount:          z.number().nonnegative('Valor não pode ser negativo').optional(),
  categoryId:      z.string().uuid().optional(),
  costCenterId:    uuidOrNull.optional(),
  businessUnitId:  uuidOrNull.optional(),
  legalEntityId:   uuidOrNull.optional(),
  contactId:       uuidOrNull.optional(),
  competenceDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').optional(),
  cashDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').optional(),
  notes:           z.string().trim().max(500).nullable().optional(),
})
export type BudgetEntryUpdate = z.infer<typeof budgetEntryUpdateSchema>

// ─── Tipos de leitura ─────────────────────────────────────────────────────────

export interface BudgetVersionListItem {
  id:            string
  name:          string
  fiscalYear:    number
  status:        BudgetStatus
  isActive:      boolean
  description:   string | null
  seriesCount:   number
  entryCount:    number
  totalInflow:   number   // somatório positivo das entries de entrada
  totalOutflow:  number   // somatório positivo das entries de saída
  createdAt:     string
}

export interface BudgetSeriesListItem {
  id:               string
  description:      string
  direction:        'inflow' | 'outflow'
  categoryId:       string
  categoryName:     string
  categoryCode:     string | null
  categoryType:     string
  parentName:       string | null
  costCenterId:     string | null
  costCenterName:   string | null
  businessUnitId:   string | null
  businessUnitName: string | null
  legalEntityId:    string | null
  legalEntityName:  string | null
  contactId:        string | null
  contactName:      string | null
  startMonth:       string        // 'YYYY-MM'
  occurrences:      number        // o que a REGRA geraria
  entryCount:       number        // o que EXISTE — pode divergir após exclusões pontuais
  intervalMonths:   number
  dayOfMonth:       number
  cashLagDays:      number
  amountMode:       AmountMode
  baseAmount:       number | null
  totalAmount:      number | null
  adjustmentRate:   number | null
  adjustmentEvery:  number
  seasonalAmounts:  number[] | null
  source:           BudgetSource
  notes:            string | null
  annualTotal:      number        // soma das ENTRIES, nunca recomputada da série
  adjustedCount:    number
}

export interface BudgetEntryListItem {
  id:               string
  seriesId:         string
  sequence:         number
  description:      string
  direction:        'inflow' | 'outflow'
  categoryId:       string
  categoryName:     string
  costCenterId:     string | null
  costCenterName:   string | null
  businessUnitId:   string | null
  businessUnitName: string | null
  legalEntityId:    string | null
  legalEntityName:  string | null
  contactId:        string | null
  contactName:      string | null
  competenceDate:   string        // 'YYYY-MM-DD'
  cashDate:         string        // 'YYYY-MM-DD'
  amount:           number
  adjustedFields:   AdjustableField[]
  notes:            string | null
}

// ─── Expansão da recorrência ──────────────────────────────────────────────────
// Produzido por `expandSeries` em `@/lib/budget-recurrence` — função pura, para
// que o dialog possa exibir o preview das ocorrências antes de salvar.

export interface EntryDraft {
  sequence:       number
  competenceDate: string   // 'YYYY-MM-DD'
  cashDate:       string   // 'YYYY-MM-DD'
  amount:         number   // sempre positivo
}

// ─── Orçado × Realizado ───────────────────────────────────────────────────────

/** Competência → compara com a DRE. Caixa → compara com o Fluxo. */
export const BUDGET_REGIMES = ['competencia', 'caixa'] as const
export type BudgetRegime = (typeof BUDGET_REGIMES)[number]

export const BUDGET_REGIME_LABELS: Record<BudgetRegime, string> = {
  competencia: 'Competência',
  caixa:       'Caixa',
}

/** O que cada célula da matriz exibe. */
export const CELL_MODES = ['orcado', 'realizado', 'variacao', 'variacaoPct'] as const
export type CellMode = (typeof CELL_MODES)[number]

export const CELL_MODE_LABELS: Record<CellMode, string> = {
  orcado:      'Orçado',
  realizado:   'Realizado',
  variacao:    'Variação R$',
  variacaoPct: 'Variação %',
}

export interface BudgetVsActualFilters {
  versionId:        string
  regime:           BudgetRegime
  from:             string   // YYYY-MM-DD
  to:               string   // YYYY-MM-DD
  costCenterIds?:   string[]
  businessUnitIds?: string[]
  legalEntityIds?:  string[]
}

/**
 * Uma célula da matriz. Os dois valores seguem a convenção `netAmount`
 * (receita positiva, custo negativo), o que faz `realizado − orcado` ser
 * "favorável quando positivo" dos dois lados da DRE.
 */
export interface BudgetVsActualRow {
  categoryId:   string
  categoryName: string
  categoryCode: string
  categoryType: DreType
  parentId:     string
  parentName:   string
  parentCode:   string
  month:        string   // YYYY-MM
  orcado:       number
  realizado:    number
}

/** Quantas transações do período têm cada dimensão preenchida. */
export interface DimensionCoverage {
  total:        number
  costCenter:   number
  businessUnit: number
  legalEntity:  number
}

export interface BudgetVsActualData {
  months: string[]
  rows:   BudgetVsActualRow[]
  /** Realizado sem categoria — invisível na matriz (INNER JOIN), exposto aqui para não mentir no total. */
  semCategoria:    { inflow: number; outflow: number; net: number; count: number }
  coverage:        DimensionCoverage
  /** Orçado cuja data, no regime escolhido, cai fora do período — a cauda de caixa. */
  foraDoHorizonte: { total: number; count: number }
}

// ─── Escopos de edição e exclusão ─────────────────────────────────────────────

export interface SeriesUpdateOptions {
  scope: EditScope
  /** Sequência âncora. Obrigatória em 'esta' e 'daqui'. */
  fromSequence?: number
  /** Só depois de o usuário confirmar no diálogo. Nasce sempre desmarcado. */
  overwriteAdjusted?: boolean
}

export interface AffectedOccurrence {
  sequence: number
  month:    string    // rótulo pronto, ex 'Mar/27'
  fields?:  AdjustableField[]
}

export interface SeriesUpdatePreview {
  scope:           EditScope
  /** true quando um campo estrutural forçou a operação a valer para a série inteira. */
  forcedFullScope: boolean
  /** Ocorrências que serão gravadas. */
  affectedCount:   number
  /** Ocorrências que somem por redução da quantidade. */
  removed:         AffectedOccurrence[]
  /** Quantas ocorrências novas serão criadas. */
  appended:        number
  /** As datas de competência e caixa serão recalculadas. */
  dateShift:       boolean
  /** Ajustes manuais que seriam sobrescritos — a razão de existir a confirmação. */
  conflicts:       AffectedOccurrence[]
  requiresConfirm: boolean
}

export interface SeriesDeletePreview {
  scope:   EditScope
  removed: AffectedOccurrence[]
  /** Novo valor de `occurrences` na regra; null quando a série inteira é apagada. */
  newOccurrences: number | null
}

export interface BudgetDrillDownEntry {
  id:               string
  seriesId:         string
  description:      string
  direction:        'inflow' | 'outflow'
  amount:           number
  competenceDate:   string
  cashDate:         string
  costCenterName:   string | null
  businessUnitName: string | null
  legalEntityName:  string | null
  contactName:      string | null
  adjusted:         boolean
}

// ─── Aceleradores: copiar do realizado e duplicar versão ──────────────────────
// Declarados no fim do arquivo de propósito: `z.enum(BUDGET_REGIMES)` é avaliado
// na carga do módulo e quebraria se viesse antes da constante.

/**
 * Cópia do realizado.
 *
 * `adjustmentPct` é PERCENTUAL de aplicação única (8 = +8% em cima de tudo) —
 * não confundir com `adjustmentRate` da série, que é fração decimal e se acumula
 * a cada N ocorrências. Os dois existem e significam coisas diferentes.
 */
export const copyActualsInputSchema = z.object({
  versionId:       z.string().uuid(),
  sourceFrom:      monthString,
  sourceTo:        monthString,
  regime:          z.enum(BUDGET_REGIMES),
  shape:           z.enum(COPY_SHAPES),
  granularity:     z.enum(COPY_GRANULARITIES),
  includeContact:  z.boolean().optional(),
  adjustmentPct:   z.number().min(-100, 'Redução máxima de 100%').max(1000, 'Aumento máximo de 1000%'),
  replaceExisting: z.boolean().optional(),
}).superRefine((v, ctx) => {
  if (v.sourceTo < v.sourceFrom) {
    ctx.addIssue({ code: 'custom', path: ['sourceTo'], message: 'O mês final não pode ser anterior ao inicial.' })
    return
  }
  const [fy, fm] = v.sourceFrom.split('-').map(Number)
  const [ty, tm] = v.sourceTo.split('-').map(Number)
  const months = (ty * 12 + tm) - (fy * 12 + fm) + 1
  // Teto de 12: o mapeamento é por NÚMERO DO MÊS (janeiro de origem vira janeiro
  // do exercício). Com mais de 12 meses, dois janeiros cairiam no mesmo alvo e o
  // valor dobraria em silêncio.
  if (months > 12) {
    ctx.addIssue({
      code: 'custom', path: ['sourceTo'],
      message: `O período tem ${months} meses. Escolha no máximo 12 — cada mês de origem vira o mês correspondente do exercício.`,
    })
  }
})
export type CopyActualsInput = z.infer<typeof copyActualsInputSchema>

export const duplicateVersionInputSchema = z.object({
  name:       z.string().trim().min(1, 'Nome obrigatório').max(120, 'Máximo 120 caracteres'),
  fiscalYear: z.number().int().min(2000, 'Exercício inválido').max(2100, 'Exercício inválido'),
})
export type DuplicateVersionInput = z.infer<typeof duplicateVersionInputSchema>

/** Uma linha da prévia: o lançamento que seria criado. */
export interface CopyActualsPreviewRow {
  description:    string
  direction:      'inflow' | 'outflow'
  categoryName:   string
  categoryCode:   string | null
  dimensionLabel: string | null
  startMonth:     string      // 'YYYY-MM' já no exercício de destino
  occurrences:    number
  amountMode:     AmountMode
  /** Realizado do grupo, antes do percentual. */
  sourceTotal:    number
  /** Soma das ocorrências que serão gravadas. */
  total:          number
}

/** Escolha do usuário para uma recorrência detectada que ele quer aceitar. */
export const recurrenceChoiceSchema = z.object({
  key:            z.string().min(1),
  categoryId:     z.string().uuid('Escolha a categoria'),
  costCenterId:   uuidOrNull,
  businessUnitId: uuidOrNull,
  legalEntityId:  uuidOrNull,
  contactId:      uuidOrNull,
  amount:         z.number().positive('Informe um valor maior que zero'),
})
export type RecurrenceChoice = z.infer<typeof recurrenceChoiceSchema>

export interface CopyActualsPreview {
  rows:           CopyActualsPreviewRow[]
  monthsInSource: number
  sourceTotals:   { inflow: number; outflow: number }
  targetTotals:   { inflow: number; outflow: number }
  /** Realizado sem categoria no período — não entra na cópia, e por isso é declarado. */
  semCategoria:   { count: number; total: number }
  /** Realizado em categoria desativada — idem: o lançamento seria inválido na edição. */
  inativas:       { count: number; total: number }
  /** O que já foi copiado antes para esta versão. Alimenta a opção de substituir. */
  existingCopied: { series: number; total: number }
}
