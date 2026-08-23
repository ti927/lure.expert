// Registro de fontes.
//
// Adicionar orçado, NF-e ou balanço é acrescentar um arquivo e uma entrada
// aqui — o motor não muda. É isso que o "extensível a qualquer tabela relevante"
// significa na prática, e é o motivo de NÃO existir ferramenta MCP de SQL livre:
// o atalho pareceria mais geral e anularia todas as garantias.

import type { QuerySource } from '../spec'
import type { SourceDescriptor } from './types'
import { realizado } from './realizado'
import { orcado } from './orcado'
import { nfe } from './nfe'

export const SOURCES: Partial<Record<QuerySource, SourceDescriptor>> = {
  realizado,
  orcado,
  nfe,
  // `balanco` ainda NÃO entrou, de propósito: ele é snapshot por documento
  // (`getBpData` escolhe o balanço mais recente com `reference_date <= X` e soma
  // os lançamentos daquele documento), e não há um único documento de balanço no
  // banco para conferir contra. Escrever a seleção de documento sem poder
  // provar o número seria a parte mais sutil do motor, feita às cegas.
}

export function fontesDisponiveis(): QuerySource[] {
  return Object.keys(SOURCES) as QuerySource[]
}

export type { SourceDescriptor, JoinId, MeasureSql, GroupingSql } from './types'
