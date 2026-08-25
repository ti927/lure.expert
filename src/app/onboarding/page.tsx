// Virou server component na Fase 4.A: além de criar empresa, o onboarding
// passou a mostrar os convites pendentes — quem foi convidado aceita aqui em
// vez de criar uma organização vazia por engano.

import { getMeusConvites } from '@/server/members'
import { PendingInvites } from '@/components/settings/pending-invites'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { OnboardingForm } from './onboarding-form'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const convites = await getMeusConvites()

  if (convites.length === 0) {
    return <OnboardingForm temConvites={false} />
  }

  return (
    <div className="w-full max-w-md space-y-4">
      <Card className="shadow-md">
        <CardHeader className="space-y-1">
          <div className="mb-2 text-2xl font-bold text-primary">lure.expert</div>
          <CardTitle className="text-xl">Você foi convidado</CardTitle>
          <CardDescription>
            {convites.length === 1
              ? 'Uma empresa convidou você. Aceite para entrar.'
              : `${convites.length} empresas convidaram você. Aceite para entrar.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PendingInvites convites={convites} />
        </CardContent>
      </Card>

      <OnboardingForm temConvites />
    </div>
  )
}
