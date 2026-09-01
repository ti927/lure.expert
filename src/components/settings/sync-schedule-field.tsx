'use client'

/**
 * Quando o expert relê os bancos.
 *
 * O texto é honesto sobre o que a agenda controla: a **releitura** do que a
 * Pluggy já tem. Quem vai ao banco é a Pluggy, uma vez por dia, e quando ela
 * termina o lure.expert é avisado na hora — então frequência alta aqui quase
 * nunca traz algo novo. Prometer "dado mais fresco" seria mentira, e é o tipo de
 * promessa que ninguém consegue conferir.
 */

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { setAgendaDeSync } from '@/server/settings'
import {
  FREQUENCIAS_DE_SYNC, descreverAgenda, formatarHora, rotuloDeFrequencia,
  type AgendaDeSync, type FrequenciaDeSync,
} from '@/lib/sync-schedule'

const HORAS = Array.from({ length: 24 }, (_, h) => h)

export function SyncScheduleField({ initialValue }: { initialValue: AgendaDeSync }) {
  const [agenda, setAgenda] = useState<AgendaDeSync>(initialValue)
  const [salvando, startSalvar] = useTransition()

  function salvar(nova: AgendaDeSync) {
    const anterior = agenda
    setAgenda(nova)
    startSalvar(async () => {
      const r = await setAgendaDeSync(nova)
      if ('error' in r) {
        setAgenda(anterior)
        toast.error(r.error)
        return
      }
      toast.success(`Sincronização ${r.descricao}.`)
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Sincronização automática dos bancos</p>
          <p className="text-xs text-muted-foreground">
            Horário de Brasília. O expert relê o que os bancos já enviaram à Pluggy — quem consulta o
            banco é a Pluggy, uma vez por dia, e o que ela traz entra aqui no mesmo instante.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Select
            value={String(agenda.horaInicial)}
            onValueChange={v => salvar({ ...agenda, horaInicial: Number(v) })}
            disabled={salvando}
          >
            <SelectTrigger className="h-8 w-24 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {HORAS.map(h => (
                <SelectItem key={h} value={String(h)}>{formatarHora(h)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={String(agenda.aCada)}
            onValueChange={v => salvar({ ...agenda, aCada: Number(v) as FrequenciaDeSync })}
            disabled={salvando}
          >
            <SelectTrigger className="h-8 w-36 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FREQUENCIAS_DE_SYNC.map(f => (
                <SelectItem key={f} value={String(f)}>{rotuloDeFrequencia(f)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* A mesma função que a regra usa para decidir as horas — escrever o
          horário de novo aqui é como o texto passa a mentir. */}
      <p className="text-xs text-muted-foreground">
        Roda <span className="font-medium text-foreground">{descreverAgenda(agenda)}</span>.
        Você também pode atualizar qualquer conexão na hora, em Contas.
      </p>
    </div>
  )
}
