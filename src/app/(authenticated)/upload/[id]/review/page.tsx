import { getDocumentStagingRows } from '@/server/staging'
import ReviewClient from './review-client'

interface Props {
  params: { id: string }
}

export default async function ReviewPage({ params }: Props) {
  const data = await getDocumentStagingRows(params.id)
  return (
    <div className="container mx-auto max-w-7xl py-8 px-4">
      <ReviewClient documentId={params.id} initialData={data} />
    </div>
  )
}
