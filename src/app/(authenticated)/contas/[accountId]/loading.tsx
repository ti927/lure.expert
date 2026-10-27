import { LoadingState } from '@/components/states/loading-state'

export default function Loading() {
  return (
    <div className="p-6 space-y-6">
      <div className="h-7 w-64 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}
      </div>
      <LoadingState rows={10} />
    </div>
  )
}
