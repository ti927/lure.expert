'use client'

import { ErrorState } from '@/components/states/error-state'

export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="Não foi possível carregar o extrato"
      description="A conferência de saldo desta conta não carregou. Tente de novo."
      technical={error.digest ?? error.message}
      onRetry={reset}
    />
  )
}
