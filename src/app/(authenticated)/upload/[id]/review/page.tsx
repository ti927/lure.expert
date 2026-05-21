import { getDocumentStagingRows } from '@/server/staging'
import ReviewClient from './review-client'

interface Props {
  params: { id: string }
}

export default async function ReviewPage({ params }: Props) {
  const data = await getDocumentStagingRows(params.id)
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ReviewClient documentId={params.id} initialData={data} />
    </div>
  )
}
