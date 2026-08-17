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
