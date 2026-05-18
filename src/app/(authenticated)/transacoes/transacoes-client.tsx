'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, ChevronsUpDown, Check, Layers, Search, X,
  ArrowUp, ArrowDown, ArrowUpDown, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
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
import { classifyTransaction, batchClassifyTransactions, deleteTransactions } from '@/server/transactions'
import type { DocumentOption } from '@/server/documents'
import type { Transaction } from '@/db/schema/transactions'
import type { Category } from '@/db/schema/categories'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'

const SOURCE_TYPE_LABELS: Record<string, string> = {
  bank: 'Banco',
  credit_card: 'Fatura CC',
  erp: 'ERP',
  acquirer: 'Adquirente',
  sefaz: 'SEFAZ',
  other: 'Arquivo',
}

function getDocumentLabel(doc: DocumentOption): string {
  const typeLabel = SOURCE_TYPE_LABELS[doc.sourceType] ?? 'Arquivo'
  const name = doc.filename.replace(/\.[^.]+$/, '').slice(0, 28)
  return `${typeLabel} · ${name} (${doc.txCount})`
}

const CATEGORY_TYPE_LABELS: Record<string, string> = {
  // DRE
  receita_operacional:   'Receita Operacional',
  deducoes_tributarias:  'Deduções Tributárias',
  deducoes_operacionais: 'Deduções Operacionais',
  cpv:                   'CPV / CMV / CSP',
  sga:                   'SG&A',
  resultado_financeiro:  'Receitas & Despesas Financeiras',
  ir:                    'Impostos Sobre Renda',
  investimento:          'Investimentos & Amortizações',
  transfer:              'Transitórios',
  // BP
  ativo_circulante:      'Ativo Circulante',
  ativo_nao_circulante:  'Ativo Não-Circulante',
  passivo_circulante:    'Passivo Circulante',
  passivo_nao_circulante:'Passivo Não-Circulante',
  patrimonio_liquido:    'Patrimônio Líquido',
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
  sort?: string
}

interface DimensionOptions {
  categories: Category[]
  costCenters: CostCenter[]
  businessUnits: BusinessUnit[]
  legalEntities: LegalEntity[]
}

interface Props {
  data: { rows: Transaction[]; total: number; pages: number; page: number; totals: { inflow: string; outflow: string } }
  options: DimensionOptions
  documents: DocumentOption[]
  searchParams: SearchParams
}

type DimensionField = 'categoryId' | 'costCenterId' | 'businessUnitId' | 'legalEntityId'

function formatDate(iso: string): string {
  const p = iso.split('-')
  if (p.length !== 3) return iso
  const year = p[0].slice(2) // últimos 2 dígitos do ano
  return `${p[2]}/${p[1]}/${year}`
}

function formatBRL(amount: string | number): string {
  return Number(amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ─── Multi-Select Filter ──────────────────────────────────────────────────────

interface MultiSelectFilterProps {
  label: string
  value: string | undefined
  options: { id: string; label: string }[]
  onUpdate: (value: string | undefined) => void
  className?: string
}

function MultiSelectFilter({ label, value, options, onUpdate, className }: MultiSelectFilterProps) {
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
      if (id === '__none__') return 'Não classificado'
      return options.find(o => o.id === id)?.label ?? label
    }
    return `${selected.size} selecionados`
  }, [hasValue, selected, options, label])

  return (
    <div className={cn('relative flex-1 min-w-[130px]', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className={cn(
            'flex h-8 w-full items-center justify-between rounded-md border px-2 text-xs bg-background transition-colors',
            hasValue
              ? 'border-primary/50 bg-primary/5 text-foreground'
              : 'border-input text-muted-foreground',
            'hover:border-primary/60 focus:outline-none focus:ring-1 focus:ring-ring',
            'pr-7', // espaço para o X
          )}>
            <span className="truncate">{triggerLabel ?? label}</span>
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar..." />
            <CommandList>
              <CommandEmpty>Nenhum resultado.</CommandEmpty>
              <CommandItem
                value="__none__"
                onSelect={() => toggle('__none__')}
                className="text-muted-foreground"
              >
                <div className={cn(
                  'mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0',
                  selected.has('__none__') ? 'bg-primary border-primary' : 'border-muted-foreground/40',
                )}>
                  {selected.has('__none__') && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </div>
                Não classificado
              </CommandItem>
              <CommandSeparator />
              {options.map(opt => (
                <CommandItem key={opt.id} value={opt.label} onSelect={() => toggle(opt.id)}>
                  <div className={cn(
                    'mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0',
                    selected.has(opt.id) ? 'bg-primary border-primary' : 'border-muted-foreground/40',
                  )}>
                    {selected.has(opt.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </div>
                  <span className="truncate">{opt.label}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* X individual — sempre reservado, invisível quando sem valor */}
      <button
        onClick={() => onUpdate(undefined)}
        className={cn(
          'absolute right-1.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded flex items-center justify-center transition-opacity',
          'text-muted-foreground hover:text-foreground hover:bg-muted',
          hasValue ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        tabIndex={-1}
        aria-hidden={!hasValue}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

// ─── Category Multi-Select Filter (agrupado por tipo) ────────────────────────

interface CategoryMultiSelectFilterProps {
  value: string | undefined
  categories: Category[]
  onUpdate: (value: string | undefined) => void
}

function CategoryMultiSelectFilter({ value, categories, onUpdate }: CategoryMultiSelectFilterProps) {
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
      if (id === '__none__') return 'Não classificado'
      const cat = categories.find(c => c.id === id)
      return cat ? `${cat.code} – ${cat.name}` : 'Categoria'
    }
    return `${selected.size} categorias`
  }, [hasValue, selected, categories])

  const byType = useMemo(() => categories
    .filter(c => c.parentId !== null)
    .reduce((acc, c) => {
      if (!acc[c.type]) acc[c.type] = []
      acc[c.type].push(c)
      return acc
    }, {} as Record<string, Category[]>), [categories])

  return (
    <div className="relative flex-1 min-w-[140px]">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className={cn(
            'flex h-8 w-full items-center justify-between rounded-md border px-2 text-xs bg-background transition-colors',
            hasValue
              ? 'border-primary/50 bg-primary/5 text-foreground'
              : 'border-input text-muted-foreground',
            'hover:border-primary/60 focus:outline-none focus:ring-1 focus:ring-ring',
            'pr-7',
          )}>
            <span className="truncate">{triggerLabel ?? 'Categoria'}</span>
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar categoria..." />
            <CommandList>
              <CommandEmpty>Nenhuma categoria encontrada.</CommandEmpty>
              <CommandItem
                value="__none__"
                onSelect={() => toggle('__none__')}
                className="text-muted-foreground"
              >
                <div className={cn(
                  'mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0',
                  selected.has('__none__') ? 'bg-primary border-primary' : 'border-muted-foreground/40',
                )}>
                  {selected.has('__none__') && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </div>
                Não classificado
              </CommandItem>
              <CommandSeparator />
              {Object.entries(byType).map(([type, cats]) => (
                <CommandGroup key={type} heading={CATEGORY_TYPE_LABELS[type] ?? type}>
                  {cats.map(cat => {
                    const itemLabel = `${cat.code} – ${cat.name}`
                    return (
                      <CommandItem key={cat.id} value={itemLabel} onSelect={() => toggle(cat.id)}>
                        <div className={cn(
                          'mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0',
                          selected.has(cat.id) ? 'bg-primary border-primary' : 'border-muted-foreground/40',
                        )}>
                          {selected.has(cat.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                        </div>
                        <span className="truncate">{itemLabel}</span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <button
        onClick={() => onUpdate(undefined)}
        className={cn(
          'absolute right-1.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded flex items-center justify-center transition-opacity',
          'text-muted-foreground hover:text-foreground hover:bg-muted',
          hasValue ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        tabIndex={-1}
        aria-hidden={!hasValue}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

// ─── Cell Combobox (para classificação inline nas células) ───────────────────

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
        <button
          disabled={disabled}
          className={cn(
            'flex h-8 w-full items-center justify-between rounded-md px-2 text-xs transition-colors',
            'border border-transparent bg-transparent',
            'hover:border-input hover:bg-background',
            'focus:outline-none focus:border-input focus:bg-background',
            'disabled:opacity-50 disabled:pointer-events-none',
            open && 'border-input bg-background',
          )}
        >
          <span className={cn('truncate', !label && 'text-muted-foreground')}>{label ?? placeholder}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start" side="bottom">
        <Command>
          <CommandInput placeholder="Buscar..." />
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
            <CommandItem
              value="__clear__"
              onSelect={() => { onValueChange(null); setOpen(false) }}
              className="text-muted-foreground"
            >
              <Check className={cn('mr-2 h-3 w-3', value === null ? 'opacity-100' : 'opacity-0')} />
              —
            </CommandItem>
            <CommandSeparator />
            {options.map(opt => {
              const itemLabel = opt.code ? `${opt.code} – ${opt.name}` : opt.name
              return (
                <CommandItem
                  key={opt.id}
                  value={itemLabel}
                  onSelect={() => { onValueChange(opt.id); setOpen(false) }}
                >
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

  const byType = categories
    .filter(c => c.parentId !== null)
    .reduce((acc, c) => {
      if (!acc[c.type]) acc[c.type] = []
      acc[c.type].push(c)
      return acc
    }, {} as Record<string, Category[]>)

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className={cn(
            'flex h-8 w-full items-center justify-between rounded-md px-2 text-xs transition-colors',
            'border border-transparent bg-transparent',
            'hover:border-input hover:bg-background',
            'focus:outline-none focus:border-input focus:bg-background',
            'disabled:opacity-50 disabled:pointer-events-none',
            open && 'border-input bg-background',
          )}
        >
          <span className={cn('truncate', !label && 'text-muted-foreground')}>{label ?? '—'}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" side="bottom">
        <Command>
          <CommandInput placeholder="Buscar categoria..." />
          <CommandList>
            <CommandEmpty>Nenhuma categoria encontrada.</CommandEmpty>
            <CommandItem
              value="__clear__"
              onSelect={() => { onValueChange(null); setOpen(false) }}
              className="text-muted-foreground"
            >
              <Check className={cn('mr-2 h-3 w-3', value === null ? 'opacity-100' : 'opacity-0')} />
              —
            </CommandItem>
            <CommandSeparator />
            {Object.entries(byType).map(([type, cats]) => (
              <CommandGroup key={type} heading={CATEGORY_TYPE_LABELS[type] ?? type}>
                {cats.map(cat => {
                  const itemLabel = `${cat.code} – ${cat.name}`
                  return (
                    <CommandItem
                      key={cat.id}
                      value={itemLabel}
                      onSelect={() => { onValueChange(cat.id); setOpen(false) }}
                    >
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

// ─── Date Input (com estado local para evitar reset do segmento de ano) ──────

interface DateInputProps {
  label: string
  value: string | undefined
  onChange: (v: string | undefined) => void
}

function DateInput({ label, value, onChange }: DateInputProps) {
  const [local, setLocal] = useState(value ?? '')

  // Sincroniza quando o valor externo muda (ex: botão "Limpar tudo")
  useEffect(() => { setLocal(value ?? '') }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setLocal(val)
    if (!val) { onChange(undefined); return }
    // Só atualiza a URL quando o ano é plausível (≥ 2000),
    // evitando re-renders que resetam o campo enquanto o usuário digita o ano.
    const year = parseInt(val.slice(0, 4), 10)
    if (!isNaN(year) && year >= 2000) onChange(val)
  }

  function handleClear() {
    setLocal('')
    onChange(undefined)
  }

  return (
    <div className="flex items-center h-8 rounded-md border border-input text-xs bg-background">
      <span className="px-2 text-muted-foreground border-r border-input bg-muted/30 h-full flex items-center rounded-l-md select-none">
        {label}
      </span>
      <input
        type="date"
        value={local}
        onChange={handleChange}
        className="h-full px-2 text-xs bg-transparent outline-none w-32"
      />
      <button
        onClick={handleClear}
        tabIndex={-1}
        className={cn(
          'px-1.5 h-full flex items-center rounded-r-md transition-opacity',
          'text-muted-foreground hover:text-foreground hover:bg-muted',
          local ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  searchParams: SearchParams
  options: DimensionOptions
  documents: DocumentOption[]
  onUpdate: (updates: Record<string, string | undefined>) => void
  onClear: () => void
  hasFilters: boolean
}

function FilterBar({ searchParams, options, documents, onUpdate, onClear, hasFilters }: FilterBarProps) {
  const [searchInput, setSearchInput] = useState(searchParams.q ?? '')

  useEffect(() => { setSearchInput(searchParams.q ?? '') }, [searchParams.q])

  useEffect(() => {
    const timer = setTimeout(() => {
      const current = searchParams.q ?? ''
      if (searchInput.trim() !== current) {
        onUpdate({ q: searchInput.trim() || undefined, page: undefined })
      }
    }, 400)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const ccOptions = options.costCenters.map(c => ({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name }))
  const buOptions = options.businessUnits.map(c => ({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name }))
  const leOptions = options.legalEntities.map(c => ({ id: c.id, label: c.name }))
  const docOptions = documents.map(d => ({ id: d.id, label: getDocumentLabel(d) }))

  return (
    <div className="space-y-2">
      {/* Linha 0: filtro por importação (origem) — exibido só se há documentos */}
      {documents.length > 0 && (
        <MultiSelectFilter
          label="Filtrar por importação..."
          value={searchParams.documentId}
          options={docOptions}
          onUpdate={(v) => onUpdate({ documentId: v, page: undefined })}
        />
      )}

      {/* Linha 1: busca + datas + direção */}
      <div className="flex gap-2 flex-wrap items-center">
        {/* Campo de busca com X */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por descrição..."
            className="pl-8 pr-7 h-8 text-sm"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); onUpdate({ q: undefined, page: undefined }) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>

        <DateInput
          label="De"
          value={searchParams.from}
          onChange={(v) => onUpdate({ from: v, page: undefined })}
        />
        <DateInput
          label="Até"
          value={searchParams.to}
          onChange={(v) => onUpdate({ to: v, page: undefined })}
        />

        {/* Direção com X */}
        <div className="relative">
          <Select
            value={searchParams.direction ?? '__all__'}
            onValueChange={(v) => onUpdate({ direction: v === '__all__' ? undefined : v, page: undefined })}
          >
            <SelectTrigger className={cn(
              'h-8 text-xs w-28',
              searchParams.direction && 'border-primary/50 bg-primary/5 pr-7',
            )}>
              <SelectValue placeholder="Direção" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__" className="text-xs">Todas</SelectItem>
              <SelectItem value="inflow" className="text-xs">Entradas</SelectItem>
              <SelectItem value="outflow" className="text-xs">Saídas</SelectItem>
            </SelectContent>
          </Select>
          {searchParams.direction && (
            <button
              onClick={() => onUpdate({ direction: undefined, page: undefined })}
              className="absolute right-7 top-1/2 -translate-y-1/2 h-4 w-4 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted z-10"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </div>

      {/* Linha 2: dimensões (multi-select pesquisável) + limpar tudo */}
      <div className="flex gap-2 flex-wrap items-center">
        <CategoryMultiSelectFilter
          value={searchParams.category}
          categories={options.categories}
          onUpdate={(v) => onUpdate({ category: v, page: undefined })}
        />
        <MultiSelectFilter
          label="Centro de custo"
          value={searchParams.costCenter}
          options={ccOptions}
          onUpdate={(v) => onUpdate({ costCenter: v, page: undefined })}
        />
        <MultiSelectFilter
          label="Un. de negócio"
          value={searchParams.businessUnit}
          options={buOptions}
          onUpdate={(v) => onUpdate({ businessUnit: v, page: undefined })}
        />
        <MultiSelectFilter
          label="Entidade jurídica"
          value={searchParams.legalEntity}
          options={leOptions}
          onUpdate={(v) => onUpdate({ legalEntity: v, page: undefined })}
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={onClear} className="h-8 text-xs gap-1.5 shrink-0">
            <X className="h-3.5 w-3.5" />
            Limpar tudo
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Totalizador ──────────────────────────────────────────────────────────────

function Totalizador({ totals, total }: { totals: { inflow: string; outflow: string }; total: number }) {
  const inflow = Number(totals.inflow)
  const outflow = Number(totals.outflow)
  const net = inflow - outflow

  return (
    <div className="flex items-center gap-6 px-4 py-2.5 rounded-lg border bg-muted/30 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Entradas</span>
        <span className="font-medium text-emerald-600 tabular-nums">{formatBRL(inflow)}</span>
      </div>
      <div className="h-4 w-px bg-border" />
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Saídas</span>
        <span className="font-medium text-rose-600 tabular-nums">{formatBRL(outflow)}</span>
      </div>
      <div className="h-4 w-px bg-border" />
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Líquido</span>
        <span className={cn('font-medium tabular-nums', net >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
          {net >= 0 ? '' : '−'}{formatBRL(Math.abs(net))}
        </span>
      </div>
      <span className="ml-auto text-xs text-muted-foreground">{total} lançamento{total !== 1 ? 's' : ''}</span>
    </div>
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
  const selected = options.find(o => o.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex h-8 w-full items-center justify-between rounded-md border border-input px-3 text-xs bg-background',
          'hover:bg-accent transition-colors focus:outline-none focus:ring-1 focus:ring-ring',
        )}>
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar..." />
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
            {grouped ? (
              grouped.map(group => (
                <CommandGroup key={group.type} heading={CATEGORY_TYPE_LABELS[group.type] ?? group.type}>
                  {group.items.map(item => (
                    <CommandItem
                      key={item.id}
                      value={item.label}
                      onSelect={() => { onValueChange(item.id); setOpen(false) }}
                    >
                      <Check className={cn('mr-2 h-3 w-3', value === item.id ? 'opacity-100' : 'opacity-0')} />
                      {item.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))
            ) : (
              options.map(item => (
                <CommandItem
                  key={item.id}
                  value={item.label}
                  onSelect={() => { onValueChange(item.id); setOpen(false) }}
                >
                  <Check className={cn('mr-2 h-3 w-3', value === item.id ? 'opacity-100' : 'opacity-0')} />
                  {item.label}
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Sort Header ─────────────────────────────────────────────────────────────

function SortHeader({
  label, sortKey, currentSort, onClick, className,
}: {
  label: string
  sortKey: string
  currentSort: string | undefined
  onClick: () => void
  className?: string
}) {
  const isAsc = currentSort === `${sortKey}_asc`
  const isDesc = currentSort === `${sortKey}_desc` || (!currentSort && sortKey === 'date')

  return (
    <button
      onClick={onClick}
      className={cn('flex items-center gap-1 group text-xs font-medium text-muted-foreground hover:text-foreground transition-colors', className)}
    >
      {label}
      {isAsc ? (
        <ArrowUp className="h-3 w-3 text-primary" />
      ) : isDesc ? (
        <ArrowDown className="h-3 w-3 text-primary" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity" />
      )}
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TransacoesClient({ data, options, documents, searchParams }: Props) {
  const router = useRouter()
  const [localRows, setLocalRows] = useState<Transaction[]>(data.rows)
  const serverRowsRef = useRef(data.rows)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [classifyingId, setClassifyingId] = useState<string | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchForm, setBatchForm] = useState({ categoryId: '', costCenterId: '', businessUnitId: '', legalEntityId: '' })
  const [isBatching, setIsBatching] = useState(false)
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([])
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    serverRowsRef.current = data.rows
    setLocalRows(data.rows)
    setSelectedIds(new Set())
  }, [data.rows])

  const hasFilters = !!(searchParams.q || searchParams.from || searchParams.to ||
    searchParams.direction || searchParams.category || searchParams.costCenter ||
    searchParams.businessUnit || searchParams.legalEntity || searchParams.documentId)

  function updateFilters(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    const current: Record<string, string> = {
      ...(searchParams.q && { q: searchParams.q }),
      ...(searchParams.from && { from: searchParams.from }),
      ...(searchParams.to && { to: searchParams.to }),
      ...(searchParams.direction && { direction: searchParams.direction }),
      ...(searchParams.category && { category: searchParams.category }),
      ...(searchParams.costCenter && { costCenter: searchParams.costCenter }),
      ...(searchParams.businessUnit && { businessUnit: searchParams.businessUnit }),
      ...(searchParams.legalEntity && { legalEntity: searchParams.legalEntity }),
      ...(searchParams.documentId && { documentId: searchParams.documentId }),
      ...(searchParams.page && { page: searchParams.page }),
      ...(searchParams.sort && { sort: searchParams.sort }),
    }
    Object.assign(current, Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined) as [string, string][],
    ))
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) delete current[k]
    }
    for (const [k, v] of Object.entries(current)) {
      if (v) params.set(k, v)
    }
    router.push(`/transacoes?${params.toString()}`)
  }

  function toggleSort(key: 'date' | 'amount') {
    const ascKey = `${key}_asc`
    const descKey = `${key}_desc`
    const current = searchParams.sort
    // date: default = desc. Ciclo: desc → asc → desc (sem "remover" para date, pois é default)
    if (key === 'date') {
      if (!current || current === descKey) {
        updateFilters({ sort: ascKey, page: undefined })
      } else {
        updateFilters({ sort: descKey, page: undefined })
      }
    } else {
      // amount: Ciclo: sem sort → desc → asc → sem sort
      if (!current || (!current.startsWith('amount'))) {
        updateFilters({ sort: descKey, page: undefined })
      } else if (current === descKey) {
        updateFilters({ sort: ascKey, page: undefined })
      } else {
        updateFilters({ sort: undefined, page: undefined })
      }
    }
  }

  async function handleClassify(id: string, field: DimensionField, value: string | null) {
    setClassifyingId(id)
    setLocalRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))

    const result = await classifyTransaction(id, { [field]: value })
    setClassifyingId(null)

    if (result?.error) {
      toast.error(result.error)
      setLocalRows(serverRowsRef.current)
    } else {
      toast.success('Classificação salva.')
      router.refresh()
    }
  }

  async function handleBatchClassify() {
    const payload = {
      categoryId: batchForm.categoryId || undefined,
      costCenterId: batchForm.costCenterId || undefined,
      businessUnitId: batchForm.businessUnitId || undefined,
      legalEntityId: batchForm.legalEntityId || undefined,
    }
    if (Object.values(payload).every(v => v === undefined)) {
      toast.error('Selecione ao menos uma dimensão.')
      return
    }
    setIsBatching(true)
    const result = await batchClassifyTransactions(Array.from(selectedIds), payload)
    setIsBatching(false)

    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success(`${result.updated} transação(ões) classificada(s).`)
      setBatchOpen(false)
      setSelectedIds(new Set())
      setBatchForm({ categoryId: '', costCenterId: '', businessUnitId: '', legalEntityId: '' })
      router.refresh()
    }
  }

  async function handleConfirmDelete() {
    if (deleteTargetIds.length === 0) return
    setIsDeleting(true)
    const result = await deleteTransactions(deleteTargetIds)
    setIsDeleting(false)
    setDeleteTargetIds([])

    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success(`${result.deleted} lançamento${result.deleted !== 1 ? 's' : ''} apagado${result.deleted !== 1 ? 's' : ''}.`)
      setSelectedIds(new Set())
      router.refresh()
    }
  }

  const allSelected = localRows.length > 0 && selectedIds.size === localRows.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < localRows.length

  function toggleAll() {
    setSelectedIds(allSelected || someSelected ? new Set() : new Set(localRows.map(r => r.id)))
  }

  function toggleRow(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const categoriesByType = options.categories.reduce((acc, c) => {
    if (!acc[c.type]) acc[c.type] = []
    acc[c.type].push({ id: c.id, label: `${c.code} – ${c.name}` })
    return acc
  }, {} as Record<string, { id: string; label: string }[]>)

  const groupedCategories = Object.entries(categoriesByType).map(([type, items]) => ({ type, items }))
  const allCategoryOptions = options.categories.map(c => ({ id: c.id, label: `${c.code} – ${c.name}` }))

  return (
    <div className="space-y-4">
      <FilterBar
        searchParams={searchParams}
        options={options}
        documents={documents}
        onUpdate={updateFilters}
        onClear={() => router.push('/transacoes')}
        hasFilters={hasFilters}
      />

      <Totalizador totals={data.totals} total={data.total} />

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5">
          <span className="text-sm font-medium">
            {selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <Button size="sm" onClick={() => setBatchOpen(true)}>
            Classificar em lote
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/5"
            onClick={() => setDeleteTargetIds(Array.from(selectedIds))}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Apagar selecionados
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
            Cancelar
          </Button>
        </div>
      )}

      {localRows.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Nenhuma transação encontrada"
          description="Ajuste os filtros para ver outros resultados."
        />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm table-fixed min-w-[900px]">
            <colgroup>
              <col className="w-10" />
              <col className="w-[80px]" />
              <col />
              <col className="w-28" />
              <col className="w-44" />
              <col className="w-36" />
              <col className="w-36" />
              <col className="w-36" />
              <col className="w-10" />
            </colgroup>
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    className="rounded border-input"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected }}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-3 py-2 text-left">
                  <SortHeader
                    label="Dt Lançamento"
                    sortKey="date"
                    currentSort={searchParams.sort}
                    onClick={() => toggleSort('date')}
                  />
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Descrição</th>
                <th className="px-3 py-2 text-right">
                  <SortHeader
                    label="Valor"
                    sortKey="amount"
                    currentSort={searchParams.sort}
                    onClick={() => toggleSort('amount')}
                    className="justify-end"
                  />
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Categoria</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">C. custo</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Un. negócio</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Entidade</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {localRows.map(tx => {
                const isClassifying = classifyingId === tx.id
                return (
                  <tr key={tx.id} className="group border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        className="rounded border-input"
                        checked={selectedIds.has(tx.id)}
                        onChange={() => toggleRow(tx.id)}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground tabular-nums text-xs whitespace-nowrap">
                      {formatDate(tx.date)}
                    </td>
                    <td className="px-3 py-1.5 overflow-hidden">
                      <div className="truncate text-sm">{tx.description}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                      <span className={cn(
                        'font-medium text-sm',
                        tx.direction === 'inflow' ? 'text-emerald-600' : 'text-rose-600',
                      )}>
                        {tx.direction === 'outflow' && '−'}{formatBRL(tx.amount)}
                      </span>
                    </td>
                    <td className="px-1.5 py-1">
                      <CategoryCellCombobox
                        value={tx.categoryId ?? null}
                        categories={options.categories}
                        onValueChange={(v) => handleClassify(tx.id, 'categoryId', v)}
                        disabled={isClassifying}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <CellCombobox
                        value={tx.costCenterId ?? null}
                        options={options.costCenters}
                        onValueChange={(v) => handleClassify(tx.id, 'costCenterId', v)}
                        disabled={isClassifying}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <CellCombobox
                        value={tx.businessUnitId ?? null}
                        options={options.businessUnits}
                        onValueChange={(v) => handleClassify(tx.id, 'businessUnitId', v)}
                        disabled={isClassifying}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <CellCombobox
                        value={tx.legalEntityId ?? null}
                        options={options.legalEntities}
                        onValueChange={(v) => handleClassify(tx.id, 'legalEntityId', v)}
                        disabled={isClassifying}
                      />
                    </td>
                    <td className="px-1.5 py-1 text-center">
                      <button
                        onClick={() => setDeleteTargetIds([tx.id])}
                        className="h-7 w-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                        title="Apagar lançamento"
                      >
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

      {data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {data.page} de {data.pages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateFilters({ page: String(data.page - 1) })}
              disabled={data.page <= 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateFilters({ page: String(data.page + 1) })}
              disabled={data.page >= data.pages}
            >
              Próxima
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={deleteTargetIds.length > 0} onOpenChange={(open) => { if (!open) setDeleteTargetIds([]) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Apagar {deleteTargetIds.length === 1 ? 'lançamento' : `${deleteTargetIds.length} lançamentos`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O{deleteTargetIds.length !== 1 ? 's' : ''} lançamento{deleteTargetIds.length !== 1 ? 's' : ''} será{deleteTargetIds.length !== 1 ? 'ão' : ''} removido{deleteTargetIds.length !== 1 ? 's' : ''} permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Apagando...' : 'Apagar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Classificar {selectedIds.size} transação{selectedIds.size !== 1 ? 'ões' : ''} em lote</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Selecione as dimensões que deseja aplicar. Campos em branco não serão alterados.
          </p>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Categoria</p>
              <BatchCombobox
                value={batchForm.categoryId}
                options={allCategoryOptions}
                placeholder="Não alterar"
                onValueChange={(v) => setBatchForm(prev => ({ ...prev, categoryId: v }))}
                grouped={groupedCategories}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Centro de custo</p>
              <BatchCombobox
                value={batchForm.costCenterId}
                options={options.costCenters.map(c => ({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name }))}
                placeholder="Não alterar"
                onValueChange={(v) => setBatchForm(prev => ({ ...prev, costCenterId: v }))}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Unidade de negócio</p>
              <BatchCombobox
                value={batchForm.businessUnitId}
                options={options.businessUnits.map(c => ({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name }))}
                placeholder="Não alterar"
                onValueChange={(v) => setBatchForm(prev => ({ ...prev, businessUnitId: v }))}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Entidade jurídica</p>
              <BatchCombobox
                value={batchForm.legalEntityId}
                options={options.legalEntities.map(c => ({ id: c.id, label: c.name }))}
                placeholder="Não alterar"
                onValueChange={(v) => setBatchForm(prev => ({ ...prev, legalEntityId: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancelar</Button>
            </DialogClose>
            <Button size="sm" onClick={handleBatchClassify} disabled={isBatching}>
              {isBatching ? 'Classificando...' : 'Classificar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
