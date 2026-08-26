// Os tipos do catálogo, num arquivo próprio.
//
// Extraídos de `tools.ts` na 5.D: o grupo de dashboard mora em
// `dashboard-tools.ts` (o catálogo já tinha 1.581 linhas), e os dois arquivos
// precisam do mesmo `Ferramenta` sem importar um ao outro — `tools.ts` importa
// a lista de dashboard, então `dashboard-tools.ts` importando `tools.ts` de
// volta fecharia um ciclo.

import type { z } from 'zod'
import type { Escopo } from '@/lib/oauth/clients'

export interface ContextoMcp {
  userId: string
  clientId: string
  organizationIds: string[]
  scopes: Escopo[]
}

export interface Ferramenta {
  nome: string
  titulo: string
  descricao: string
  /** Zod de entrada. O JSON Schema publicado sai daqui, então não divergem. */
  entrada: z.ZodType
  /** `escrita` some do catálogo quando o consentimento não a tem. */
  escopo: Escopo
  executar: (args: Record<string, unknown>, ctx: ContextoMcp) => Promise<unknown>
}
