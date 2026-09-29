// O SQL do Balanço, fora de `'use server'` — para ser exercitável por script e
// conciliável contra a versão antiga. `server/balance-sheet.ts` é casca.
//
// Lê `transaction_lines` desde o rateio de natureza (29/set): com rateio a
// natureza vive nas partes. Um balanço é fotografia por documento e raramente é
// rateado, mas a regra é uma só — ler `transactions` aqui voltaria a atribuir o
// valor inteiro à natureza (vazia) do lançamento.

import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { BP_TYPES } from '@/lib/bp-types'

type Exec = Pick<typeof db, 'execute'>

const LISTA_BP = sql.join(BP_TYPES.map(t => sql`${t}`), sql`, `)

export interface BpRowRaw {
  childId: string
  childName: string
  childCode: string | null
  parentId: string
  parentName: string
  parentCode: string | null
  parentType: string
  total: number
}

/** As somas por Natureza Filho de UM documento de balanço. */
export async function lerLinhasDoBalanco(
  organizationId: string,
  documentId: string,
  exec: Exec = db,
): Promise<BpRowRaw[]> {
  const rows = await exec.execute<{
    child_id: string; child_name: string; child_code: string | null
    parent_id: string; parent_name: string; parent_code: string | null
    parent_type: string; total: string | null
  }>(sql`
    SELECT c.id::text AS child_id, c.name AS child_name, c.code AS child_code,
           p.id::text AS parent_id, p.name AS parent_name, p.code AS parent_code,
           p.type AS parent_type, SUM(tl.amount)::text AS total
      FROM transaction_lines tl
      JOIN categories c ON tl.category_id = c.id
      JOIN categories p ON c.parent_id    = p.id
     WHERE tl.document_id     = ${documentId}::uuid
       AND tl.organization_id = ${organizationId}::uuid
       AND p.type IN (${LISTA_BP})
     GROUP BY c.id, c.name, c.code, p.id, p.name, p.code, p.type
     ORDER BY p.code, c.code
  `)
  return rows.map(r => ({
    childId: r.child_id, childName: r.child_name, childCode: r.child_code,
    parentId: r.parent_id, parentName: r.parent_name, parentCode: r.parent_code,
    parentType: r.parent_type, total: Number(r.total ?? 0),
  }))
}

/** As somas por (documento, natureza) de vários documentos — a tabela multi-data. */
export async function somarBalancoPorDocumento(
  organizationId: string,
  docIds: string[],
  exec: Exec = db,
): Promise<{ documentId: string; categoryId: string; total: number }[]> {
  if (docIds.length === 0) return []
  const rows = await exec.execute<{ document_id: string; category_id: string; total: string | null }>(sql`
    SELECT tl.document_id::text AS document_id, tl.category_id::text AS category_id,
           SUM(tl.amount)::text AS total
      FROM transaction_lines tl
     WHERE tl.organization_id = ${organizationId}::uuid
       AND tl.document_id IN (${sql.join(docIds.map(id => sql`${id}::uuid`), sql`, `)})
       AND tl.category_id IS NOT NULL
     GROUP BY tl.document_id, tl.category_id
  `)
  return rows.map(r => ({ documentId: r.document_id, categoryId: r.category_id, total: Number(r.total ?? 0) }))
}
