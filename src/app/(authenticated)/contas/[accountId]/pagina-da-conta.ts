// O que as páginas de uma conta (conferência e fatura aberta) compartilham.
// Mora fora de `page.tsx` porque o Next só aceita ali os exports que conhece.

import { getCategories } from '@/server/categories'
import { getCostCenters, getBusinessUnits, getLegalEntities, getContactOptions } from '@/server/dimensions'

/** O id da conta chega codificado na URL (`arq:caixa` → `arq%3Acaixa`). */
export function decodificar(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

/** As opções de natureza e dimensões da tabela — as mesmas de `/transacoes`. */
export async function opcoesDaTabela() {
  const [cats, ccs, bus, les, cts] = await Promise.all([
    getCategories(), getCostCenters(), getBusinessUnits(), getLegalEntities(), getContactOptions(),
  ])
  return {
    categories: cats.filter(c => c.isActive),
    costCenters: ccs.filter(c => c.isActive),
    businessUnits: bus.filter(c => c.isActive),
    legalEntities: les.filter(c => c.isActive),
    contacts: cts,
  }
}
