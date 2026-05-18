import { getReconciliationQueue } from '@/server/reconciliation'
import ReconciliacaoClient from './reconciliacao-client'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: { page?: string }
}

export default async function ReconciliacaoPage({ searchParams }: Props) {
  const page = Number(searchParams.page ?? 1)
  const data = await getReconciliationQueue(page)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Reconciliação de extratos</h1>
        <p className="mt-1 text-sm text-slate-500">
          Transações importadas com possível duplicata no banco conectado aguardando confirmação.
        </p>
      </div>

      <ReconciliacaoClient {...data} />
    </div>
  )
}
