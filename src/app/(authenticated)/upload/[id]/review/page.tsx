import { getDocumentStagingRows, getAccountOptions } from '@/server/staging'
import ReviewClient from './review-client'

interface Props {
  params: { id: string }
}

export default async function ReviewPage({ params }: Props) {
  // As contas já existentes vêm do servidor e não de uma chamada no cliente:
  // sem elas o campo de conta pediria digitação, e digitação sem cadastro
  // multiplica conta ("Itaú PJ" × "Itaú Pessoa Jurídica" são duas).
  const [data, contas] = await Promise.all([
    getDocumentStagingRows(params.id),
    getAccountOptions(),
  ])
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ReviewClient documentId={params.id} initialData={data} contasExistentes={contas} />
    </div>
  )
}
