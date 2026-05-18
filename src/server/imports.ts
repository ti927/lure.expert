'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  memberships,
  categories,
  costCenters,
  businessUnits,
  legalEntities,
} from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { parseCsv, assertHeaders, CsvParseError } from '@/lib/csv-parser'
import {
  CATEGORY_HEADERS,
  COST_CENTER_HEADERS,
  BUSINESS_UNIT_HEADERS,
  LEGAL_ENTITY_HEADERS,
} from '@/lib/csv-templates'

const CATEGORY_TYPES = new Set([
  // DRE
  'receita_operacional', 'deducoes_tributarias', 'deducoes_operacionais',
  'cpv', 'sga', 'resultado_financeiro', 'ir', 'investimento', 'transfer',
  // BP
  'ativo_circulante', 'ativo_nao_circulante',
  'passivo_circulante', 'passivo_nao_circulante',
  'patrimonio_liquido',
])

async function getAuthContext() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!membership) redirect('/onboarding')

  return { userId: user.id, organizationId: membership.organizationId }
}

// ─── TIPOS COMUNS ────────────────────────────────────────────────────────────

export interface ImportRowError {
  line: number  // número da linha no arquivo (1 = cabeçalho, 2 = primeira linha de dados)
  message: string
}

export interface PreviewResult<T> {
  ok: boolean
  fileError?: string  // erro que invalida o arquivo inteiro (cabeçalho ruim, vazio)
  rows: T[]
  errors: ImportRowError[]
  summary: {
    total: number
    valid: number
    invalid: number
    willInsert: number
    willUpdate: number
  }
}

export interface CommitResult {
  success?: boolean
  error?: string
  inserted?: number
  updated?: number
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORIAS
// ═══════════════════════════════════════════════════════════════════════════

export interface CategoryPreviewRow {
  line: number
  codigo: string
  tipo: string
  paiNome: string
  filhoNome: string
  status: 'insert' | 'update' | 'invalid'
  /** erro de validação na linha (apenas quando status='invalid') */
  message?: string
  /** quando status='update' indica o que está mudando */
  changeHint?: string
}

/**
 * Faz o preview de um CSV de categorias. Valida cabeçalho e linha-a-linha.
 * Não escreve nada no banco — só lê o estado atual para calcular se cada
 * linha vai INSERIR ou ATUALIZAR.
 */
export async function previewCategoryImport(csvText: string): Promise<PreviewResult<CategoryPreviewRow>> {
  const { organizationId } = await getAuthContext()

  let parsed
  try {
    parsed = parseCsv(csvText)
    assertHeaders(parsed.headers, CATEGORY_HEADERS)
  } catch (err) {
    if (err instanceof CsvParseError) {
      return emptyPreview(err.message)
    }
    throw err
  }

  // Carrega categorias existentes para diff (por código e por nome+tipo+pai-null para Pais)
  const existing = await db
    .select({
      id: categories.id,
      code: categories.code,
      name: categories.name,
      type: categories.type,
      parentId: categories.parentId,
    })
    .from(categories)
    .where(eq(categories.organizationId, organizationId))

  const byCode = new Map(existing.map((c) => [c.code, c]))
  // Pais existentes mapeados por (tipo, nome_normalizado)
  const existingPaiByKey = new Map<string, typeof existing[number]>()
  for (const c of existing) {
    if (c.parentId === null) {
      existingPaiByKey.set(paiKey(c.type, c.name), c)
    }
  }

  // Coleta os Pais inferidos no próprio arquivo (linhas válidas) para detectar
  // se um mesmo (tipo, nome_pai) aparece com nomes/tipos divergentes
  const inferredPaiKeys = new Set<string>()

  const rows: CategoryPreviewRow[] = []
  const errors: ImportRowError[] = []

  parsed.rows.forEach((row, idx) => {
    const line = idx + 2  // +1 cabeçalho, +1 base-1
    const codigo = (row['codigo'] || '').trim()
    const tipo = (row['tipo natureza'] || '').trim().toLowerCase()
    const paiNome = (row['natureza pai'] || '').trim()
    const filhoNome = (row['natureza filho'] || '').trim()

    const issues: string[] = []
    if (!codigo) issues.push('código vazio')
    if (!tipo) issues.push('tipo da natureza vazio')
    else if (!CATEGORY_TYPES.has(tipo))
      issues.push(`tipo "${tipo}" inválido (use um dos 14 tipos do plano)`)
    if (!paiNome) issues.push('natureza pai vazia')
    if (!filhoNome) issues.push('natureza filho vazia')

    if (issues.length > 0) {
      const message = issues.join('; ')
      errors.push({ line, message })
      rows.push({
        line,
        codigo,
        tipo,
        paiNome,
        filhoNome,
        status: 'invalid',
        message,
      })
      return
    }

    inferredPaiKeys.add(paiKey(tipo, paiNome))

    // Diff: já existe categoria com esse código?
    const existingRow = byCode.get(codigo)
    if (!existingRow) {
      rows.push({
        line, codigo, tipo, paiNome, filhoNome,
        status: 'insert',
      })
      return
    }

    // Linha vai atualizar — mas movimento entre Pais não é permitido via CSV
    const existingPai = existingRow.parentId
      ? existing.find((c) => c.id === existingRow.parentId)
      : null
    const isFilho = existingRow.parentId !== null
    const movingPai = isFilho && existingPai && (
      existingPai.name.toLowerCase() !== paiNome.toLowerCase() ||
      existingPai.type !== tipo
    )

    const changes: string[] = []
    if (existingRow.name !== filhoNome) changes.push(`nome: "${existingRow.name}" → "${filhoNome}"`)
    if (existingRow.type !== tipo && !movingPai) changes.push(`tipo: "${existingRow.type}" → "${tipo}"`)

    if (movingPai) {
      const message = `código "${codigo}" já existe sob a Natureza Pai "${existingPai!.name}" (tipo "${existingRow.type}"). ` +
        `Mover entre Pais não é permitido via CSV — use a tela para arrastar.`
      errors.push({ line, message })
      rows.push({
        line, codigo, tipo, paiNome, filhoNome,
        status: 'invalid',
        message,
      })
      return
    }

    if (!isFilho) {
      const message = `código "${codigo}" já existe como Natureza Pai. Use outro código para o Filho.`
      errors.push({ line, message })
      rows.push({
        line, codigo, tipo, paiNome, filhoNome,
        status: 'invalid',
        message,
      })
      return
    }

    rows.push({
      line, codigo, tipo, paiNome, filhoNome,
      status: 'update',
      changeHint: changes.length > 0 ? changes.join('; ') : 'sem mudanças (nome/tipo iguais)',
    })
  })

  const summary = {
    total: rows.length,
    valid: rows.filter((r) => r.status !== 'invalid').length,
    invalid: rows.filter((r) => r.status === 'invalid').length,
    willInsert: rows.filter((r) => r.status === 'insert').length,
    willUpdate: rows.filter((r) => r.status === 'update').length,
  }

  return { ok: errors.length === 0, rows, errors, summary }
}

/**
 * Aplica o import de categorias após preview validado. Re-roda o preview
 * internamente para garantir que o CSV ainda está consistente com o banco.
 *
 * Estratégia:
 *  1. Resolve Pais únicos (tipo+nome). Reusa Pais existentes; cria os novos
 *     com código derivado do primeiro Filho (ex: "3.1.01" → "3.1") ou slug.
 *  2. Para cada linha válida: insere Filho novo OU atualiza nome/tipo do Filho
 *     existente (não move entre Pais — já bloqueado no preview).
 */
export async function commitCategoryImport(csvText: string): Promise<CommitResult> {
  const { organizationId } = await getAuthContext()
  const preview = await previewCategoryImport(csvText)
  if (!preview.ok) {
    return { error: preview.fileError ?? 'O arquivo contém linhas inválidas — corrija e tente novamente.' }
  }

  // Recarrega estado para resolver Pais
  const existing = await db
    .select()
    .from(categories)
    .where(eq(categories.organizationId, organizationId))

  const byCode = new Map(existing.map((c) => [c.code, c]))
  const usedCodes = new Set(existing.map((c) => c.code))
  const paiByKey = new Map<string, string>()  // (tipo|nome) → pai_id
  for (const c of existing) {
    if (c.parentId === null) paiByKey.set(paiKey(c.type, c.name), c.id)
  }

  // ─── Passo 1: resolver Pais ──────────────────────────────────────────────
  // Agrupa linhas válidas por (tipo, nome_pai) — para cada grupo, usa o
  // primeiro código de Filho para derivar o código do Pai (prefixo antes do
  // último ponto).
  const paiSamples = new Map<string, { tipo: string; nome: string; sampleFilhoCode: string }>()
  for (const row of preview.rows) {
    if (row.status === 'invalid') continue
    const key = paiKey(row.tipo, row.paiNome)
    if (!paiSamples.has(key)) {
      paiSamples.set(key, { tipo: row.tipo, nome: row.paiNome, sampleFilhoCode: row.codigo })
    }
  }

  let inserted = 0
  let updated = 0

  for (const [key, info] of Array.from(paiSamples.entries())) {
    if (paiByKey.has(key)) continue  // Pai já existe — reusa

    const paiCode = generatePaiCode(info.sampleFilhoCode, info.nome, usedCodes)
    usedCodes.add(paiCode)

    const [paiInserted] = await db.insert(categories).values({
      organizationId,
      code: paiCode,
      name: info.nome,
      type: info.tipo,
      parentId: null,
      metadata: { source: 'csv-import' },
    }).returning({ id: categories.id })

    paiByKey.set(key, paiInserted.id)
    inserted++
  }

  // ─── Passo 2: aplicar Filhos ─────────────────────────────────────────────
  for (const row of preview.rows) {
    if (row.status === 'invalid') continue

    const paiId = paiByKey.get(paiKey(row.tipo, row.paiNome))!

    if (row.status === 'insert') {
      await db.insert(categories).values({
        organizationId,
        code: row.codigo,
        name: row.filhoNome,
        type: row.tipo,
        parentId: paiId,
        metadata: { source: 'csv-import' },
      })
      inserted++
    } else {
      // update — apenas nome e tipo (move bloqueado no preview)
      const existingRow = byCode.get(row.codigo)
      if (!existingRow) continue  // race; ignora silenciosamente

      const changed =
        existingRow.name !== row.filhoNome || existingRow.type !== row.tipo
      if (!changed) continue

      await db
        .update(categories)
        .set({
          name: row.filhoNome,
          type: row.tipo,
          updatedAt: new Date(),
        })
        .where(and(eq(categories.id, existingRow.id), eq(categories.organizationId, organizationId)))
      updated++
    }
  }

  revalidatePath('/configuracoes/categorias')
  return { success: true, inserted, updated }
}

function paiKey(tipo: string, nome: string): string {
  return `${tipo.toLowerCase()}|${nome.trim().toLowerCase()}`
}

function generatePaiCode(filhoCode: string, paiNome: string, used: Set<string>): string {
  // Tenta: prefixo antes do último ponto (3.1.01 → 3.1)
  const lastDot = filhoCode.lastIndexOf('.')
  if (lastDot > 0) {
    const prefix = filhoCode.slice(0, lastDot)
    if (!used.has(prefix)) return prefix
  }

  // Fallback: slug do nome com prefixo "pai-"
  const slug = paiNome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)

  let candidate = `pai-${slug || 'nova'}`
  let n = 2
  while (used.has(candidate)) {
    candidate = `pai-${slug || 'nova'}-${n++}`
  }
  return candidate
}

// ═══════════════════════════════════════════════════════════════════════════
// DIMENSÕES FLAT (centros de custo, unidades de negócio, entidades jurídicas)
// ═══════════════════════════════════════════════════════════════════════════

export interface FlatPreviewRow {
  line: number
  codigo: string
  nome: string
  cnpj?: string
  status: 'insert' | 'update' | 'invalid'
  message?: string
  changeHint?: string
}

type FlatTable = typeof costCenters | typeof businessUnits | typeof legalEntities

interface FlatExisting {
  id: string
  name: string
  code: string | null
  cnpj?: string | null
}

async function previewFlatImport(
  csvText: string,
  expectedHeaders: readonly string[],
  table: FlatTable,
  withCnpj: boolean,
): Promise<PreviewResult<FlatPreviewRow>> {
  const { organizationId } = await getAuthContext()

  let parsed
  try {
    parsed = parseCsv(csvText)
    assertHeaders(parsed.headers, expectedHeaders)
  } catch (err) {
    if (err instanceof CsvParseError) {
      return emptyPreview(err.message)
    }
    throw err
  }

  const existing: FlatExisting[] = withCnpj
    ? await db
        .select({
          id: legalEntities.id,
          name: legalEntities.name,
          code: legalEntities.code,
          cnpj: legalEntities.cnpj,
        })
        .from(legalEntities)
        .where(eq(legalEntities.organizationId, organizationId))
    : await db
        .select({
          id: (table as typeof costCenters).id,
          name: (table as typeof costCenters).name,
          code: (table as typeof costCenters).code,
        })
        .from(table as typeof costCenters)
        .where(eq((table as typeof costCenters).organizationId, organizationId))

  const byCode = new Map<string, FlatExisting>()
  const byNameLower = new Map<string, FlatExisting>()
  const byCnpj = new Map<string, FlatExisting>()
  for (const e of existing) {
    if (e.code) byCode.set(e.code, e)
    byNameLower.set(e.name.trim().toLowerCase(), e)
    if (withCnpj && e.cnpj) byCnpj.set(normalizeCnpj(e.cnpj), e)
  }

  // Detecta códigos duplicados dentro do próprio arquivo
  const codesInFile = new Map<string, number>()  // code → line

  const rows: FlatPreviewRow[] = []
  const errors: ImportRowError[] = []

  parsed.rows.forEach((row, idx) => {
    const line = idx + 2
    const codigo = (row['codigo'] || '').trim()
    const nome = (row['nome'] || '').trim()
    const cnpjRaw = withCnpj ? (row['cnpj'] || '').trim() : undefined
    const cnpj = cnpjRaw ? normalizeCnpj(cnpjRaw) : ''

    const issues: string[] = []
    if (!nome) issues.push('nome vazio')
    if (codigo && codigo.length > 20) issues.push('código com mais de 20 caracteres')
    if (nome.length > 100) issues.push('nome com mais de 100 caracteres')
    if (withCnpj && cnpjRaw && cnpj.length !== 14) {
      issues.push('CNPJ inválido (precisa ter 14 dígitos)')
    }
    if (codigo) {
      const dup = codesInFile.get(codigo)
      if (dup !== undefined) issues.push(`código duplicado no arquivo (também na linha ${dup})`)
      else codesInFile.set(codigo, line)
    }

    if (issues.length > 0) {
      const message = issues.join('; ')
      errors.push({ line, message })
      rows.push({ line, codigo, nome, cnpj: cnpjRaw, status: 'invalid', message })
      return
    }

    // Resolve qual registro existente (se algum)
    let match: FlatExisting | undefined
    if (codigo) match = byCode.get(codigo)
    if (!match && withCnpj && cnpj) match = byCnpj.get(cnpj)
    if (!match) match = byNameLower.get(nome.toLowerCase())

    if (!match) {
      rows.push({ line, codigo, nome, cnpj: cnpjRaw, status: 'insert' })
    } else {
      const changes: string[] = []
      if (match.name !== nome) changes.push(`nome: "${match.name}" → "${nome}"`)
      if ((match.code ?? '') !== codigo) changes.push(`código: "${match.code ?? '—'}" → "${codigo || '—'}"`)
      if (withCnpj && normalizeCnpj(match.cnpj ?? '') !== cnpj) {
        changes.push(`CNPJ: "${match.cnpj ?? '—'}" → "${cnpjRaw || '—'}"`)
      }
      rows.push({
        line, codigo, nome, cnpj: cnpjRaw,
        status: 'update',
        changeHint: changes.length > 0 ? changes.join('; ') : 'sem mudanças',
      })
    }
  })

  const summary = {
    total: rows.length,
    valid: rows.filter((r) => r.status !== 'invalid').length,
    invalid: rows.filter((r) => r.status === 'invalid').length,
    willInsert: rows.filter((r) => r.status === 'insert').length,
    willUpdate: rows.filter((r) => r.status === 'update').length,
  }

  return { ok: errors.length === 0, rows, errors, summary }
}

async function commitFlatImport(
  csvText: string,
  expectedHeaders: readonly string[],
  table: FlatTable,
  withCnpj: boolean,
  revalidate: string,
): Promise<CommitResult> {
  const { organizationId } = await getAuthContext()
  const preview = await previewFlatImport(csvText, expectedHeaders, table, withCnpj)
  if (!preview.ok) {
    return { error: preview.fileError ?? 'O arquivo contém linhas inválidas — corrija e tente novamente.' }
  }

  let inserted = 0
  let updated = 0

  // Re-resolve match para evitar race (preview pode ter ficado obsoleto)
  for (const row of preview.rows) {
    if (row.status === 'invalid') continue

    const cnpj = withCnpj && row.cnpj ? normalizeCnpj(row.cnpj) : ''

    // Look up por (code → cnpj → name) na ordem
    let existingId: string | undefined
    if (row.codigo) {
      const r = withCnpj
        ? await db
            .select({ id: legalEntities.id })
            .from(legalEntities)
            .where(and(eq(legalEntities.organizationId, organizationId), eq(legalEntities.code, row.codigo)))
            .limit(1)
        : await db
            .select({ id: (table as typeof costCenters).id })
            .from(table as typeof costCenters)
            .where(and(
              eq((table as typeof costCenters).organizationId, organizationId),
              eq((table as typeof costCenters).code, row.codigo),
            ))
            .limit(1)
      existingId = r[0]?.id
    }
    if (!existingId && withCnpj && cnpj) {
      const r = await db
        .select({ id: legalEntities.id, cnpj: legalEntities.cnpj })
        .from(legalEntities)
        .where(eq(legalEntities.organizationId, organizationId))
      existingId = r.find((e) => normalizeCnpj(e.cnpj ?? '') === cnpj)?.id
    }
    if (!existingId) {
      // por nome (case-insensitive)
      const r = withCnpj
        ? await db
            .select({ id: legalEntities.id, name: legalEntities.name })
            .from(legalEntities)
            .where(eq(legalEntities.organizationId, organizationId))
        : await db
            .select({ id: (table as typeof costCenters).id, name: (table as typeof costCenters).name })
            .from(table as typeof costCenters)
            .where(eq((table as typeof costCenters).organizationId, organizationId))
      existingId = r.find((e) => e.name.trim().toLowerCase() === row.nome.toLowerCase())?.id
    }

    if (existingId) {
      if (withCnpj) {
        await db
          .update(legalEntities)
          .set({
            name: row.nome,
            code: row.codigo || null,
            cnpj: row.cnpj || null,
          })
          .where(and(eq(legalEntities.id, existingId), eq(legalEntities.organizationId, organizationId)))
      } else {
        const t = table as typeof costCenters
        await db
          .update(t)
          .set({
            name: row.nome,
            code: row.codigo || null,
          })
          .where(and(eq(t.id, existingId), eq(t.organizationId, organizationId)))
      }
      updated++
    } else {
      if (withCnpj) {
        await db.insert(legalEntities).values({
          organizationId,
          name: row.nome,
          code: row.codigo || null,
          cnpj: row.cnpj || null,
        })
      } else {
        const t = table as typeof costCenters
        await db.insert(t).values({
          organizationId,
          name: row.nome,
          code: row.codigo || null,
        })
      }
      inserted++
    }
  }

  revalidatePath(revalidate)
  return { success: true, inserted, updated }
}

// ─── Exports específicos por dimensão ────────────────────────────────────────

export async function previewCostCenterImport(csvText: string) {
  return previewFlatImport(csvText, COST_CENTER_HEADERS, costCenters, false)
}
export async function commitCostCenterImport(csvText: string) {
  return commitFlatImport(csvText, COST_CENTER_HEADERS, costCenters, false, '/configuracoes/centros-de-custo')
}

export async function previewBusinessUnitImport(csvText: string) {
  return previewFlatImport(csvText, BUSINESS_UNIT_HEADERS, businessUnits, false)
}
export async function commitBusinessUnitImport(csvText: string) {
  return commitFlatImport(csvText, BUSINESS_UNIT_HEADERS, businessUnits, false, '/configuracoes/unidades-de-negocio')
}

export async function previewLegalEntityImport(csvText: string) {
  return previewFlatImport(csvText, LEGAL_ENTITY_HEADERS, legalEntities, true)
}
export async function commitLegalEntityImport(csvText: string) {
  return commitFlatImport(csvText, LEGAL_ENTITY_HEADERS, legalEntities, true, '/configuracoes/entidades-juridicas')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyPreview<T>(fileError: string): PreviewResult<T> {
  return {
    ok: false,
    fileError,
    rows: [],
    errors: [],
    summary: { total: 0, valid: 0, invalid: 0, willInsert: 0, willUpdate: 0 },
  }
}

function normalizeCnpj(s: string): string {
  return s.replace(/\D/g, '')
}
