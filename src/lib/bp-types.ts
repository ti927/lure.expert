export const BP_TYPES = [
  'ativo_circulante',
  'ativo_nao_circulante',
  'passivo_circulante',
  'passivo_nao_circulante',
  'patrimonio_liquido',
] as const

export type BpType = typeof BP_TYPES[number]

export const BP_TYPE_LABELS: Record<BpType, string> = {
  ativo_circulante: 'Ativo Circulante',
  ativo_nao_circulante: 'Ativo Não-Circulante',
  passivo_circulante: 'Passivo Circulante',
  passivo_nao_circulante: 'Passivo Não-Circulante',
  patrimonio_liquido: 'Patrimônio Líquido',
}
