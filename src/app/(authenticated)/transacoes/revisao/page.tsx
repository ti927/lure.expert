import type { Metadata } from 'next'
import { getReviewQueue } from '@/server/review'
import RevisaoClient from './revisao-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Revisão de Sugestões' }

interface Props {
  searchParams: {
    page?: string
    q?: string
    from?: string
    to?: string
    direction?: string
    category?: string
    costCenter?: string
    businessUnit?: string
    legalEntity?: string
  }
}

export default async function RevisaoPage({ searchParams }: Props) {
  const data = await getReviewQueue({
    page: Number(searchParams.page ?? 1),
    q: searchParams.q,
    from: searchParams.from,
    to: searchParams.to,
    direction: searchParams.direction,
    category: searchParams.category,
    costCenter: searchParams.costCenter,
    businessUnit: searchParams.businessUnit,
    legalEntity: searchParams.legalEntity,
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Revisão do expert</h1>
        <p className="mt-1 text-sm text-slate-500">
          Transações classificadas pelo expert aguardando sua confirmação.
        </p>
      </div>

      <RevisaoClient {...data} />
    </div>
  )
}
