// O guarda que mantém os lançamentos da folha só leitura no orçamento.
//
// Mora em arquivo próprio, sem importar nada do orçamento, para `budget-scope`
// poder chamá-lo sem ciclo de importação (`payroll-write` importa de
// `budget-scope`). Reexportado por `payroll-write`, que é onde se procura.
//
// Por que TODO caminho de edição recusa, inclusive as prévias: os campos de
// regra de uma série `folha` (start_month, occurrences, seasonal_amounts) NÃO
// descrevem as ocorrências dela — o PJ lança em meses não contíguos e o 13º sai
// partido em parcelas. Reexpandir a regra, ou planejar sobre ela, produziria
// outra folha. A edição é no quadro de pessoal; a geração refaz as séries.

import { sql } from 'drizzle-orm'
import type { db } from '@/db'
// A frase mora em `payroll-types` (sem `@/db`) para a tela poder mostrá-la como dica.
import { RECUSA_FOLHA } from './payroll-types'

export { RECUSA_FOLHA }

type Exec = Pick<typeof db, 'execute'>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `RECUSA_FOLHA` se a série (desta organização) vem da folha; `null` caso contrário. */
export async function recusaSeFolha(exec: Exec, organizationId: string, seriesId: string): Promise<string | null> {
  if (!UUID.test(seriesId)) return null
  const r = await exec.execute<{ source: string }>(sql`
    SELECT source FROM budget_series
     WHERE id = ${seriesId}::uuid AND organization_id = ${organizationId}::uuid`)
  return r[0]?.source === 'folha' ? RECUSA_FOLHA : null
}
