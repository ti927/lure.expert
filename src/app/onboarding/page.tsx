'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createOrganization } from './actions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const SECTORS = [
  { value: 'servicos-b2b', label: 'Serviços B2B' },
  { value: 'distribuicao', label: 'Distribuição / Atacado' },
  { value: 'ecommerce', label: 'Comércio Eletrônico' },
  { value: 'saude', label: 'Saúde e Clínicas' },
  { value: 'educacao', label: 'Educação' },
  { value: 'industria', label: 'Indústria' },
  { value: 'construcao', label: 'Construção Civil' },
  { value: 'outros', label: 'Outros' },
]

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Criando empresa...' : 'Criar empresa'}
    </Button>
  )
}

export default function OnboardingPage() {
  const [state, formAction] = useFormState(createOrganization, { error: null })

  return (
    <Card className="w-full max-w-md shadow-md">
      <CardHeader className="space-y-1">
        <div className="mb-2 text-2xl font-bold text-primary">lure.expert</div>
        <CardTitle className="text-xl">Bem-vindo</CardTitle>
        <CardDescription>
          Vamos configurar sua empresa para começar.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="name">Nome da empresa</Label>
            <Input
              id="name"
              name="name"
              placeholder="Empresa Exemplo Ltda"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cnpj">
              CNPJ <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="cnpj"
              name="cnpj"
              placeholder="00.000.000/0001-00"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sector">
              Setor <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Select name="sector">
              <SelectTrigger id="sector">
                <SelectValue placeholder="Selecione o setor" />
              </SelectTrigger>
              <SelectContent>
                {SECTORS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  )
}
