'use client'

import { useState, useTransition, useCallback, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCheck, SkipForward, ArrowLeft, ChevronLeft, ChevronRight,
  Bot, Repeat2, Shuffle, ChevronsUpDown, Check, X, Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command'
import { EmptyState } from '@/components/states/empty-state'
import { cn } from '@/lib/utils'
import { confirmSuggestions, skipSuggestions } from '@/server/review'
import type { getReviewQueue, ReviewFilters } from '@/server/review'

type ReviewRow = Awaited<ReturnType<typeof getReviewQueue>>['rows'][number]
type Options = Awaited<ReturnType<typeof getReviewQueue>>['options']

interface Props {
  rows: ReviewRow[]
  options: Options
  total: number
  pages: number
  page: number
  filters: ReviewFilters
}

const CATEGORY_TYPE_LABELS: Record<string, string> = {
  receita_operacional:      'Receita Operacional',
  deducoes_tributarias:     'Deduções Tributárias',
  deducoes_operacionais:    'Deduções Operacionais',
  cpv:                      'CPV / CMV / CSP',
  sga:                      'SG&A',
  resultado_financeiro:     'Receitas & Despesas Financeiras',
  ir:                       'Impostos Sobre Renda',
  emprestimos_amortizacoes: 'Empréstimos & Amortizações',
  investimentos_retiradas:  'Investimentos & Retiradas',
  transfer:                 'Transitórios',
  ativo_circulante:         'Ativo Circulante',
  ativo_nao_circulante:     'Ativo Não-Circulante',
  passivo_circulante:       'Passivo Circulante',
  passivo_nao_circulante:   'Passivo Não-Circulante',
  patrimonio_liquido:       'Patrimônio Líquido',
}

const METHOD_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  rule:       { label: 'Regra',       icon: <Shuffle className="h-3 w-3" />,  color: 'bg-sky-100 text-sky-700' },
  recurrence: { label: 'Recorrência', icon: <Repeat2 className="h-3 w-3" />,  color: 'bg-violet-100 text-violet-700' },
  embedding:  { label: 'Embedding',   icon: <Bot className="h-3 w-3" />,      color: 'bg-amber-100 text-amber-700' },
  llm:        { label: 'Expert',      icon: <Bot className="h-3 w-3" />,      color: 'bg-emerald-100 text-emerald-700' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ConfidenceBadge({ value }: { value: string | null }) {
  if (!value) return null
  const pct = Math.round(Number(value) * 100)
  const color = pct >= 80 ? 'text-emerald-700' : pct >= 60 ? 'text-amber-600' : 'text-rose-600'
  return <span className={cn('tabular-nums text-xs font-medium', color)}>{pct}%</span>
}

function MethodBadge({ method }: { method: string | null }) {
  if (!method) return null
  const m = METHOD_LABELS[method]
  if (!m) return null
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium', m.color)}>
      {m.icon}{m.label}
    </span>
  )
}

function DimensionChip({ label }: { label: string | null }) {
  if (!label) return <span className="text-slate-300 text-xs">—</span>
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 truncate max-w-[140px]" title={label}>
      {label}
    </span>
  )
}

// ─── DateInput (estado local, URL só atualiza com ano ≥ 2000) ─────────────────

function DateInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [local, setLocal] = useState(value)
  const ref = useRef(local)
  ref.current = local

  useEffect(() => { setLocal(value) }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setLocal(v)
    const year = v.split('-')[0]
    if (!v || (year && year.length === 4 && Number(year) >= 2000)) {
      onChange(v)
    }
  }

  return (
    <input
      type="date"
      value={local}
      onChange={handleChange}
      placeholder={placeholder}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-[130px]"
    />
  )
}

// ─── MultiSelectFilter ────────────────────────────────────────────────────────

function MultiSelectFilter({
  label, value, options, onUpdate, className,
}: {
  label: string
  value: string | undefined
  options: { id: string; label: string }[]
  onUpdate: (v: string | undefined) => void
  className?: string
}) {
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
            'flex h-8 w-full items-center justify-between rounded-md border px-2 text-xs bg-background transition-colors pr-7',
            hasValue ? 'border-primary/50 bg-primary/5 text-foreground' : 'border-input text-muted-foreground',
            'hover:border-primary/60 focus:outline-none focus:ring-1 focus:ring-ring',
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
              <CommandItem value="__none__" onSelect={() => toggle('__none__')} className="text-muted-foreground">
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

// ─── CategoryMultiSelectFilter ────────────────────────────────────────────────

function CategoryMultiSelectFilter({
  value, categories, onUpdate,
}: {
  value: string | undefined
  categories: Options['categories']
  onUpdate: (v: string | undefined) => void
}) {
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
    }, {} as Record<string, Options['categories']>), [categories])

  return (
    <div className="relative flex-1 min-w-[140px]">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className={cn(
            'flex h-8 w-full items-center justify-between rounded-md border px-2 text-xs bg-background transition-colors pr-7',
            hasValue ? 'border-primary/50 bg-primary/5 text-foreground' : 'border-input text-muted-foreground',
            'hover:border-primary/60 focus:outline-none focus:ring-1 focus:ring-ring',
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
              <CommandItem value="__none__" onSelect={() => toggle('__none__')} className="text-muted-foreground">
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

// ─── PaginationBar ────────────────────────────────────────────────────────────

function PaginationBar({
  page, pages, isPending, onNavigate,
}: {
  page: number
  pages: number
  isPending: boolean
  onNavigate: (p: number) => void
}) {
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between text-sm text-slate-500">
      <span>Página {page} de {pages}</span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1 || isPending} onClick={() => onNavigate(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages || isPending} onClick={() => onNavigate(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RevisaoClient({ rows, options, total, pages, page, filters }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()

  // Filtros locais para debounce
  const [localQ, setLocalQ] = useState(filters.q ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const allIds = rows.map(r => r.id)
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id))
  const someSelected = selected.size > 0

  const hasFilters = !!(filters.q || filters.from || filters.to ||
    (filters.direction && filters.direction !== 'all') ||
    filters.category || filters.costCenter || filters.businessUnit || filters.legalEntity ||
    filters.contact)

  function buildUrl(overrides: Partial<ReviewFilters & { page: number }>) {
    const p = {
      q: filters.q,
      from: filters.from,
      to: filters.to,
      direction: filters.direction,
      category: filters.category,
      costCenter: filters.costCenter,
      businessUnit: filters.businessUnit,
      legalEntity: filters.legalEntity,
      contact: filters.contact,
      page: 1,
      ...overrides,
    }
    const params = new URLSearchParams()
    if (p.q) params.set('q', p.q)
    if (p.from) params.set('from', p.from)
    if (p.to) params.set('to', p.to)
    if (p.direction && p.direction !== 'all') params.set('direction', p.direction)
    if (p.category) params.set('category', p.category)
    if (p.costCenter) params.set('costCenter', p.costCenter)
    if (p.businessUnit) params.set('businessUnit', p.businessUnit)
    if (p.legalEntity) params.set('legalEntity', p.legalEntity)
    if (p.contact) params.set('contact', p.contact)
    if ((p.page ?? 1) > 1) params.set('page', String(p.page))
    const qs = params.toString()
    return `/transacoes/revisao${qs ? `?${qs}` : ''}`
  }

  function updateFilter(overrides: Partial<ReviewFilters>) {
    router.push(buildUrl({ ...overrides, page: 1 }))
  }

  function clearAll() {
    setLocalQ('')
    router.push('/transacoes/revisao')
  }

  function navigatePage(p: number) {
    router.push(buildUrl({ page: p }))
  }

  function handleQChange(value: string) {
    setLocalQ(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      updateFilter({ q: value || undefined })
    }, 400)
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(allIds))
  }

  function toggleRow(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function handleConfirm(ids: string[]) {
    startTransition(async () => {
      const result = await confirmSuggestions(ids)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success(`${result.confirmed} sugestão${result.confirmed !== 1 ? 'ões' : ''} confirmada${result.confirmed !== 1 ? 's' : ''}.`)
        setSelected(new Set())
        router.refresh()
      }
    })
  }

  function handleSkip(ids: string[]) {
    startTransition(async () => {
      const result = await skipSuggestions(ids)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success(`${result.skipped} sugestão${result.skipped !== 1 ? 'ões' : ''} descartada${result.skipped !== 1 ? 's' : ''}.`)
        setSelected(new Set())
        router.refresh()
      }
    })
  }

  const ccOptions = options.costCenters.map(c => ({ id: c.id, label: c.name }))
  const buOptions = options.businessUnits.map(b => ({ id: b.id, label: b.name }))
  const leOptions = options.legalEntities.map(l => ({ id: l.id, label: l.name }))
  const ctOptions = options.contacts.map(c => ({ id: c.id, label: c.name }))

  if (rows.length === 0 && page === 1 && !hasFilters) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.push('/transacoes')} className="text-slate-500">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar para Transações
          </Button>
        </div>
        <EmptyState
          title="Nenhuma sugestão aguardando revisão"
          description="O expert não tem classificações pendentes no momento. Importe transações para o motor iniciar a categorização automática."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/transacoes')} className="text-slate-500">
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar
        </Button>
        <span className="text-sm text-slate-500">{total} transação{total !== 1 ? 'ões' : ''} aguardando revisão</span>
      </div>

      {/* FilterBar — linha 1 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={localQ}
            onChange={e => handleQChange(e.target.value)}
            placeholder="Buscar por descrição..."
            className="h-8 pl-8 text-xs"
          />
          {localQ && (
            <button
              onClick={() => handleQChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">De</div>
        <DateInput
          value={filters.from ?? ''}
          onChange={v => updateFilter({ from: v || undefined })}
        />
        <div className="flex items-center gap-1 text-xs text-muted-foreground">Até</div>
        <DateInput
          value={filters.to ?? ''}
          onChange={v => updateFilter({ to: v || undefined })}
        />

        <div className="relative">
          <Select
            value={filters.direction ?? 'all'}
            onValueChange={v => updateFilter({ direction: v === 'all' ? undefined : v })}
          >
            <SelectTrigger className="h-8 text-xs w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="inflow">Entradas</SelectItem>
              <SelectItem value="outflow">Saídas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {hasFilters && (
          <button
            onClick={clearAll}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 whitespace-nowrap"
          >
            Limpar tudo
          </button>
        )}
      </div>

      {/* FilterBar — linha 2 */}
      <div className="flex flex-wrap items-center gap-2">
        <CategoryMultiSelectFilter
          value={filters.category}
          categories={options.categories}
          onUpdate={v => updateFilter({ category: v })}
        />
        <MultiSelectFilter
          label="Centro de custo"
          value={filters.costCenter}
          options={ccOptions}
          onUpdate={v => updateFilter({ costCenter: v })}
        />
        <MultiSelectFilter
          label="Un. de negócio"
          value={filters.businessUnit}
          options={buOptions}
          onUpdate={v => updateFilter({ businessUnit: v })}
        />
        <MultiSelectFilter
          label="Entidade jurídica"
          value={filters.legalEntity}
          options={leOptions}
          onUpdate={v => updateFilter({ legalEntity: v })}
        />
        <MultiSelectFilter
          label="Contato"
          value={filters.contact}
          options={ctOptions}
          onUpdate={v => updateFilter({ contact: v })}
        />
      </div>

      {/* Bulk toolbar */}
      {someSelected && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2">
          <span className="text-sm font-medium text-emerald-800">{selected.size} selecionada{selected.size !== 1 ? 's' : ''}</span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleSkip(Array.from(selected))}
            disabled={isPending}
            className="border-slate-300 text-slate-600 hover:bg-slate-50"
          >
            <SkipForward className="mr-1.5 h-3.5 w-3.5" />
            Descartar
          </Button>
          <Button
            size="sm"
            onClick={() => handleConfirm(Array.from(selected))}
            disabled={isPending}
            className="bg-emerald-700 hover:bg-emerald-800 text-white"
          >
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
            Confirmar selecionadas
          </Button>
        </div>
      )}

      <PaginationBar page={page} pages={pages} isPending={isPending} onNavigate={navigatePage} />

      {/* Table */}
      {rows.length === 0 ? (
        <EmptyState
          title="Nenhuma sugestão encontrada"
          description="Tente ajustar os filtros para encontrar transações aguardando revisão."
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wide">
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                </th>
                <th className="px-4 py-3 text-left">Data</th>
                <th className="px-4 py-3 text-left">Descrição</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-left">Categoria sugerida</th>
                <th className="px-4 py-3 text-left">Centro de custo</th>
                <th className="px-4 py-3 text-left">Contato</th>
                <th className="px-4 py-3 text-center">Confiança</th>
                <th className="px-4 py-3 text-center">Método</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(row => {
                const isSelected = selected.has(row.id)
                const [y, m, d] = row.date.split('-')
                const dateLabel = `${d}/${m}/${y.slice(2)}`
                const amountNum = Number(row.amount)
                const isInflow = row.direction === 'inflow'

                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'group transition-colors',
                      isSelected ? 'bg-emerald-50/60' : 'hover:bg-slate-50/60',
                    )}
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(row.id)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>

                    <td className="px-4 py-3 tabular-nums text-slate-500 whitespace-nowrap">
                      {dateLabel}
                    </td>

                    <td className="px-4 py-3 text-slate-800 max-w-[260px]">
                      <span className="truncate block" title={row.description}>
                        {row.description}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                      <span className={isInflow ? 'text-emerald-700 font-medium' : 'text-slate-700'}>
                        {isInflow ? '+' : ''}
                        {amountNum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <DimensionChip label={row.categoryName} />
                    </td>

                    <td className="px-4 py-3">
                      <DimensionChip label={row.costCenterName} />
                    </td>

                    <td className="px-4 py-3">
                      <DimensionChip label={row.contactName} />
                    </td>

                    <td className="px-4 py-3 text-center">
                      <ConfidenceBadge value={row.categorizationConfidence} />
                    </td>

                    <td className="px-4 py-3 text-center">
                      <MethodBadge method={row.categorizationMethod} />
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleSkip([row.id])}
                          disabled={isPending}
                          className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700"
                          title="Descartar sugestão"
                        >
                          <SkipForward className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleConfirm([row.id])}
                          disabled={isPending}
                          className="h-7 px-2 text-xs bg-emerald-700 hover:bg-emerald-800 text-white"
                          title="Confirmar sugestão"
                        >
                          <CheckCheck className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <PaginationBar page={page} pages={pages} isPending={isPending} onNavigate={navigatePage} />
    </div>
  )
}
