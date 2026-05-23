// Tipos e constantes compartilhados entre server actions e componentes client
// Não usa 'use server' — pode ser importado de qualquer lugar

export const ACQUIRER_PROVIDERS = [
  { value: 'stone',    label: 'Stone'   },
  { value: 'cielo',    label: 'Cielo'   },
  { value: 'rede',     label: 'Rede'    },
  { value: 'pagbank',  label: 'PagBank' },
] as const

export type AcquirerProviderKey = typeof ACQUIRER_PROVIDERS[number]['value']
