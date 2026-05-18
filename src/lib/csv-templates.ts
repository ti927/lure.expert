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

export function buildTemplateCsv(kind: DimensionKind): string {
  const spec = TEMPLATES[kind]
  const lines = [spec.headers.join(';'), ...spec.sampleRows.map((r) => r.join(';'))]
  return BOM + lines.join('\r\n') + '\r\n'
}

/**
 * Dispara download do template no navegador. Só funciona em ambiente cliente.
 */
export function downloadTemplate(kind: DimensionKind): void {
  const csv = buildTemplateCsv(kind)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = TEMPLATES[kind].filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
