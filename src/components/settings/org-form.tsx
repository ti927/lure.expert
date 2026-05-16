'use client'

import { useEffect } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { updateOrganization } from '@/app/(authenticated)/configuracoes/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Organization } from '@/db/schema'

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

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Salvando...' : 'Salvar alterações'}
    </Button>
  )
}

interface OrgFormProps {
  org: Organization
}

export function OrgForm({ org }: OrgFormProps) {
  const [state, formAction] = useFormState(updateOrganization, { success: false, error: null })

  const sector = (org.settings as Record<string, string> | null)?.sector ?? ''

  useEffect(() => {
    if (state.success) toast.success('Alterações salvas com sucesso.')
    if (state.error) toast.error(state.error)
  }, [state])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="orgId" value={org.id} />

      <div className="space-y-1.5">
        <Label htmlFor="name">Nome da empresa</Label>
        <Input id="name" name="name" defaultValue={org.name} required />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cnpj">
          CNPJ <span className="text-muted-foreground text-xs">(opcional)</span>
        </Label>
        <Input
          id="cnpj"
          name="cnpj"
          defaultValue={org.cnpj ?? ''}
          placeholder="00.000.000/0001-00"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sector">
          Setor <span className="text-muted-foreground text-xs">(opcional)</span>
        </Label>
        <Select name="sector" defaultValue={sector}>
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

      <div className="space-y-1.5">
        <Label>Identificador (slug)</Label>
        <Input value={org.slug} disabled className="font-mono text-sm text-muted-foreground" readOnly />
        <p className="text-xs text-muted-foreground">Gerado automaticamente. Não é editável.</p>
      </div>

      <div className="space-y-1.5">
        <Label>Status do plano</Label>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            {org.subscriptionStatus === 'trial' ? 'Trial' : org.subscriptionStatus}
          </span>
          {org.trialEndsAt && (
            <span className="text-xs text-muted-foreground">
              até {new Date(org.trialEndsAt).toLocaleDateString('pt-BR')}
            </span>
          )}
        </div>
      </div>

      <SaveButton />
    </form>
  )
}
