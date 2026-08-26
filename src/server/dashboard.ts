'use server'

// O que sobrou de `server/dashboard.ts` depois da Fase 5.
//
// A tela clássica virou um painel de blocos na 5.C, e as leituras que a
// alimentavam foram substituídas: os 4 KPIs e os 7 indicadores mudaram de casa
// para `lib/dashboard/` na 5.B (o bloco os chama direto), e o Top 5 e o gráfico
// de 90 dias viraram os blocos `ranking` e `serie` — uma spec por cima do motor,
// que é o ponto da fase: "top 5 UENs" deixou de exigir função nova.
//
// Ficou só o DRILL-DOWN, que não é agregação: ele lista lançamentos e assina
// URLs de logo pelo Storage, coisa de sessão de navegador. Todo export num
// arquivo `'use server'` é um endpoint HTTP, então manter as quatro funções sem
// chamador seria superfície sem propósito.

import { getAuthContext } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import type { DrillDownTransaction } from '@/lib/dre-types'

export async function getDashboardCategoryDrillDown(
  categoryIds: string[],
  dateRange:   { from: string; to: string },
): Promise<{ transactions: DrillDownTransaction[] }> {
  const { organizationId } = await getAuthContext()

  if (categoryIds.length === 0) return { transactions: [] }

  type TxRow = {
    id:                   string
    date:                 string
    description:          string
    direction:            string
    amount:               string
    category_id:          string | null
    category_name:        string | null
    category_type:        string | null
    parent_category_id:   string | null
    parent_category_name: string | null
    parent_category_type: string | null
    cost_center_id:       string | null
    cost_center_name:     string | null
    business_unit_id:     string | null
    business_unit_name:   string | null
    legal_entity_id:      string | null
    legal_entity_name:    string | null
    contact_id:           string | null
    contact_name:         string | null
    allocation_id:        string | null
    is_allocated:         boolean
    account_id:           string | null
    account_name:         string | null
    account_type:         string | null
    account_number:       string | null
    data_source_id:       string | null
    ds_metadata:          Record<string, unknown> | null
  }

  const result = await db.execute<TxRow>(sql`
    SELECT
      t.transaction_id::text   AS id,
      t.allocation_id::text    AS allocation_id,
      t.is_allocated           AS is_allocated,
      t.date                   AS date,
      t.description            AS description,
      t.direction              AS direction,
      t.amount::numeric        AS amount,
      t.category_id::text      AS category_id,
      c.name                   AS category_name,
      c.type                   AS category_type,
      p.id::text               AS parent_category_id,
      p.name                   AS parent_category_name,
      p.type                   AS parent_category_type,
      t.cost_center_id::text   AS cost_center_id,
      cc.name                  AS cost_center_name,
      t.business_unit_id::text AS business_unit_id,
      bu.name                  AS business_unit_name,
      t.legal_entity_id::text  AS legal_entity_id,
      le.name                  AS legal_entity_name,
      t.contact_id::text       AS contact_id,
      ct.name                  AS contact_name,
      t.account_id             AS account_id,
      t.account_name           AS account_name,
      t.account_type           AS account_type,
      t.account_number         AS account_number,
      t.data_source_id::text   AS data_source_id,
      ds.metadata              AS ds_metadata
    FROM transaction_lines t
    LEFT JOIN categories c      ON t.category_id      = c.id
    LEFT JOIN categories p      ON c.parent_id        = p.id
    LEFT JOIN cost_centers cc   ON t.cost_center_id   = cc.id
    LEFT JOIN business_units bu ON t.business_unit_id = bu.id
    LEFT JOIN legal_entities le ON t.legal_entity_id  = le.id
    LEFT JOIN contacts ct       ON t.contact_id       = ct.id
    LEFT JOIN data_sources ds   ON t.data_source_id   = ds.id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.category_id IN (${sql.join(categoryIds.map(id => sql`${id}::uuid`), sql`, `)})
      AND t.status NOT IN ('pending', 'duplicate')
      AND COALESCE(t.effective_date, t.date)::date >= ${dateRange.from}::date
      AND COALESCE(t.effective_date, t.date)::date <= ${dateRange.to}::date
    ORDER BY t.date DESC, t.created_at DESC
  `)

  // Signed URLs em batch para customLogoPath
  const customLogoByDs = new Map<string, string>()
  for (const r of result) {
    const meta = (r.ds_metadata ?? {}) as Record<string, unknown>
    const path = typeof meta.customLogoPath === 'string' ? meta.customLogoPath : null
    if (path && r.data_source_id && !customLogoByDs.has(r.data_source_id)) {
      customLogoByDs.set(r.data_source_id, path)
    }
  }
  const supabase = createClient()
  const signedEntries = await Promise.all(
    Array.from(customLogoByDs.entries()).map(async ([dsId, path]) => {
      const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
      return [dsId, data?.signedUrl ?? null] as const
    })
  )
  const signedMap = new Map(signedEntries)

  const transactions: DrillDownTransaction[] = result.map(r => {
    const amount = Number(r.amount)
    const meta = (r.ds_metadata ?? {}) as Record<string, unknown>
    const autoLogo = typeof meta.institutionImageUrl === 'string' ? meta.institutionImageUrl : null
    const customLogo = r.data_source_id ? signedMap.get(r.data_source_id) ?? null : null
    const badge = (meta.customBadge as { text?: string } | undefined)?.text || null

    const parentId   = r.parent_category_id   ?? r.category_id   ?? null
    const parentName = r.parent_category_name ?? r.category_name ?? null
    const parentType = r.parent_category_type ?? r.category_type ?? null

    return {
      id:                 r.id,
      date:               String(r.date),
      description:        r.description,
      direction:          r.direction,
      amount,
      netAmount:          r.direction === 'inflow' ? amount : -amount,
      categoryId:         r.category_id ?? null,
      categoryName:       r.category_name ?? null,
      costCenterId:       r.cost_center_id ?? null,
      costCenterName:     r.cost_center_name ?? null,
      businessUnitId:     r.business_unit_id ?? null,
      businessUnitName:   r.business_unit_name ?? null,
      legalEntityId:      r.legal_entity_id ?? null,
      legalEntityName:    r.legal_entity_name ?? null,
      contactId:          r.contact_id ?? null,
      contactName:        r.contact_name ?? null,
      allocationId:       r.allocation_id ?? null,
      isAllocated:        r.is_allocated === true,
      accountId:          r.account_id ?? null,
      accountName:        r.account_name ?? null,
      accountType:        r.account_type ?? null,
      accountNumber:      r.account_number ?? null,
      connectionLogoUrl:  customLogo ?? autoLogo,
      connectionBadge:    badge,
      parentCategoryId:   parentId,
      parentCategoryName: parentName,
      parentCategoryType: parentType,
    }
  })

  return { transactions }
}
