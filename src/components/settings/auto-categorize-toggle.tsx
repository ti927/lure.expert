'use client'

import { useState, useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { setAutoCategorize } from '@/server/settings'
import { toast } from 'sonner'

export function AutoCategorizeToggle({ initialValue }: { initialValue: boolean }) {
  const [enabled, setEnabled] = useState(initialValue)
  const [isPending, startTransition] = useTransition()

  function toggle(val: boolean) {
    setEnabled(val)
    startTransition(async () => {
      await setAutoCategorize(val)
      toast.success(
        val ? 'Categorização automática ativada' : 'Categorização automática desativada',
      )
    })
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">Categorização automática</p>
        <p className="text-xs text-muted-foreground">
          {enabled
            ? 'O expert categoriza os lançamentos automaticamente ao importar ou sincronizar.'
            : 'Desativada — lançamentos entram sem categoria. Use "Categorizar agora" em Transações quando quiser.'}
        </p>
      </div>
      <Switch checked={enabled} onCheckedChange={toggle} disabled={isPending} className="shrink-0" />
    </div>
  )
}
