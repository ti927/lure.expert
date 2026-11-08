// GET /fluxo/exportar?from=YYYY-MM&to=YYYY-MM&cc=..&bu=..&le=..
//
// Devolve o .xlsx do /fluxo com o período e os filtros da tela. Route handler
// (e não server action) porque o que ele entrega é um ARQUIVO: o navegador
// baixa direto do link, sem passar o conteúdo pelo React.
//
// Autentica pela sessão (cookie) como as páginas; ver a tela é permitido a todo
// papel, então exportar também é.

import { z } from 'zod'
import { getAuthContext } from '@/lib/auth-context'
import { exportarFluxo } from '@/lib/fluxo-export'
import { DIM_NONE } from '@/lib/dre-types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const id  = z.union([z.string().uuid(), z.literal(DIM_NONE)])

const paramsSchema = z.object({
  from: mes,
  to:   mes,
  cc:   z.array(id).max(200),
  bu:   z.array(id).max(200),
  le:   z.array(id).max(200),
}).refine(p => p.from <= p.to, { message: 'O início do período é depois do fim.' })

export async function GET(req: Request) {
  const { organizationId } = await getAuthContext()

  const q = new URL(req.url).searchParams
  const parsed = paramsSchema.safeParse({
    from: q.get('from'),
    to:   q.get('to'),
    cc:   q.getAll('cc'),
    bu:   q.getAll('bu'),
    le:   q.getAll('le'),
  })
  if (!parsed.success) {
    return new Response(`Parâmetros inválidos: ${parsed.error.issues.map(i => i.message).join('; ')}`, { status: 400 })
  }

  const { from, to, cc, bu, le } = parsed.data
  const [y2, m2] = to.split('-').map(Number)
  const lastDay = new Date(y2, m2, 0).getDate()

  const { arquivo, nome } = await exportarFluxo(organizationId, {
    from: `${from}-01`,
    to:   `${to}-${String(lastDay).padStart(2, '0')}`,
    costCenterIds:   cc.length ? cc : undefined,
    businessUnitIds: bu.length ? bu : undefined,
    legalEntityIds:  le.length ? le : undefined,
  })

  return new Response(new Uint8Array(arquivo), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nome}"`,
      'Cache-Control': 'no-store',
    },
  })
}
