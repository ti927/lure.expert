'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { CATEGORY_TYPE_LABELS } from './types'
import type { SimpleDimensionItem, CategoryItem, DimensionOption, GroupedDimensionOption } from './types'

// ─── Cell Combobox (classificação inline em uma linha) ───────────────────────

interface CellComboboxProps {
  value: string | null
  options: SimpleDimensionItem[]
  placeholder?: string
  onValueChange: (value: string | null) => void
  disabled?: boolean
}

export function CellCombobox({ value, options, placeholder = '—', onValueChange, disabled }: CellComboboxProps) {
  const [open, setOpen] = useState(false)
  const selected = options.find(o => o.id === value)
  const label = selected ? (selected.code ? `${selected.code} – ${selected.name}` : selected.name) : null

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button disabled={disabled} className={cn(
          'flex h-8 w-full items-center justify-between rounded-md px-2 text-xs transition-colors',
          'border border-transparent bg-transparent',
          'hover:border-input hover:bg-background',
          'focus:outline-none focus:border-input focus:bg-background',
          'disabled:opacity-50 disabled:pointer-events-none',
          open && 'border-input bg-background',
        )}>
          <span className={cn('truncate', !label && 'text-muted-foreground')}>{label ?? placeholder}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start" side="bottom">
        <Command>
          <CommandInput placeholder="Buscar..." />
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
            <CommandItem value="__clear__" onSelect={() => { onValueChange(null); setOpen(false) }} className="text-muted-foreground">
              <Check className={cn('mr-2 h-3 w-3', value === null ? 'opacity-100' : 'opacity-0')} />—
            </CommandItem>
            <CommandSeparator />
            {options.map(opt => {
              const itemLabel = opt.code ? `${opt.code} – ${opt.name}` : opt.name
              return (
                <CommandItem key={opt.id} value={itemLabel} onSelect={() => { onValueChange(opt.id); setOpen(false) }}>
                  <Check className={cn('mr-2 h-3 w-3', value === opt.id ? 'opacity-100' : 'opacity-0')} />
                  {itemLabel}
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Category Cell Combobox (agrupado por tipo) ──────────────────────────────

interface CategoryCellComboboxProps {
  value: string | null
  categories: CategoryItem[]
  onValueChange: (value: string | null) => void
  disabled?: boolean
}

export function CategoryCellCombobox({ value, categories, onValueChange, disabled }: CategoryCellComboboxProps) {
  const [open, setOpen] = useState(false)
  const selected = categories.find(c => c.id === value)
  const label = selected ? `${selected.code} – ${selected.name}` : null

  const parentIds = new Set(categories.map(c => c.parentId).filter(Boolean) as string[])
  const byType = categories
    .filter(c => !parentIds.has(c.id))
    .reduce((acc, c) => {
      if (!acc[c.type]) acc[c.type] = []
      acc[c.type].push(c)
      return acc
    }, {} as Record<string, CategoryItem[]>)

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button disabled={disabled} className={cn(
          'flex h-8 w-full items-center justify-between rounded-md px-2 text-xs transition-colors',
          'border border-transparent bg-transparent',
          'hover:border-input hover:bg-background',
          'focus:outline-none focus:border-input focus:bg-background',
          'disabled:opacity-50 disabled:pointer-events-none',
          open && 'border-input bg-background',
        )}>
          <span className={cn('truncate', !label && 'text-muted-foreground')}>{label ?? '—'}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" side="bottom">
        <Command>
          <CommandInput placeholder="Buscar categoria..." />
          <CommandList>
            <CommandEmpty>Nenhuma categoria encontrada.</CommandEmpty>
            <CommandItem value="__clear__" onSelect={() => { onValueChange(null); setOpen(false) }} className="text-muted-foreground">
              <Check className={cn('mr-2 h-3 w-3', value === null ? 'opacity-100' : 'opacity-0')} />—
            </CommandItem>
            <CommandSeparator />
            {Object.entries(byType).map(([type, cats]) => (
              <CommandGroup key={type} heading={CATEGORY_TYPE_LABELS[type] ?? type}>
                {cats.map(cat => {
                  const itemLabel = `${cat.code} – ${cat.name}`
                  return (
                    <CommandItem key={cat.id} value={itemLabel} onSelect={() => { onValueChange(cat.id); setOpen(false) }}>
                      <Check className={cn('mr-2 h-3 w-3', value === cat.id ? 'opacity-100' : 'opacity-0')} />
                      {itemLabel}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Batch Dialog Combobox ────────────────────────────────────────────────────

interface BatchComboboxProps {
  value: string
  options: DimensionOption[]
  placeholder: string
  onValueChange: (v: string) => void
  grouped?: GroupedDimensionOption[]
}

export function BatchCombobox({ value, options, placeholder, onValueChange, grouped }: BatchComboboxProps) {
  const [open, setOpen] = useState(false)
  const isNull = value === '__null__'
  const selected = isNull ? null : options.find(o => o.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex h-8 w-full items-center justify-between rounded-md border border-input px-3 text-xs bg-background',
          'hover:bg-accent transition-colors focus:outline-none focus:ring-1 focus:ring-ring',
        )}>
          <span className={cn('truncate', !selected && !isNull && 'text-muted-foreground', isNull && 'text-muted-foreground italic')}>
            {isNull ? '— Remover' : (selected?.label ?? placeholder)}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start" onWheel={e => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Buscar..." />
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
            <CommandItem value="__null__" onSelect={() => { onValueChange('__null__'); setOpen(false) }} className={cn('text-xs italic', isNull ? 'text-foreground' : 'text-muted-foreground')}>
              <Check className={cn('mr-2 h-3 w-3', isNull ? 'opacity-100' : 'opacity-0')} />
              — Remover (gravar em branco)
            </CommandItem>
            {value && value !== '__null__' && (
              <CommandItem value="__clear__" onSelect={() => { onValueChange(''); setOpen(false) }} className="text-xs text-muted-foreground italic">
                — Não alterar
              </CommandItem>
            )}
            {grouped ? grouped.map(group => (
              <CommandGroup key={group.type} heading={CATEGORY_TYPE_LABELS[group.type] ?? group.type}>
                {group.items.map(item => (
                  <CommandItem key={item.id} value={item.label} onSelect={() => { onValueChange(item.id); setOpen(false) }}>
                    <Check className={cn('mr-2 h-3 w-3', value === item.id ? 'opacity-100' : 'opacity-0')} />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )) : options.map(item => (
              <CommandItem key={item.id} value={item.label} onSelect={() => { onValueChange(item.id); setOpen(false) }}>
                <Check className={cn('mr-2 h-3 w-3', value === item.id ? 'opacity-100' : 'opacity-0')} />
                {item.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
