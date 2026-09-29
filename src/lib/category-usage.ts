// Quantos lançamentos usam cada natureza. Pela view, porque com rateio de
// natureza (29/set) a natureza vive nas partes — contar só `transactions`
// autorizaria apagar natureza em uso numa parte.
//
// Substitui o subselect de `getCategories`, que tinha o defeito da Decisão 18:
// `${categories.id}` numa consulta sem join virava `"id"` sem qualificação,
// capturado por `transactions.id`, e o contador vivia em ZERO — o "N tx" do
// plano de contas e o aviso do diálogo de exclusão nunca apareceram.

import { sql } from 'drizzle-orm'
import { db } from '@/db'

type Exec = Pick<typeof db, 'execute'>

export async function contarUsoPorNatureza(
  organizationId: string,
  exec: Exec = db,
): Promise<Map<string, number>> {
  const rows = await exec.execute<{ category_id: string; n: number }>(sql`
    SELECT tl.category_id::text AS category_id, COUNT(DISTINCT tl.transaction_id)::int AS n
      FROM transaction_lines tl
     WHERE tl.organization_id = ${organizationId}::uuid
       AND tl.category_id IS NOT NULL
     GROUP BY tl.category_id
  `)
  return new Map(rows.map(r => [r.category_id, Number(r.n)]))
}

export async function contarUsoDaNatureza(
  organizationId: string,
  categoryId: string,
  exec: Exec = db,
): Promise<number> {
  const [r] = await exec.execute<{ n: number }>(sql`
    SELECT COUNT(DISTINCT tl.transaction_id)::int AS n
      FROM transaction_lines tl
     WHERE tl.organization_id = ${organizationId}::uuid
       AND tl.category_id     = ${categoryId}::uuid
  `)
  return Number(r?.n ?? 0)
}
