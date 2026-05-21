'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { CATEGORY_TYPE_LABELS } from './types'
import type { DimensionOption, GroupedDimensionOption } from './types'

// ─── Multi-Select Filter (usado nos headers de coluna) ────────────────────────

interface MultiSelectFilterProps {
  placeholder: string
  value: string | undefined
  options: DimensionOption[]
  onUpdate: (value: string | undefined) => void
  grouped?: GroupedDimensionOption[]
  showSpecial?: boolean  // Não classificado / Classificado
  width?: string
}

export function MultiSelectFilter({ placeholder, value, options, onUpdate, grouped, showSpecial = false, width = 'w-64' }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false)

  const selected = useMemo(() => {
    if (!value) return new Set<string>()
    return new Set(value.split(',').filter(Boolean))
  }, [value])

  const hasValue = selected.size > 0

  const toggle = useCallback((id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    onUpdate(next.size > 0 ? Array.from(next).join(',') : undefined)
  }, [selected, onUpdate])

  const triggerLabel = useMemo(() => {
    if (!hasValue) return null
    if (selected.size === 1) {
      const id = Array.from(selected)[0]
      if (id === '__none__') return 'Não classif.'
      if (id === '__classified__') return 'Classificado'
      const opt = [...options, ...(grouped?.flatMap(g => g.items) ?? [])].find(o => o.id === id)
      return opt?.label ?? placeholder
    }
    return `${selected.size} selecionados`
  }, [hasValue, selected, options, grouped, placeholder])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex h-full w-full items-center gap-1 px-1 text-xs font-medium truncate',
          hasValue ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          'focus:outline-none',
        )}>
          <span className="truncate flex-1 text-left">{triggerLabel ?? placeholder}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-0', width)} align="start">
        <Command>
          <CommandInput placeholder="Buscar..." />
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
            {showSpecial && (
              <>
                <CommandItem value="__none__" onSelect={() => toggle('__none__')} className="text-muted-foreground">
                  <div className={cn('mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0', selected.has('__none__') ? 'bg-primary border-primary' : 'border-muted-foreground/40')}>
                    {selected.has('__none__') && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </div>
                  Não classificado
                </CommandItem>
                <CommandItem value="__classified__" onSelect={() => toggle('__classified__')} className="text-muted-foreground">
                  <div className={cn('mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0', selected.has('__classified__') ? 'bg-primary border-primary' : 'border-muted-foreground/40')}>
                    {selected.has('__classified__') && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </div>
                  Classificado
                </CommandItem>
                <CommandSeparator />
              </>
            )}
            {grouped ? grouped.map(group => (
              <CommandGroup key={group.type} heading={CATEGORY_TYPE_LABELS[group.type] ?? group.type}>
                {group.items.map(item => (
                  <CommandItem key={item.id} value={item.label} onSelect={() => toggle(item.id)}>
                    <div className={cn('mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0', selected.has(item.id) ? 'bg-primary border-primary' : 'border-muted-foreground/40')}>
                      {selected.has(item.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    <span className="truncate">{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )) : options.map(opt => (
              <CommandItem key={opt.id} value={opt.label} onSelect={() => toggle(opt.id)}>
                <div className={cn('mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0', selected.has(opt.id) ? 'bg-primary border-primary' : 'border-muted-foreground/40')}>
                  {selected.has(opt.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </div>
                <span className="truncate">{opt.label}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Amount range filter popover ──────────────────────────────────────────────

interface AmountFilterProps {
  amountMin: string | undefined
  amountMax: string | undefined
  onUpdate: (updates: Record<string, string | undefined>) => void
}

export function AmountFilter({ amountMin, amountMax, onUpdate }: AmountFilterProps) {
  const [open, setOpen] = useState(false)
  const [localMin, setLocalMin] = useState(amountMin ?? '')
  const [localMax, setLocalMax] = useState(amountMax ?? '')

  useEffect(() => { setLocalMin(amountMin ?? '') }, [amountMin])
  useEffect(() => { setLocalMax(amountMax ?? '') }, [amountMax])

  const hasValue = !!(amountMin || amountMax)

  const label = hasValue
    ? (amountMin && amountMax ? `${amountMin}–${amountMax}` : amountMin ? `≥${amountMin}` : `≤${amountMax}`)
    : null

  function apply() {
    onUpdate({
      amountMin: localMin || undefined,
      amountMax: localMax || undefined,
      page: undefined,
    })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex h-full w-full items-center gap-1 px-1 text-xs font-medium truncate',
          hasValue ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          'focus:outline-none',
        )}>
          <span className="truncate flex-1 text-left">{label ?? 'Valor'}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-3" align="start">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Filtrar por valor (R$)</p>
          <div className="flex gap-2">
            <div className="flex-1">
              <p className="text-[10px] text-muted-foreground mb-1">Mínimo</p>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0,00"
                value={localMin}
                onChange={e => setLocalMin(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && apply()}
                className="w-full h-7 rounded-md border border-input px-2 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-muted-foreground mb-1">Máximo</p>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="∞"
                value={localMax}
                onChange={e => setLocalMax(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && apply()}
                className="w-full h-7 rounded-md border border-input px-2 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <Button size="sm" className="w-full h-7 text-xs" onClick={apply}>Aplicar</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Description text filter (inline input in header) ─────────────────────────

interface DescFilterProps {
  value: string | undefined
  onUpdate: (v: string | undefined) => void
}

export function DescFilter({ value, onUpdate }: DescFilterProps) {
  const [local, setLocal] = useState(value ?? '')

  useEffect(() => { setLocal(value ?? '') }, [value])

  useEffect(() => {
    const t = setTimeout(() => {
      const cur = value ?? ''
      if (local.trim() !== cur) onUpdate(local.trim() || undefined)
    }, 400)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local])

  return (
    <input
      type="text"
      value={local}
      onChange={e => setLocal(e.target.value)}
      placeholder="Descrição"
      className="h-full w-full bg-transparent text-xs font-medium placeholder:text-muted-foreground focus:outline-none px-1 truncate"
    />
  )
}

// ─── Direction filter ─────────────────────────────────────────────────────────

interface DirectionFilterProps {
  value: string | undefined
  onUpdate: (v: string | undefined) => void
}

export function DirectionFilter({ value, onUpdate }: DirectionFilterProps) {
  const [open, setOpen] = useState(false)
  const label = value === 'inflow' ? 'Entrada' : value === 'outflow' ? 'Saída' : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex h-full w-full items-center gap-1 px-1 text-xs font-medium',
          value ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          'focus:outline-none',
        )}>
          <span className="flex-1 text-left">{label ?? 'Tipo'}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-0" align="start">
        <Command>
          <CommandList>
            {[
              { id: undefined, label: 'Todos' },
              { id: 'inflow',  label: 'Entrada' },
              { id: 'outflow', label: 'Saída' },
            ].map(opt => (
              <CommandItem key={opt.id ?? '__all__'} value={opt.label} onSelect={() => { onUpdate(opt.id); setOpen(false) }}>
                <Check className={cn('mr-2 h-3 w-3', value === opt.id ? 'opacity-100' : 'opacity-0')} />
                {opt.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Report type filter (BP/DRE) ──────────────────────────────────────────────

interface ReportTypeFilterProps {
  value: string | undefined
  onUpdate: (v: string | undefined) => void
}

export function ReportTypeFilter({ value, onUpdate }: ReportTypeFilterProps) {
  const [open, setOpen] = useState(false)
  const label = value === 'balance_sheet' ? 'BP' : value === 'other' ? 'DRE' : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex h-full w-full items-center gap-1 px-1 text-xs font-medium',
          value ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          'focus:outline-none',
        )}>
          <span className="flex-1 text-left">{label ?? 'Origem'}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-0" align="start">
        <Command>
          <CommandList>
            {[
              { id: undefined,       label: 'Todos' },
              { id: 'other',         label: 'DRE / Extrato' },
              { id: 'balance_sheet', label: 'Balanço Patrimonial' },
            ].map(opt => (
              <CommandItem key={opt.id ?? '__all__'} value={opt.label} onSelect={() => { onUpdate(opt.id); setOpen(false) }}>
                <Check className={cn('mr-2 h-3 w-3', value === opt.id ? 'opacity-100' : 'opacity-0')} />
                {opt.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
