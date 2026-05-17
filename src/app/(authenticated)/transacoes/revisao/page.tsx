import { getReviewQueue } from '@/server/review'
import RevisaoClient from './revisao-client'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: { page?: string }
}

export default async function RevisaoPage({ searchParams }: Props) {
  const page = Number(searchParams.page ?? 1)
  const data = await getReviewQueue(page)

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
