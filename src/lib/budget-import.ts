// Import de planilha de orçamento e aceitação de recorrências detectadas.
//
// Tudo aqui é PURO: recebe o texto do CSV (ou a lista de recorrências) mais os
// mapas de busca já carregados do banco, e devolve as linhas da prévia e os
// lançamentos a criar. Nenhum acesso a banco, nenhuma sessão — a validação
// linha a linha, que é onde mora o erro que o usuário vai ver, pode ser
// exercitada direto.
//
// A grade é de 12 meses do CALENDÁRIO (jan..dez), não de posições relativas:
// a coluna "mar" é sempre março do exercício da versão.

import { shapeMonthly, type CopiedSeriesDraft } from './budget-copy'
import { parseCsv, CsvParseError } from './csv-parser'
import { BUDGET_CSV } from './csv-templates'
import { parseAmount } from './format'
import { round2 } from './budget-recurrence'
import type { RecorrenciaDetectada } from './recurrence-detect'

// ─── Normalização ─────────────────────────────────────────────────────────────

// `norm` mudou de casa para `@/lib/format`, ao lado de `parseAmount` e
// `parseDate`, quando o contrato de importação passou a precisar dela. Segue
// re-exportada para não quebrar quem já importava daqui.
export { norm } from '@/lib/format'
import { norm } from '@/lib/format'

// ─── Contexto de busca ────────────────────────────────────────────────────────

export interface LeafCategoryInfo {
  id:       string
  name:     string
  code:     string | null
  type:     string
  isActive: boolean
}

export interface BudgetCsvLookups {
  /** código normalizado → folha. Códigos são únicos por organização. */
  byCode: Map<string, LeafCategoryInfo>
  /** nome normalizado → folhas. Pode ter homônimos em pais diferentes. */
  byName: Map<string, LeafCategoryInfo[]>
  costCenters:   Map<string, string>
  businessUnits: Map<string, string>
  legalEntities: Map<string, string>
  contacts:      Map<string, string>
}

const MONTH_COLUMNS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                       'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const

// ─── Prévia ───────────────────────────────────────────────────────────────────

export interface BudgetCsvPreviewRow {
  line:           number
  status:         'ok' | 'invalid'
  message?:       string
  description:    string
  categoryLabel:  string
  direction:      'inflow' | 'outflow'
  dimensionLabel: string | null
  startMonth:     string | null
  occurrences:    number
  total:          number
}

export interface BudgetCsvParseResult {
  /** Erro que invalida o arquivo inteiro (cabeçalho, vazio). */
  fileError?: string
  rows:       BudgetCsvPreviewRow[]
  /** Só das linhas válidas. */
  drafts:     CopiedSeriesDraft[]
  totals:     { inflow: number; outflow: number }
  valid:      number
  invalid:    number
}

/**
 * Lê a planilha e devolve prévia + lançamentos.
 *
 * Uma linha inválida NÃO invalida o arquivo: ela aparece na prévia com o motivo
 * e é a única que fica de fora. Cabeçalho errado, sim, invalida tudo — não há
 * como adivinhar de qual mês é uma coluna sem nome.
 */
export function parseBudgetCsv(
  text: string,
  lookups: BudgetCsvLookups,
  fiscalYear: number,
): BudgetCsvParseResult {
  const empty = { rows: [], drafts: [], totals: { inflow: 0, outflow: 0 }, valid: 0, invalid: 0 }

  let parsed
  try {
    parsed = parseCsv(text)
  } catch (err) {
    return {
      ...empty,
      fileError: err instanceof CsvParseError ? err.message : 'Não foi possível ler o arquivo.',
    }
  }

  const found = new Set(parsed.headers)
  const missing = BUDGET_CSV.required.filter(h => !found.has(h))
  if (missing.length > 0) {
    return {
      ...empty,
      fileError: `Colunas obrigatórias ausentes: ${missing.map(h => `"${h}"`).join(', ')}. `
        + 'Baixe o modelo para conferir o formato.',
    }
  }

  const known = new Set<string>([...BUDGET_CSV.required, ...BUDGET_CSV.optional])
  const unknown = parsed.headers.filter(h => !known.has(h))
  if (unknown.length > 0) {
    return {
      ...empty,
      fileError: `Colunas não reconhecidas: ${unknown.map(h => `"${h}"`).join(', ')}. `
        + `Opcionais aceitas: ${BUDGET_CSV.optional.join(', ')}.`,
    }
  }

  const rows: BudgetCsvPreviewRow[] = []
  const drafts: CopiedSeriesDraft[] = []
  const totals = { inflow: 0, outflow: 0 }

  parsed.rows.forEach((raw, index) => {
    const line = index + 2   // +1 do cabeçalho, +1 porque planilha começa em 1

    const invalid = (message: string, partial: Partial<BudgetCsvPreviewRow> = {}) => {
      rows.push({
        line, status: 'invalid', message,
        description:    partial.description ?? (raw['descricao'] || raw['categoria'] || '—'),
        categoryLabel:  partial.categoryLabel ?? (raw['categoria'] || '—'),
        direction:      partial.direction ?? 'outflow',
        dimensionLabel: partial.dimensionLabel ?? null,
        startMonth:     null,
        occurrences:    0,
        total:          0,
      })
    }

    // ── Categoria ──
    const rawCategory = (raw['categoria'] ?? '').trim()
    if (!rawCategory) { invalid('Informe a categoria.'); return }

    const key = norm(rawCategory)
    let category = lookups.byCode.get(key)
    if (!category) {
      const matches = lookups.byName.get(key) ?? []
      if (matches.length > 1) {
        invalid(
          `Há ${matches.length} naturezas filho chamadas "${rawCategory}". `
          + `Use o código: ${matches.map(m => m.code ?? '(sem código)').join(', ')}.`,
        )
        return
      }
      category = matches[0]
    }
    if (!category) { invalid(`Categoria "${rawCategory}" não encontrada no plano de contas.`); return }
    if (!category.isActive) { invalid(`A categoria "${category.name}" está desativada.`); return }

    const categoryLabel = category.code ? `${category.code} – ${category.name}` : category.name

    // ── Direção ──
    const rawTipo = norm(raw['tipo'] ?? '')
    let direction: 'inflow' | 'outflow'
    if (!rawTipo) {
      // Sem a coluna, vale o tipo da categoria — mesma regra do diálogo manual.
      direction = category.type === 'receita_operacional' ? 'inflow' : 'outflow'
    } else if (['entrada', 'e', 'in', 'inflow', 'receita', 'recebimento'].includes(rawTipo)) {
      direction = 'inflow'
    } else if (['saida', 's', 'out', 'outflow', 'despesa', 'pagamento'].includes(rawTipo)) {
      direction = 'outflow'
    } else {
      invalid(`Tipo "${raw['tipo']}" não reconhecido. Use "entrada" ou "saida".`, { categoryLabel })
      return
    }

    // ── Dimensões ──
    const dims: Array<[keyof BudgetCsvLookups, string, string]> = [
      ['costCenters',   'centro de custo',    'Centro de custo'],
      ['businessUnits', 'unidade de negocio', 'Unidade de negócio'],
      ['legalEntities', 'entidade juridica',  'Entidade jurídica'],
      ['contacts',      'contato',            'Contato'],
    ]
    const resolved: Record<string, string | null> = {}
    const labels: string[] = []
    let dimError: string | null = null

    for (const [mapKey, column, label] of dims) {
      const value = (raw[column] ?? '').trim()
      if (!value) { resolved[column] = null; continue }
      const id = (lookups[mapKey] as Map<string, string>).get(norm(value))
      if (!id) { dimError = `${label} "${value}" não encontrado no cadastro.`; break }
      resolved[column] = id
      labels.push(value)
    }
    if (dimError) { invalid(dimError, { categoryLabel, direction }); return }

    // ── Grade de meses ──
    const byMonth = new Map<number, number>()
    let monthError: string | null = null

    MONTH_COLUMNS.forEach((column, i) => {
      if (monthError) return
      const cell = (raw[column] ?? '').trim()
      if (!cell) return
      const value = parseAmount(cell)
      if (value === null) { monthError = `Valor inválido em "${column}": "${cell}".`; return }
      if (value < 0) {
        monthError = `Valor negativo em "${column}". O sinal vem da coluna "tipo", não do número.`
        return
      }
      if (value !== 0) byMonth.set(i + 1, value)
    })

    if (monthError) { invalid(monthError, { categoryLabel, direction }); return }

    const shape = shapeMonthly(byMonth, fiscalYear)
    if (!shape) {
      invalid('Nenhum valor informado nos 12 meses.', { categoryLabel, direction })
      return
    }

    const dimensionLabel = labels.length ? labels.join(' · ') : null
    const description = ((raw['descricao'] ?? '').trim() || category.name).slice(0, 200)

    drafts.push({
      description,
      direction,
      categoryId:     category.id,
      categoryName:   category.name,
      categoryCode:   category.code,
      costCenterId:   resolved['centro de custo'] ?? null,
      businessUnitId: resolved['unidade de negocio'] ?? null,
      legalEntityId:  resolved['entidade juridica'] ?? null,
      contactId:      resolved['contato'] ?? null,
      dimensionLabel,
      intervalMonths: 1,
      dayOfMonth:     1,
      cashLagDays:    0,
      sourceTotal:    shape.total,
      ...shape,
    })

    totals[direction] += shape.total

    rows.push({
      line, status: 'ok',
      description, categoryLabel, direction, dimensionLabel,
      startMonth:  shape.startMonth,
      occurrences: shape.occurrences,
      total:       shape.total,
    })
  })

  const invalidCount = rows.filter(r => r.status === 'invalid').length

  return {
    rows,
    drafts,
    totals,
    valid:   rows.length - invalidCount,
    invalid: invalidCount,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECORRÊNCIAS DETECTADAS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Quantas vezes por mês uma recorrência de N dias acontece.
 *
 * A detecção do `/fluxo` trabalha em DIAS (aceita intervalos de 7 a 40) e o
 * orçamento trabalha em MESES. Converter sem escalar o valor seria um erro caro:
 * uma recorrência semanal de R$ 100 viraria R$ 100/mês em vez de R$ 400/mês.
 * O número inteiro é proposital — o usuário confere "a cada 7 dias, 4× por mês"
 * de cabeça, o que ele não faria com 4,35.
 */
export function timesPerMonth(intervalDays: number): number {
  if (!Number.isFinite(intervalDays) || intervalDays < 1) return 1
  return Math.max(1, Math.round(30 / intervalDays))
}

export interface RecurrenceCandidate {
  /** Chave estável para casar seleção do cliente com a lista do servidor. */
  key:            string
  descricao:      string
  direction:      'inflow' | 'outflow'
  valorMedio:     number
  intervaloDias:  number
  vezesPorMes:    number
  /** `valorMedio × vezesPorMes` — o que vai para o orçamento por mês. */
  valorMensal:    number
  ocorrencias:    number
  ultimaData:     string
  proximaData:    string
  /** Primeiro mês dentro do exercício, já ajustado. */
  startMonth:     string
  /** Quantos meses restam do exercício a partir de `startMonth`. */
  mesesRestantes: number
  /** Preenchido quando a recorrência não cabe no exercício da versão. */
  blocked:        string | null
  /** Já existe lançamento com essa descrição vindo de recorrência aceita. */
  alreadyAccepted: boolean
}

/**
 * Prepara as recorrências detectadas para virarem lançamentos do exercício.
 *
 * A janela de detecção é dos últimos 180 dias e a próxima ocorrência é sempre
 * futura, então uma recorrência pode simplesmente não pertencer ao exercício
 * orçado. Nesse caso ela aparece na lista BLOQUEADA com o motivo, em vez de
 * sumir — sumir deixaria o usuário procurando o que a detecção achou e a lista
 * não mostra.
 */
export function buildRecurrenceCandidates(
  recorrencias: RecorrenciaDetectada[],
  fiscalYear: number,
  acceptedDescriptions: Set<string>,
): RecurrenceCandidate[] {
  return recorrencias.map((r) => {
    const vezes = timesPerMonth(r.intervaloMedioDias)
    const proximoAno = Number(r.proximaData.slice(0, 4))
    const proximoMes = Number(r.proximaData.slice(5, 7))

    // Antes do exercício → começa em janeiro. Depois → não cabe.
    const startMonthNumber = proximoAno < fiscalYear ? 1 : proximoMes
    const blocked = proximoAno > fiscalYear
      ? `A próxima ocorrência é de ${r.proximaData.slice(0, 7)}, fora do exercício de ${fiscalYear}.`
      : null

    return {
      key:             `${r.direction}|${norm(r.descricao)}`,
      descricao:       r.descricao,
      direction:       r.direction,
      valorMedio:      r.valorMedio,
      intervaloDias:   r.intervaloMedioDias,
      vezesPorMes:     vezes,
      valorMensal:     round2(r.valorMedio * vezes),
      ocorrencias:     r.ocorrencias,
      ultimaData:      r.ultimaData,
      proximaData:     r.proximaData,
      startMonth:      `${fiscalYear}-${String(startMonthNumber).padStart(2, '0')}`,
      mesesRestantes:  13 - startMonthNumber,
      blocked,
      alreadyAccepted: acceptedDescriptions.has(norm(r.descricao)),
    }
  })
}

/** O lançamento que uma recorrência aceita vira. */
export function recurrenceToDraft(
  candidate: RecurrenceCandidate,
  choice: {
    categoryId: string
    categoryName: string
    categoryCode: string | null
    costCenterId: string | null
    businessUnitId: string | null
    legalEntityId: string | null
    contactId: string | null
    amount: number
  },
): CopiedSeriesDraft {
  const startMonthNumber = Number(candidate.startMonth.slice(5, 7))
  const occurrences = 13 - startMonthNumber
  const amount = round2(choice.amount)

  return {
    description:     candidate.descricao.slice(0, 200),
    direction:       candidate.direction,
    categoryId:      choice.categoryId,
    categoryName:    choice.categoryName,
    categoryCode:    choice.categoryCode,
    costCenterId:    choice.costCenterId,
    businessUnitId:  choice.businessUnitId,
    legalEntityId:   choice.legalEntityId,
    contactId:       choice.contactId,
    dimensionLabel:  null,
    startMonth:      candidate.startMonth,
    occurrences,
    intervalMonths:  1,
    // O dia da próxima ocorrência prevista — é a melhor informação disponível
    // sobre quando no mês isso acontece.
    dayOfMonth:      Math.min(28, Number(candidate.proximaData.slice(8, 10)) || 1),
    cashLagDays:     0,
    amountMode:      'fixo',
    baseAmount:      amount,
    seasonalAmounts: null,
    sourceTotal:     round2(amount * occurrences),
    total:           round2(amount * occurrences),
  }
}
