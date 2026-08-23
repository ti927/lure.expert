// Registro de fontes.
//
// Adicionar orçado, NF-e ou balanço é acrescentar um arquivo e uma entrada
// aqui — o motor não muda. É isso que o "extensível a qualquer tabela relevante"
// significa na prática, e é o motivo de NÃO existir ferramenta MCP de SQL livre:
// o atalho pareceria mais geral e anularia todas as garantias.

import type { QuerySource } from '../spec'
import type { SourceDescriptor } from './types'
import { realizado } from './realizado'

export const SOURCES: Partial<Record<QuerySource, SourceDescriptor>> = {
  realizado,
  // orcado, nfe e balanco entram nas próximas sessões da Fase 1.
}

export function fontesDisponiveis(): QuerySource[] {
  return Object.keys(SOURCES) as QuerySource[]
}

export type { SourceDescriptor, JoinId, MeasureSql, GroupingSql } from './types'
