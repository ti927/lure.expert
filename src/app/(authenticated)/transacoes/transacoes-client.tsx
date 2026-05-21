'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft, ChevronRight, ChevronsUpDown, Check, Layers,
  X, ArrowUp, ArrowDown, ArrowUpDown, Trash2, Bot,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/states/empty-state'
import { cn } from '@/lib/utils'
import { classifyTransaction, batchClassifyTransactions, deleteTransactions, triggerCategorization } from '@/server/transactions'
import type { DataSourceOption } from '@/server/connections'
import type { Transaction } from '@/db/schema/transactions'
import type { Category } from '@/db/schema/categories'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'

const CATEGORY_TYPE_LABELS: Record<string, string> = {
  receita_operacional:       'Receita Operacional',
  deducoes_tributarias:      'Deduções Tributárias',
  deducoes_operacionais:     'Deduções Operacionais',
  cpv:                       'CPV / CMV / CSP',
  sga:                       'SG&A',
  resultado_financeiro:      'Receitas & Despesas Financeiras',
  ir:                        'Impostos Sobre Renda',
  emprestimos_amortizacoes:  'Empréstimos & Amortizações',
  investimentos_retiradas:   'Investimentos & Retiradas',
  transfer:                  'Transitórios',
  ativo_circulante:          'Ativo Circulante',
  ativo_nao_circulante:      'Ativo Não-Circulante',
  passivo_circulante:        'Passivo Circulante',
  passivo_nao_circulante:    'Passivo Não-Circulante',
  patrimonio_liquido:        'Patrimônio Líquido',
}

const ACCT_LABELS: Record<string, string> = {
  CHECKING_ACCOUNT: 'C. Corrente',
  SAVINGS_ACCOUNT:  'Poupança',
  CREDIT_CARD:      'Cartão',
}

interface SearchParams {
  page?: string
  q?: string
  from?: string
  to?: string
  direction?: string
  category?: string
  costCenter?: string
  businessUnit?: string
  legalEntity?: string
  documentId?: string
  accountId?: string
  sort?: string
  reportType?: string
  amountMin?: string
  amountMax?: string
}

interface DimensionOptions {
  categories: Category[]
  costCenters: CostCenter[]
  businessUnits: BusinessUnit[]
  legalEntities: LegalEntity[]
}

type TxRow = Transaction & { documentReportType?: string | null }

interface Props {
  data: { rows: TxRow[]; total: number; pages: number; page: number; totals: { inflow: string; outflow: string } }
  options: DimensionOptions
  dataSources: DataSourceOption[]
  searchParams: SearchParams
  reviewCount: number
  hasAnyFilter: boolean
}

type DimensionField = 'categoryId' | 'costCenterId' | 'businessUnitId' | 'legalEntityId'

function formatDate(iso: string): string {
  const p = iso.split('-')
  if (p.length !== 3) return iso
  return `${p[2]}/${p[1]}/${p[0].slice(2)}`
}

function formatBRL(amount: string | number): string {
  return Number(amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ─── Multi-Select Filter (usado nos headers de coluna) ────────────────────────

interface MultiSelectFilterProps {
  placeholder: string
  value: string | undefined
  options: { id: string; label: string }[]
  onUpdate: (value: string | undefined) => void
  grouped?: { type: string; items: { id: string; label: string }[] }[]
  showSpecial?: boolean  // Não classificado / Classificado
  width?: string
}

function MultiSelectFilter({ placeholder, value, options, onUpdate, grouped, showSpecial = false, width = 'w-64' }: MultiSelectFilterProps) {
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

// ─── Column Header with integrated filter + sort ──────────────────────────────

interface ColHeaderProps {
  children: React.ReactNode    // the filter widget
  hasValue: boolean
  onClear: () => void
  sortKey?: string
  currentSort?: string
  onSort?: () => void
  className?: string
}

function ColHeader({ children, hasValue, onClear, sortKey, currentSort, onSort, className }: ColHeaderProps) {
  const isAsc  = sortKey ? currentSort === `${sortKey}_asc` : false
  // date defaults to desc when no sort is set
  const isDesc = sortKey ? (currentSort === `${sortKey}_desc` || (!currentSort && sortKey === 'date')) : false

  return (
    <div className={cn('flex items-center h-8 gap-0.5', className)}>
      {onSort && (
        <button
          onClick={onSort}
          className="shrink-0 h-6 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground focus:outline-none"
          tabIndex={-1}
        >
          {isAsc  ? <ArrowUp   className="h-3 w-3 text-primary" /> :
           isDesc ? <ArrowDown className="h-3 w-3 text-primary" /> :
                    <ArrowUpDown className="h-3 w-3 opacity-40" />}
        </button>
      )}
      <div className="flex-1 min-w-0 h-full flex items-center overflow-hidden">
        {children}
      </div>
      <button
        onClick={onClear}
        tabIndex={-1}
        className={cn(
          'shrink-0 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-opacity',
          hasValue ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

// ─── Amount range filter popover ──────────────────────────────────────────────

interface AmountFilterProps {
  amountMin: string | undefined
  amountMax: string | undefined
  onUpdate: (updates: Record<string, string | undefined>) => void
}

function AmountFilter({ amountMin, amountMax, onUpdate }: AmountFilterProps) {
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

function DescFilter({ value, onUpdate }: DescFilterProps) {
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

function DirectionFilter({ value, onUpdate }: DirectionFilterProps) {
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

// ─── Report type filter ───────────────────────────────────────────────────────

interface ReportTypeFilterProps {
  value: string | undefined
  onUpdate: (v: string | undefined) => void
}

function ReportTypeFilter({ value, onUpdate }: ReportTypeFilterProps) {
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

// ─── Cell Combobox (classificação inline) ────────────────────────────────────

interface CellComboboxProps {
  value: string | null
  options: { id: string; name: string; code?: string | null }[]
  placeholder?: string
  onValueChange: (value: string | null) => void
  disabled?: boolean
}

function CellCombobox({ value, options, placeholder = '—', onValueChange, disabled }: CellComboboxProps) {
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

// ─── Category Cell Combobox ───────────────────────────────────────────────────

interface CategoryCellComboboxProps {
  value: string | null
  categories: Category[]
  onValueChange: (value: string | null) => void
  disabled?: boolean
}

function CategoryCellCombobox({ value, categories, onValueChange, disabled }: CategoryCellComboboxProps) {
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
    }, {} as Record<string, Category[]>)

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
  options: { id: string; label: string }[]
  placeholder: string
  onValueChange: (v: string) => void
  grouped?: { type: string; items: { id: string; label: string }[] }[]
}

function BatchCombobox({ value, options, placeholder, onValueChange, grouped }: BatchComboboxProps) {
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

// ─── Storage helpers ──────────────────────────────────────────────────────────

const LS_FILTERS_KEY = 'lure:transacoes:filters'
const FILTER_KEYS = ['q', 'from', 'to', 'direction', 'category', 'costCenter', 'businessUnit', 'legalEntity', 'documentId', 'accountId', 'sort', 'reportType', 'amountMin', 'amountMax'] as const

function saveFiltersToStorage(sp: SearchParams) {
  try {
    const saved: Record<string, string> = {}
    for (const k of FILTER_KEYS) { if (sp[k]) saved[k] = sp[k]! }
    localStorage.setItem(LS_FILTERS_KEY, JSON.stringify(saved))
  } catch { /* */ }
}

function loadFiltersFromStorage(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_FILTERS_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, string>
  } catch { return {} }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TransacoesClient({ data, options, dataSources, searchParams, reviewCount, hasAnyFilter }: Props) {
  const router = useRouter()
  const [localRows, setLocalRows] = useState<TxRow[]>(data.rows)
  const serverRowsRef = useRef(data.rows)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [classifyingId, setClassifyingId] = useState<string | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchForm, setBatchForm] = useState({ categoryId: '', costCenterId: '', businessUnitId: '', legalEntityId: '' })
  const [isBatching, setIsBatching] = useState(false)
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([])
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCategorizing, setIsCategorizing] = useState(false)
  const [fromLocal, setFromLocal] = useState(searchParams.from ?? '')
  const [toLocal, setToLocal] = useState(searchParams.to ?? '')

  useEffect(() => {
    serverRowsRef.current = data.rows
    setLocalRows(data.rows)
    setSelectedIds(new Set())
  }, [data.rows])

  useEffect(() => { setFromLocal(searchParams.from ?? '') }, [searchParams.from])
  useEffect(() => { setToLocal(searchParams.to ?? '') }, [searchParams.to])

  // Restaura filtros do localStorage ao montar sem filtros na URL
  useEffect(() => {
    const hasUrlFilters = FILTER_KEYS.some(k => !!searchParams[k])
    if (hasUrlFilters) return
    const saved = loadFiltersFromStorage()
    if (Object.keys(saved).length === 0) return
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(saved)) params.set(k, v)
    router.replace(`/transacoes?${params.toString()}`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasFilters = FILTER_KEYS.filter(k => k !== 'sort').some(k => !!searchParams[k])

  function updateFilters(updates: Record<string, string | undefined>) {
    const current: Record<string, string> = {}
    for (const k of FILTER_KEYS) { if (searchParams[k]) current[k] = searchParams[k]! }
    Object.assign(current, Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined) as [string, string][]))
    for (const [k, v] of Object.entries(updates)) { if (v === undefined) delete current[k] }
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(current)) { if (v) params.set(k, v) }
    saveFiltersToStorage(current as SearchParams)
    router.push(`/transacoes?${params.toString()}`)
  }

  function toggleSort(key: string) {
    const cur = searchParams.sort
    const ascKey  = `${key}_asc`
    const descKey = `${key}_desc`
    if (key === 'date') {
      // data sempre tem sort; ciclo: desc ↔ asc
      updateFilters({ sort: (!cur || cur === descKey) ? ascKey : descKey, page: undefined })
    } else {
      // demais: sem sort → desc → asc → sem sort
      if (!cur || !cur.startsWith(key + '_')) updateFilters({ sort: descKey, page: undefined })
      else if (cur === descKey)               updateFilters({ sort: ascKey, page: undefined })
      else                                   updateFilters({ sort: undefined, page: undefined })
    }
  }

  async function handleClassify(id: string, field: DimensionField, value: string | null) {
    setClassifyingId(id)
    setLocalRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
    const result = await classifyTransaction(id, { [field]: value })
    setClassifyingId(null)
    if (result?.error) { toast.error(result.error); setLocalRows(serverRowsRef.current) }
    else { toast.success('Classificação salva.'); router.refresh() }
  }

  function resolveField(v: string): string | null | undefined {
    if (v === '__null__') return null
    return v || undefined
  }

  async function handleBatchClassify() {
    const payload = {
      categoryId:     resolveField(batchForm.categoryId),
      costCenterId:   resolveField(batchForm.costCenterId),
      businessUnitId: resolveField(batchForm.businessUnitId),
      legalEntityId:  resolveField(batchForm.legalEntityId),
    }
    if (Object.values(payload).every(v => v === undefined)) { toast.error('Selecione ao menos uma dimensão.'); return }
    setIsBatching(true)
    try {
      const result = await batchClassifyTransactions(Array.from(selectedIds), payload)
      if (result?.error) { toast.error(result.error) }
      else {
        toast.success(`${result.updated} transaç${result.updated !== 1 ? 'ões' : 'ão'} classificada${result.updated !== 1 ? 's' : ''}.`)
        setBatchOpen(false); setSelectedIds(new Set()); setBatchForm({ categoryId: '', costCenterId: '', businessUnitId: '', legalEntityId: '' }); router.refresh()
      }
    } catch { toast.error('Erro ao classificar. Tente novamente.') }
    finally { setIsBatching(false) }
  }

  async function handleConfirmDelete() {
    if (deleteTargetIds.length === 0) return
    setIsDeleting(true)
    const result = await deleteTransactions(deleteTargetIds)
    setIsDeleting(false); setDeleteTargetIds([])
    if (result?.error) { toast.error(result.error) }
    else { toast.success(`${result.deleted} lançamento${result.deleted !== 1 ? 's' : ''} apagado${result.deleted !== 1 ? 's' : ''}.`); setSelectedIds(new Set()); router.refresh() }
  }

  const allSelected = localRows.length > 0 && selectedIds.size === localRows.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < localRows.length
  function toggleAll() { setSelectedIds(allSelected || someSelected ? new Set() : new Set(localRows.map(r => r.id))) }

  const selTotals = useMemo(() => {
    let selInflow = 0, selOutflow = 0
    for (const row of localRows) {
      if (!selectedIds.has(row.id)) continue
      const amt = Number(row.amount)
      if (row.direction === 'inflow') selInflow += amt
      else selOutflow += amt
    }
    return { inflow: selInflow, outflow: selOutflow, net: selInflow - selOutflow }
  }, [localRows, selectedIds])
  function toggleRow(id: string) {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  const batchParentIds = new Set(options.categories.map(c => c.parentId).filter(Boolean) as string[])
  const leafCategories = options.categories.filter(c => !batchParentIds.has(c.id))
  const categoriesByType = leafCategories.reduce((acc, c) => { if (!acc[c.type]) acc[c.type] = []; acc[c.type].push({ id: c.id, label: `${c.code} – ${c.name}` }); return acc }, {} as Record<string, { id: string; label: string }[]>)
  const groupedCategories = Object.entries(categoriesByType).map(([type, items]) => ({ type, items }))
  const allCategoryOptions = leafCategories.map(c => ({ id: c.id, label: `${c.code} – ${c.name}` }))

  const categoryFilterGroups = useMemo(() => {
    const parentIds = new Set(options.categories.map(c => c.parentId).filter(Boolean) as string[])
    const leaves = options.categories.filter(c => !parentIds.has(c.id))
    const byType = leaves.reduce((acc, c) => { if (!acc[c.type]) acc[c.type] = []; acc[c.type].push({ id: c.id, label: `${c.code} – ${c.name}` }); return acc }, {} as Record<string, { id: string; label: string }[]>)
    return Object.entries(byType).map(([type, items]) => ({ type, items }))
  }, [options.categories])

  const ccOptions  = options.costCenters.map(c => ({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name }))
  const buOptions  = options.businessUnits.map(c => ({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name }))
  const leOptions  = options.legalEntities.map(c => ({ id: c.id, label: c.name }))
  const acctOptions = dataSources.map(s => ({ id: s.accountId, label: `${s.label} (${s.txCount})` }))

  const inflow  = Number(data.totals.inflow)
  const outflow = Number(data.totals.outflow)
  const net     = inflow - outflow

  async function handleTriggerCategorization() {
    setIsCategorizing(true)
    const result = await triggerCategorization()
    setIsCategorizing(false)
    if ('error' in result) { toast.error(result.error); return }
    if (!result.triggered) { toast.info('Não há lançamentos sem categoria.'); return }
    toast.success(`Categorizando ${result.count} lançamento${result.count !== 1 ? 's' : ''}...`)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between gap-4 px-6 pt-5 pb-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Transações</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data.total} transação{data.total !== 1 ? 'ões' : ''}
            {hasAnyFilter ? ' encontrada' + (data.total !== 1 ? 's' : '') : ' no total'}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTriggerCategorization}
            disabled={isCategorizing}
            className="gap-2"
          >
            <Bot className="h-4 w-4" />
            {isCategorizing ? 'Iniciando...' : 'Categorizar agora'}
          </Button>
          {reviewCount > 0 && (
            <Link
              href="/transacoes/revisao"
              className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
            >
              <Bot className="h-4 w-4" />
              {reviewCount} sugestão{reviewCount !== 1 ? 'ões' : ''} do expert
            </Link>
          )}
        </div>
      </div>

      {/* ── Totalizador + datas + limpar ───────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-4 px-6 pb-2">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-xs text-muted-foreground">Entradas <span className="font-medium text-emerald-600 tabular-nums">{formatBRL(inflow)}</span></span>
          <span className="text-xs text-muted-foreground">Saídas <span className="font-medium text-rose-600 tabular-nums">{formatBRL(outflow)}</span></span>
          <span className="text-xs text-muted-foreground">Líquido <span className={cn('font-medium tabular-nums', net >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{net >= 0 ? '' : '−'}{formatBRL(Math.abs(net))}</span></span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Datas — ficam aqui pois precisam de dois campos */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">De</span>
            <div className="relative">
              <input
                type="date"
                value={fromLocal}
                onChange={e => {
                  const v = e.target.value; setFromLocal(v)
                  const year = parseInt(v.slice(0, 4), 10)
                  if (!v || (!isNaN(year) && year >= 2000)) updateFilters({ from: v || undefined, page: undefined })
                }}
                className="h-7 px-2 text-xs rounded-md border border-input bg-background focus:outline-none w-32"
              />
              {fromLocal && (
                <button onClick={() => { setFromLocal(''); updateFilters({ from: undefined, page: undefined }) }} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-2.5 w-2.5" /></button>
              )}
            </div>
            <span className="text-xs text-muted-foreground">Até</span>
            <div className="relative">
              <input
                type="date"
                value={toLocal}
                onChange={e => {
                  const v = e.target.value; setToLocal(v)
                  const year = parseInt(v.slice(0, 4), 10)
                  if (!v || (!isNaN(year) && year >= 2000)) updateFilters({ to: v || undefined, page: undefined })
                }}
                className="h-7 px-2 text-xs rounded-md border border-input bg-background focus:outline-none w-32"
              />
              {toLocal && (
                <button onClick={() => { setToLocal(''); updateFilters({ to: undefined, page: undefined }) }} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-2.5 w-2.5" /></button>
              )}
            </div>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { try { localStorage.removeItem(LS_FILTERS_KEY) } catch { /* */ }; setFromLocal(''); setToLocal(''); router.push('/transacoes') }} className="h-7 text-xs gap-1">
              <X className="h-3 w-3" />Limpar
            </Button>
          )}
        </div>
      </div>

      {/* ── Toolbar de seleção em lote ─────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="shrink-0 flex items-center gap-3 bg-primary/5 border-y border-primary/20 px-6 py-2">
          <span className="text-sm font-medium">{selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}</span>
          <Button size="sm" onClick={() => setBatchOpen(true)}>Classificar em lote</Button>
          <Button variant="outline" size="sm" className="text-destructive border-destructive/40 hover:bg-destructive/5" onClick={() => setDeleteTargetIds(Array.from(selectedIds))}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />Apagar selecionados
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Cancelar</Button>
        </div>
      )}

      {/* ── Tabela (scroll interno) ────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden px-6 pb-0">
        {localRows.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              icon={<Layers className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
              title="Nenhuma transação encontrada"
              description="Ajuste os filtros para ver outros resultados."
            />
          </div>
        ) : (
          <div className="h-full overflow-auto border rounded-lg">
            <table className="w-full text-sm table-fixed min-w-[1320px] [&_td]:border-r [&_th]:border-r [&_td]:border-border/20 [&_th]:border-border/20 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
              <colgroup>
                <col className="w-9" />
                <col className="w-[90px]" />
                <col className="w-[200px]" />
                <col className="w-[110px]" />
                <col className="w-[140px]" />
                <col className="w-[80px]" />
                <col className="w-[70px]" />
                <col className="w-[180px]" />
                <col className="w-[130px]" />
                <col className="w-[120px]" />
                <col className="w-[120px]" />
                <col className="w-9" />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted border-b">
                  {/* checkbox */}
                  <th className="px-2 py-1.5 text-left">
                    <input type="checkbox" className="rounded border-input" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected }} onChange={toggleAll} />
                  </th>
                  {/* Data */}
                  <th className="px-2 py-1">
                    <ColHeader hasValue={false} onClear={() => {}} sortKey="date" currentSort={searchParams.sort} onSort={() => toggleSort('date')}>
                      <span className="text-xs font-medium text-muted-foreground px-1">Data</span>
                    </ColHeader>
                  </th>
                  {/* Descrição */}
                  <th className="px-2 py-1">
                    <ColHeader hasValue={!!searchParams.q} onClear={() => updateFilters({ q: undefined, page: undefined })} sortKey="desc" currentSort={searchParams.sort} onSort={() => toggleSort('desc')}>
                      <DescFilter value={searchParams.q} onUpdate={v => updateFilters({ q: v, page: undefined })} />
                    </ColHeader>
                  </th>
                  {/* Valor */}
                  <th className="px-2 py-1">
                    <ColHeader hasValue={!!(searchParams.amountMin || searchParams.amountMax)} onClear={() => updateFilters({ amountMin: undefined, amountMax: undefined, page: undefined })} sortKey="amount" currentSort={searchParams.sort} onSort={() => toggleSort('amount')}>
                      <AmountFilter amountMin={searchParams.amountMin} amountMax={searchParams.amountMax} onUpdate={updateFilters} />
                    </ColHeader>
                  </th>
                  {/* Banco / Conta */}
                  <th className="px-2 py-1">
                    <ColHeader hasValue={!!searchParams.accountId} onClear={() => updateFilters({ accountId: undefined, page: undefined })} sortKey="account" currentSort={searchParams.sort} onSort={() => toggleSort('account')}>
                      <MultiSelectFilter placeholder="Banco/Conta" value={searchParams.accountId} options={acctOptions} onUpdate={v => updateFilters({ accountId: v, page: undefined })} width="w-72" />
                    </ColHeader>
                  </th>
                  {/* Tipo movimento */}
                  <th className="px-2 py-1">
                    <ColHeader hasValue={!!searchParams.direction} onClear={() => updateFilters({ direction: undefined, page: undefined })} sortKey="direction" currentSort={searchParams.sort} onSort={() => toggleSort('direction')}>
                      <DirectionFilter value={searchParams.direction} onUpdate={v => updateFilters({ direction: v, page: undefined })} />
                    </ColHeader>
                  </th>
                  {/* Origem DRE/BP */}
                  <th className="px-2 py-1">
                    <ColHeader hasValue={!!searchParams.reportType} onClear={() => updateFilters({ reportType: undefined, page: undefined })} sortKey="reporttype" currentSort={searchParams.sort} onSort={() => toggleSort('reporttype')}>
                      <ReportTypeFilter value={searchParams.reportType} onUpdate={v => updateFilters({ reportType: v, page: undefined })} />
                    </ColHeader>
                  </th>
                  {/* Categoria */}
                  <th className="px-2 py-1">
                    <ColHeader hasValue={!!searchParams.category} onClear={() => updateFilters({ category: undefined, page: undefined })} sortKey="category" currentSort={searchParams.sort} onSort={() => toggleSort('category')}>
                      <MultiSelectFilter placeholder="Categoria" value={searchParams.category} options={[]} grouped={categoryFilterGroups} showSpecial onUpdate={v => updateFilters({ category: v, page: undefined })} width="w-72" />
                    </ColHeader>
                  </th>
                  {/* C. custo */}
                  <th className="px-2 py-1">
                    <ColHeader hasValue={!!searchParams.costCenter} onClear={() => updateFilters({ costCenter: undefined, page: undefined })} sortKey="costcenter" currentSort={searchParams.sort} onSort={() => toggleSort('costcenter')}>
                      <MultiSelectFilter placeholder="C. custo" value={searchParams.costCenter} options={ccOptions} showSpecial onUpdate={v => updateFilters({ costCenter: v, page: undefined })} />
                    </ColHeader>
                  </th>
                  {/* Un. negócio */}
                  <th className="px-2 py-1">
                    <ColHeader hasValue={!!searchParams.businessUnit} onClear={() => updateFilters({ businessUnit: undefined, page: undefined })} sortKey="businessunit" currentSort={searchParams.sort} onSort={() => toggleSort('businessunit')}>
                      <MultiSelectFilter placeholder="Un. negócio" value={searchParams.businessUnit} options={buOptions} showSpecial onUpdate={v => updateFilters({ businessUnit: v, page: undefined })} />
                    </ColHeader>
                  </th>
                  {/* Entidade */}
                  <th className="px-2 py-1">
                    <ColHeader hasValue={!!searchParams.legalEntity} onClear={() => updateFilters({ legalEntity: undefined, page: undefined })} sortKey="legalentity" currentSort={searchParams.sort} onSort={() => toggleSort('legalentity')}>
                      <MultiSelectFilter placeholder="Entidade" value={searchParams.legalEntity} options={leOptions} showSpecial onUpdate={v => updateFilters({ legalEntity: v, page: undefined })} />
                    </ColHeader>
                  </th>
                  {/* ações */}
                  <th className="w-9" />
                </tr>
              </thead>
              <tbody>
                {localRows.map(tx => {
                  const isClassifying = classifyingId === tx.id
                  const acctLabel = tx.accountType ? (ACCT_LABELS[tx.accountType] ?? tx.accountType) : null
                  const acctStr = acctLabel
                    ? (tx.accountNumber ? `${acctLabel} · ${tx.accountNumber}` : acctLabel)
                    : null

                  return (
                    <tr key={tx.id} className="group border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-2 py-1.5">
                        <input type="checkbox" className="rounded border-input" checked={selectedIds.has(tx.id)} onChange={() => toggleRow(tx.id)} />
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground tabular-nums text-xs whitespace-nowrap">
                        {formatDate(tx.date)}
                      </td>
                      <td className="px-2 py-1.5 overflow-hidden">
                        <div className="truncate text-sm">{tx.description}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                        <span className={cn('font-medium text-sm', tx.direction === 'inflow' ? 'text-emerald-600' : 'text-rose-600')}>
                          {tx.direction === 'outflow' && '−'}{formatBRL(tx.amount)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground truncate">
                        {acctStr ?? '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={cn(
                          'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                          tx.direction === 'inflow' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
                        )}>
                          {tx.direction === 'inflow' ? 'Entrada' : 'Saída'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        {tx.documentReportType === 'balance_sheet' ? (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-sky-100 text-sky-700">BP</span>
                        ) : (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600">DRE</span>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        <CategoryCellCombobox value={tx.categoryId ?? null} categories={options.categories} onValueChange={v => handleClassify(tx.id, 'categoryId', v)} disabled={isClassifying} />
                      </td>
                      <td className="px-1 py-1">
                        <CellCombobox value={tx.costCenterId ?? null} options={options.costCenters} onValueChange={v => handleClassify(tx.id, 'costCenterId', v)} disabled={isClassifying} />
                      </td>
                      <td className="px-1 py-1">
                        <CellCombobox value={tx.businessUnitId ?? null} options={options.businessUnits} onValueChange={v => handleClassify(tx.id, 'businessUnitId', v)} disabled={isClassifying} />
                      </td>
                      <td className="px-1 py-1">
                        <CellCombobox value={tx.legalEntityId ?? null} options={options.legalEntities} onValueChange={v => handleClassify(tx.id, 'legalEntityId', v)} disabled={isClassifying} />
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button onClick={() => setDeleteTargetIds([tx.id])} className="h-7 w-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/5" title="Apagar lançamento">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Rodapé: totais selecionados + paginação ───────────────────────── */}
      {(selectedIds.size > 0 || data.pages > 1) && (
        <div className="shrink-0 flex items-center justify-between px-6 py-2 border-t gap-4">
          {/* Totais selecionados */}
          {selectedIds.size > 0 ? (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}</span>
              <span>Entradas <span className="font-medium text-emerald-600 tabular-nums">{formatBRL(selTotals.inflow)}</span></span>
              <span>Saídas <span className="font-medium text-rose-600 tabular-nums">{formatBRL(selTotals.outflow)}</span></span>
              <span>Líquido <span className={cn('font-medium tabular-nums', selTotals.net >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{selTotals.net >= 0 ? '' : '−'}{formatBRL(Math.abs(selTotals.net))}</span></span>
            </div>
          ) : <div />}
          {/* Paginação */}
          {data.pages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => updateFilters({ page: String(data.page - 1) })} disabled={data.page <= 1}>
                <ChevronLeft className="h-4 w-4 mr-1" />Anterior
              </Button>
              <span className="text-sm text-muted-foreground px-2">Página {data.page} de {data.pages}</span>
              <Button variant="outline" size="sm" onClick={() => updateFilters({ page: String(data.page + 1) })} disabled={data.page >= data.pages}>
                Próxima<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}
      <AlertDialog open={deleteTargetIds.length > 0} onOpenChange={open => { if (!open) setDeleteTargetIds([]) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar {deleteTargetIds.length === 1 ? 'lançamento' : `${deleteTargetIds.length} lançamentos`}?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeleting ? 'Apagando...' : 'Apagar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Classificar {selectedIds.size} transaç{selectedIds.size !== 1 ? 'ões' : 'ão'} em lote</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Selecione as dimensões que deseja aplicar. Campos em branco não serão alterados.</p>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Categoria</p>
              <BatchCombobox value={batchForm.categoryId} options={allCategoryOptions} placeholder="Não alterar" onValueChange={v => setBatchForm(prev => ({ ...prev, categoryId: v }))} grouped={groupedCategories} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Centro de custo</p>
              <BatchCombobox value={batchForm.costCenterId} options={options.costCenters.map(c => ({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name }))} placeholder="Não alterar" onValueChange={v => setBatchForm(prev => ({ ...prev, costCenterId: v }))} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Unidade de negócio</p>
              <BatchCombobox value={batchForm.businessUnitId} options={options.businessUnits.map(c => ({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name }))} placeholder="Não alterar" onValueChange={v => setBatchForm(prev => ({ ...prev, businessUnitId: v }))} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Entidade jurídica</p>
              <BatchCombobox value={batchForm.legalEntityId} options={options.legalEntities.map(c => ({ id: c.id, label: c.name }))} placeholder="Não alterar" onValueChange={v => setBatchForm(prev => ({ ...prev, legalEntityId: v }))} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
            <Button size="sm" onClick={handleBatchClassify} disabled={isBatching}>{isBatching ? 'Classificando...' : 'Classificar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
