/**
 * Parser CSV para arquivos de importação de dimensões.
 *
 * Delimitador: `;` (padrão BR). BOM UTF-8 é tolerado e removido.
 * Aceita campos entre aspas duplas (com `""` como escape). Quebras de linha
 * dentro de aspas são suportadas. Linhas em branco são ignoradas.
 */

const BOM = '﻿'

export type CsvRow = Record<string, string>

export interface CsvParseResult {
  headers: string[]
  rows: CsvRow[]
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvParseError'
  }
}

export function parseCsv(text: string): CsvParseResult {
  if (text.startsWith(BOM)) text = text.slice(BOM.length)

  const cells = tokenize(text)
  if (cells.length === 0) throw new CsvParseError('Arquivo vazio.')

  const headers = cells[0].map(normalizeHeader)
  if (headers.length === 0 || headers.every((h) => h === '')) {
    throw new CsvParseError('Cabeçalho ausente — a primeira linha precisa conter os nomes das colunas.')
  }

  // Deduplica nomes vazios para diagnosticar arquivos mal formatados
  const seen = new Set<string>()
  for (const h of headers) {
    if (h === '') throw new CsvParseError('O cabeçalho contém uma coluna sem nome.')
    if (seen.has(h)) throw new CsvParseError(`O cabeçalho tem a coluna "${h}" duplicada.`)
    seen.add(h)
  }

  const rows: CsvRow[] = []
  for (let i = 1; i < cells.length; i++) {
    const cellRow = cells[i]
    if (cellRow.length === 0 || (cellRow.length === 1 && cellRow[0].trim() === '')) continue

    const row: CsvRow = {}
    headers.forEach((h, idx) => {
      row[h] = (cellRow[idx] ?? '').trim()
    })
    rows.push(row)
  }

  return { headers, rows }
}

function normalizeHeader(s: string): string {
  // remove BOM residual, espaços e normaliza para minúsculo
  return s.replace(BOM, '').trim().toLowerCase()
}

/**
 * Tokeniza um CSV com delimitador `;` em uma matriz de células.
 * Implementação manual (sem dependência) para evitar bibliotecas e ter
 * controle exato sobre quoting e BOM.
 */
function tokenize(text: string): string[][] {
  const rows: string[][] = []
  let cell = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ';') {
      row.push(cell)
      cell = ''
      continue
    }
    if (ch === '\r') {
      // ignora — fim de linha será tratado em \n
      continue
    }
    if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      cell = ''
      row = []
      continue
    }
    cell += ch
  }

  // última linha sem terminador
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

/**
 * Valida que o cabeçalho contém exatamente as colunas esperadas (em qualquer
 * ordem). Lança CsvParseError com mensagem amigável caso contrário.
 */
export function assertHeaders(found: string[], expected: readonly string[]): void {
  const foundSet = new Set(found)
  const expectedSet = new Set(expected.map((s) => s.toLowerCase()))

  const missing = Array.from(expectedSet).filter((h) => !foundSet.has(h))
  const extra = Array.from(foundSet).filter((h) => !expectedSet.has(h))

  if (missing.length > 0) {
    throw new CsvParseError(
      `Cabeçalho inválido. Colunas obrigatórias ausentes: ${missing.map((h) => `"${h}"`).join(', ')}. ` +
        `Esperado: ${expected.map((h) => `"${h}"`).join(', ')}.`,
    )
  }

  if (extra.length > 0) {
    throw new CsvParseError(
      `Cabeçalho contém colunas não reconhecidas: ${extra.map((h) => `"${h}"`).join(', ')}. ` +
        `Esperado exatamente: ${expected.map((h) => `"${h}"`).join(', ')}.`,
    )
  }
}
