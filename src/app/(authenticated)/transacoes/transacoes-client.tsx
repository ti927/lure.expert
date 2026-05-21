'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft, ChevronRight, Layers, Trash2, Bot, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/states/empty-state'
import { cn } from '@/lib/utils'
import { classifyTransaction, deleteTransactions, triggerCategorization } from '@/server/transactions'
import { ColHeader } from '@/components/transacoes-shared/col-header'
import {
  MultiSelectFilter, AmountFilter, DescFilter, DirectionFilter, ReportTypeFilter,
} from '@/components/transacoes-shared/filters'
import { CellCombobox, CategoryCellCombobox } from '@/components/transacoes-shared/cell-combobox'
import { BatchClassifyDialog } from '@/components/transacoes-shared/batch-classify-dialog'
import { ACCT_LABELS } from '@/components/transacoes-shared/types'
import type { DataSourceOption } from '@/server/connections'
import type { Transaction } from '@/db/schema/transactions'
import type { Category } from '@/db/schema/categories'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'

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

type TxRow = Transaction & {
  documentReportType?: string | null
  connectionLogoUrl?: string | null
  connectionBadge?: string | null
}

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

// (MultiSelectFilter, ColHeader, AmountFilter, DescFilter, DirectionFilter, ReportTypeFilter,
//  CellCombobox, CategoryCellCombobox, BatchCombobox foram extraídos para
//  src/components/transacoes-shared/. Importados no topo do arquivo.)


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
                      <td className="px-2 py-1.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {formatDate(tx.date)}
                      </td>
                      <td className="px-2 py-1.5 overflow-hidden">
                        <div className="truncate text-xs">{tx.description}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                        <span className={cn('font-medium text-xs', tx.direction === 'inflow' ? 'text-emerald-600' : 'text-rose-600')}>
                          {tx.direction === 'outflow' && '−'}{formatBRL(tx.amount)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2 min-w-0">
                          {tx.connectionLogoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={tx.connectionLogoUrl} alt="" className="h-5 w-5 rounded object-contain shrink-0" />
                          ) : null}
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="truncate">{acctStr ?? '—'}</span>
                            {tx.connectionBadge && (
                              <span className="inline-flex items-center self-start rounded px-1 py-0 text-[10px] font-medium bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                                {tx.connectionBadge}
                              </span>
                            )}
                          </div>
                        </div>
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
            {localRows.length === 0 && (
              <div className="flex items-center justify-center py-16">
                <EmptyState
                  icon={<Layers className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
                  title="Nenhuma transação encontrada"
                  description="Ajuste os filtros para ver outros resultados."
                />
              </div>
            )}
          </div>
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

      <BatchClassifyDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        selectedIds={Array.from(selectedIds)}
        categories={options.categories.map(c => ({ id: c.id, name: c.name, code: c.code, type: c.type, parentId: c.parentId }))}
        costCenters={options.costCenters.map(c => ({ id: c.id, name: c.name, code: c.code }))}
        businessUnits={options.businessUnits.map(c => ({ id: c.id, name: c.name, code: c.code }))}
        legalEntities={options.legalEntities.map(c => ({ id: c.id, name: c.name }))}
        onSuccess={() => { setSelectedIds(new Set()); router.refresh() }}
      />
    </div>
  )
}
