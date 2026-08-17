'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'

// Filtro multi-select de dimensão em barra de filtros (não em header de coluna —
// para isso use `MultiSelectFilter`). Usado por /dre, /fluxo e /orcamento.

export type DimOption = { id: string; name: string; code?: string | null }

/** Sentinela para "sem essa dimensão preenchida". */
export const DIM_NONE = '__null__'

interface DimFilterProps {
  label: string
  options: DimOption[]
  selected: string[]
  onChange: (ids: string[]) => void
  /**
   * Acrescenta a opção "Sem <label>". Importante numa comparação orçado ×
   * realizado: sem ela, o balde de transações sem a dimensão preenchida
   * simplesmente evapora do total quando se filtra.
   */
  allowNone?: boolean
}

export function DimFilter({ label, options, selected, onChange, allowNone }: DimFilterProps) {
  const [open, setOpen] = useState(false)
  if (options.length === 0) return null

  const displayText = selected.length === 0
    ? label
    : selected.length === 1
    ? (selected[0] === DIM_NONE ? `Sem ${label.toLowerCase()}` : options.find(o => o.id === selected[0])?.name ?? label)
    : `${label}: ${selected.length}`

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('h-8 gap-1.5 text-xs font-normal', selected.length > 0 && 'border-primary/30 bg-primary/5')}
        >
          <span className="truncate max-w-[140px]">{displayText}</span>
          {selected.length > 0 ? (
            <X
              className="h-3 w-3 shrink-0 opacity-50 hover:opacity-100"
              onClick={e => { e.stopPropagation(); onChange([]) }}
            />
          ) : (
            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar..." className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              Nenhum resultado.
            </CommandEmpty>
            <CommandGroup>
              {allowNone && (
                <CommandItem
                  value={`sem ${label}`}
                  onSelect={() => toggle(DIM_NONE)}
                  className="text-xs italic text-muted-foreground"
                >
                  <Check className={cn('mr-2 h-3 w-3 shrink-0', selected.includes(DIM_NONE) ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">Sem {label.toLowerCase()}</span>
                </CommandItem>
              )}
              {options.map(opt => {
                const checked = selected.includes(opt.id)
                return (
                  <CommandItem
                    key={opt.id}
                    value={`${opt.code ?? ''} ${opt.name}`}
                    onSelect={() => toggle(opt.id)}
                    className="text-xs"
                  >
                    <Check className={cn('mr-2 h-3 w-3 shrink-0', checked ? 'opacity-100' : 'opacity-0')} />
                    {opt.code && <span className="text-muted-foreground mr-1 font-mono text-[10px] shrink-0">{opt.code}</span>}
                    <span className="truncate">{opt.name}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
