'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import { listInvoices, type InvoiceRow, type InvoiceStats, type InvoiceFilters } from '@/server/invoices'
import { ColHeader } from '@/components/transacoes-shared/col-header'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Check, ChevronsUpDown, ExternalLink } from 'lucide-react'

// ─────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────

const PAGE_SIZE = 100
const STORAGE_KEY = 'lure:nfe:filters'

const STATUS_OPTIONS = [
  { id: 'nova', label: 'Nova' },
  { id: 'manifestada', label: 'Manifestada' },
  { id: 'pendente_revisao', label: 'Pendente revisão' },
  { id: 'casada', label: 'Casada' },
  { id: 'cancelada', label: 'Cancelada' },
  { id: 'denegada', label: 'Denegada' },
]

const STATUS_STYLE: Record<string, string> = {
  nova: 'bg-slate-500/15 text-slate-400',
  manifestada: 'bg-sky-500/15 text-sky-400',
  pendente_revisao: 'bg-amber-500/15 text-amber-500',
  casada: 'bg-emerald-500/15 text-emerald-500',
  cancelada: 'bg-rose-500/15 text-rose-400',
  denegada: 'bg-rose-500/15 text-rose-400',
}

const STATUS_LABEL: Record<string, string> = {
  nova: 'Nova',
  manifestada: 'Manifestada',
  pendente_revisao: 'Revisão',
  casada: 'Casada',
  cancelada: 'Cancelada',
  denegada: 'Denegada',
}

function fmt(value: string | null | undefined) {
  if (!value) return '—'
  const n = Number(value)
  if (isNaN(n)) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

function fmtDate(date: string | null | undefined) {
  if (!date) return '—'
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y?.slice(2)}`
}

// ─────────────────────────────────────────
// Filtro enum simples (Tipo)
// ─────────────────────────────────────────

function TipoFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const options = [
    { id: '', label: 'Todos' },
    { id: 'saida', label: 'Saída' },
    { id: 'entrada', label: 'Entrada' },
  ]
  const label = options.find(o => o.id === value)?.label ?? 'Tipo'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex h-full w-full items-center gap-1 px-1 text-xs font-medium truncate focus:outline-none',
          value ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}>
          <span className="truncate flex-1 text-left">{label}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-36 p-0" align="start">
        <Command>
          <CommandList>
            {options.map(o => (
              <CommandItem key={o.id} value={o.id} onSelect={() => { onChange(o.id); setOpen(false) }} className="text-xs">
                <Check className={cn('mr-2 h-3 w-3', value === o.id ? 'opacity-100' : 'opacity-0')} />
                {o.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─────────────────────────────────────────
// Multi-select genérico (Status, Entidade)
// ─────────────────────────────────────────

function MultiFilter({
  placeholder,
  options,
  selected,
  onToggle,
}: {
  placeholder: string
  options: { id: string; label: string }[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const hasValue = selected.size > 0
  const label = hasValue
    ? selected.size === 1
      ? options.find(o => selected.has(o.id))?.label ?? placeholder
      : `${selected.size} selecionados`
    : null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex h-full w-full items-center gap-1 px-1 text-xs font-medium truncate focus:outline-none',
          hasValue ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}>
          <span className="truncate flex-1 text-left">{label ?? placeholder}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar..." />
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
            <CommandGroup>
              {options.map(o => (
                <CommandItem key={o.id} value={o.label} onSelect={() => onToggle(o.id)} className="text-xs">
                  <div className={cn(
                    'mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0',
                    selected.has(o.id) ? 'bg-primary border-primary' : 'border-muted-foreground/40',
                  )}>
                    {selected.has(o.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </div>
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─────────────────────────────────────────
// Filtro de valor min/max
// ─────────────────────────────────────────

function AmountFilter({
  min, max, onMin, onMax,
}: { min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const hasValue = !!(min || max)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex h-full w-full items-center gap-1 px-1 text-xs font-medium truncate focus:outline-none',
          hasValue ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}>
          <span className="truncate flex-1 text-left">
            {hasValue ? `${min || '0'} – ${max || '∞'}` : 'Valor'}
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-3" align="start">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground">Mínimo</label>
            <input
              type="number"
              value={min}
              onChange={e => onMin(e.target.value)}
              placeholder="0"
              className="h-7 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground">Máximo</label>
            <input
              type="number"
              value={max}
              onChange={e => onMax(e.target.value)}
              placeholder="Sem limite"
              className="h-7 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─────────────────────────────────────────
// Card de resumo
// ─────────────────────────────────────────

function SummaryCard({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-card px-4 py-3', className)}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

// ─────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────

interface NfeClientProps {
  initialRows: InvoiceRow[]
  initialTotal: number
  initialTotalPages: number
  stats: InvoiceStats
  legalEntities: { id: string; name: string }[]
}

type FilterState = {
  tipo: string
  statusSet: Set<string>
  legalEntityId: string
  dateFrom: string
  dateTo: string
  amountMin: string
  amountMax: string
  page: number
}

const DEFAULT_FILTERS: FilterState = {
  tipo: '',
  statusSet: new Set(),
  legalEntityId: '',
  dateFrom: '',
  dateTo: '',
  amountMin: '',
  amountMax: '',
  page: 1,
}

export function NfeClient({ initialRows, initialTotal, initialTotalPages, stats, legalEntities }: NfeClientProps) {
  const [rows, setRows] = useState<InvoiceRow[]>(initialRows)
  const [total, setTotal] = useState(initialTotal)
  const [totalPages, setTotalPages] = useState(initialTotalPages)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [isPending, startTransition] = useTransition()

  // Restaura filtros do localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return
      const s = JSON.parse(saved)
      setFilters(prev => ({
        ...prev,
        tipo: s.tipo ?? '',
        statusSet: new Set(s.status ?? []),
        legalEntityId: s.legalEntityId ?? '',
        dateFrom: s.dateFrom ?? '',
        dateTo: s.dateTo ?? '',
        amountMin: s.amountMin ?? '',
        amountMax: s.amountMax ?? '',
      }))
    } catch { /* ignore */ }
  }, [])

  const fetchData = useCallback((f: FilterState) => {
    const payload: InvoiceFilters = {
      tipo: f.tipo as 'saida' | 'entrada' | undefined || undefined,
      status: f.statusSet.size > 0 ? Array.from(f.statusSet) : undefined,
      legalEntityId: f.legalEntityId || undefined,
      dateFrom: f.dateFrom || undefined,
      dateTo: f.dateTo || undefined,
      amountMin: f.amountMin || undefined,
      amountMax: f.amountMax || undefined,
      page: f.page,
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tipo: f.tipo,
      status: Array.from(f.statusSet),
      legalEntityId: f.legalEntityId,
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
      amountMin: f.amountMin,
      amountMax: f.amountMax,
    }))

    startTransition(async () => {
      const res = await listInvoices(payload)
      setRows(res.rows)
      setTotal(res.total)
      setTotalPages(res.totalPages)
    })
  }, [])

  function update(changes: Partial<FilterState>) {
    const next = { ...filters, ...changes, page: changes.page ?? 1 }
    setFilters(next)
    fetchData(next)
  }

  function toggleStatus(id: string) {
    const next = new Set(filters.statusSet)
    if (next.has(id)) next.delete(id); else next.add(id)
    update({ statusSet: next })
  }

  function toggleLE(id: string) {
    update({ legalEntityId: filters.legalEntityId === id ? '' : id })
  }

  function clearAll() {
    localStorage.removeItem(STORAGE_KEY)
    setFilters(DEFAULT_FILTERS)
    startTransition(async () => {
      const res = await listInvoices()
      setRows(res.rows)
      setTotal(res.total)
      setTotalPages(res.totalPages)
    })
  }

  const hasAnyFilter = !!(
    filters.tipo ||
    filters.statusSet.size > 0 ||
    filters.legalEntityId ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.amountMin ||
    filters.amountMax
  )

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Zona 1 — Cabeçalho */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h1 className="text-lg font-semibold">NF-e</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total.toLocaleString('pt-BR')} nota{total !== 1 ? 's' : ''} encontrada{total !== 1 ? 's' : ''}
          </p>
        </div>
        {hasAnyFilter && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="text-xs text-muted-foreground">
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Zona 2 — Cards de resumo + filtros de data */}
      <div className="shrink-0 px-6 py-3 border-b border-border space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard
            label="A receber"
            value={<span className="text-emerald-500">{fmt(stats.totalAReceber)}</span>}
          />
          <SummaryCard
            label="A pagar"
            value={<span className="text-rose-500">{fmt(stats.totalAPagar)}</span>}
          />
          <SummaryCard
            label="Pendentes revisão"
            value={<span className="text-amber-500">{stats.countPendenteRevisao}</span>}
          />
          <SummaryCard
            label="Sem correspondência"
            value={<span className="text-muted-foreground">{stats.countNova}</span>}
          />
        </div>

        {/* Filtros de data */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground shrink-0">Emissão:</span>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={e => update({ dateFrom: e.target.value })}
            className="h-7 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-muted-foreground">até</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={e => update({ dateTo: e.target.value })}
            className="h-7 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {(filters.dateFrom || filters.dateTo) && (
            <button
              onClick={() => update({ dateFrom: '', dateTo: '' })}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Zona 4 — Tabela */}
      <div className={cn('flex-1 min-h-0 overflow-hidden px-6 py-3', isPending && 'opacity-60 transition-opacity')}>
        <div className="h-full overflow-auto border rounded-lg">
          <table className="w-full text-xs [&_td]:border-r [&_th]:border-r [&_td]:border-border/20 [&_th]:border-border/20 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted border-b">
                <th className="w-24 px-2 py-0 font-normal text-left whitespace-nowrap">
                  <ColHeader hasValue={false} onClear={() => {}}>
                    <span className="text-xs text-muted-foreground">Emissão</span>
                  </ColHeader>
                </th>
                <th className="w-28 px-2 py-0 font-normal text-left">
                  <ColHeader hasValue={!!filters.tipo} onClear={() => update({ tipo: '' })}>
                    <TipoFilter value={filters.tipo} onChange={v => update({ tipo: v })} />
                  </ColHeader>
                </th>
                <th className="w-20 px-2 py-0 font-normal text-left">
                  <ColHeader hasValue={false} onClear={() => {}}>
                    <span className="text-xs text-muted-foreground">Número</span>
                  </ColHeader>
                </th>
                <th className="px-2 py-0 font-normal text-left min-w-[160px]">
                  <ColHeader hasValue={false} onClear={() => {}}>
                    <span className="text-xs text-muted-foreground">Contraparte</span>
                  </ColHeader>
                </th>
                <th className="w-36 px-2 py-0 font-normal text-left">
                  <ColHeader hasValue={!!filters.legalEntityId} onClear={() => update({ legalEntityId: '' })}>
                    <MultiFilter
                      placeholder="Entidade"
                      options={legalEntities.map(le => ({ id: le.id, label: le.name }))}
                      selected={filters.legalEntityId ? new Set([filters.legalEntityId]) : new Set()}
                      onToggle={toggleLE}
                    />
                  </ColHeader>
                </th>
                <th className="w-32 px-2 py-0 font-normal text-right">
                  <ColHeader hasValue={!!(filters.amountMin || filters.amountMax)} onClear={() => update({ amountMin: '', amountMax: '' })}>
                    <AmountFilter
                      min={filters.amountMin}
                      max={filters.amountMax}
                      onMin={v => update({ amountMin: v })}
                      onMax={v => update({ amountMax: v })}
                    />
                  </ColHeader>
                </th>
                <th className="w-28 px-2 py-0 font-normal text-left">
                  <ColHeader hasValue={filters.statusSet.size > 0} onClear={() => update({ statusSet: new Set() })}>
                    <MultiFilter
                      placeholder="Status"
                      options={STATUS_OPTIONS}
                      selected={filters.statusSet}
                      onToggle={toggleStatus}
                    />
                  </ColHeader>
                </th>
                <th className="w-14 px-2 py-0 font-normal text-center">
                  <ColHeader hasValue={false} onClear={() => {}}>
                    <span className="text-xs text-muted-foreground">Score</span>
                  </ColHeader>
                </th>
                <th className="w-24 px-2 py-0 font-normal text-left">
                  <ColHeader hasValue={false} onClear={() => {}}>
                    <span className="text-xs text-muted-foreground">Transação</span>
                  </ColHeader>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-muted-foreground">
                    {hasAnyFilter ? 'Nenhuma NF-e para os filtros selecionados.' : 'Nenhuma NF-e encontrada. Conecte uma entidade jurídica ao SEFAZ em Configurações.'}
                  </td>
                </tr>
              ) : (
                rows.map(row => {
                  const contraparte = row.tipo === 'saida'
                    ? (row.destinatarioNome ?? row.destinatarioCnpj ?? '—')
                    : (row.emitenteNome ?? row.emitenteCnpj ?? '—')
                  const nfNum = [row.numeroNf, row.serie].filter(Boolean).join('/')
                  return (
                    <tr key={row.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                        {fmtDate(row.dataEmissao)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                          row.tipo === 'saida'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : 'bg-rose-500/15 text-rose-400',
                        )}>
                          {row.tipo === 'saida' ? 'Saída' : 'Entrada'}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {nfNum || '—'}
                      </td>
                      <td className="px-3 py-2 max-w-[200px] truncate" title={contraparte}>
                        {contraparte}
                      </td>
                      <td className="px-3 py-2 truncate" title={row.legalEntityName}>
                        {row.legalEntityName}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {fmt(row.totalNf)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                          STATUS_STYLE[row.status] ?? 'bg-slate-500/15 text-slate-400',
                        )}>
                          {STATUS_LABEL[row.status] ?? row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                        {row.reconciliationScore ? Number(row.reconciliationScore).toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {row.transactionId ? (
                          <a
                            href={`/transacoes?q=${row.transactionId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            Ver <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Zona 5 — Rodapé */}
      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-end gap-2 px-6 py-3 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page <= 1 || isPending}
            onClick={() => update({ page: filters.page - 1 })}
            className="h-7 px-3 text-xs"
          >
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            Página {filters.page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page >= totalPages || isPending}
            onClick={() => update({ page: filters.page + 1 })}
            className="h-7 px-3 text-xs"
          >
            Próxima
          </Button>
        </div>
      )}
    </div>
  )
}
