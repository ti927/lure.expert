'use client'

import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft, ChevronRight, ChevronDown, Layers, Trash2, Bot, X, Split, RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/states/empty-state'
import { cn } from '@/lib/utils'
import { classifyTransaction, deleteTransactions, triggerCategorization, previewCategorization } from '@/server/transactions'
import { ALLOWED_PAGE_SIZES } from '@/lib/transactions-page-size'
import { ColHeader } from '@/components/transacoes-shared/col-header'
import {
  MultiSelectFilter, AmountFilter, DescFilter, DirectionFilter, ReportTypeFilter,
} from '@/components/transacoes-shared/filters'
import { CellCombobox, CategoryCellCombobox } from '@/components/transacoes-shared/cell-combobox'
import { useColumnWidths, ResizeHandle } from '@/components/transacoes-shared/column-resize'
import { COLUNAS_TRANSACOES as COLUNAS } from '@/lib/column-widths'
import { BatchClassifyDialog } from '@/components/transacoes-shared/batch-classify-dialog'
import { AllocationDialog } from '@/components/transacoes-shared/allocation-dialog'
import { BatchAllocationDialog } from '@/components/transacoes-shared/batch-allocation-dialog'
import { getAllocations, type AllocationRow } from '@/server/allocations'
import { ACCT_LABELS } from '@/components/transacoes-shared/types'
import type { SimpleDimensionItem } from '@/components/transacoes-shared/types'
import type { DataSourceOption } from '@/server/connections'
import type { Transaction } from '@/db/schema/transactions'
import type { Category } from '@/db/schema/categories'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'

interface SearchParams {
  page?: string
  pageSize?: string
  q?: string
  from?: string
  to?: string
  direction?: string
  category?: string
  costCenter?: string
  businessUnit?: string
  legalEntity?: string
  contact?: string
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
  // Chega já filtrado e enxuto de getContactOptions — a carteira de contatos é
  // ordem de grandeza maior que as outras três dimensões e não vale trazer a
  // linha inteira só para o combobox.
  contacts: SimpleDimensionItem[]
}

type TxRow = Transaction & {
  documentReportType?: string | null
  connectionLogoUrl?: string | null
  connectionBadge?: string | null
  /** Tem partes de rateio: a classificação vive nelas, não neste lançamento. */
  isAllocated?: boolean
}

interface Props {
  data: { rows: TxRow[]; total: number; pages: number; page: number; totals: { inflow: string; outflow: string } }
  options: DimensionOptions
  dataSources: DataSourceOption[]
  searchParams: SearchParams
  reviewCount: number
  hasAnyFilter: boolean
}

type DimensionField = 'categoryId' | 'costCenterId' | 'businessUnitId' | 'legalEntityId' | 'contactId'

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


/**
 * Cabeçalho com alça de redimensionamento.
 *
 * Definido no MÓDULO, nunca dentro do componente: um componente criado a cada
 * render remonta a subárvore, e a subárvore aqui é o filtro da coluna — o campo
 * de descrição perderia o texto digitado a cada tecla.
 */
function ThRedim({
  id, cols, children,
}: {
  id: string
  cols: ReturnType<typeof useColumnWidths>
  children: React.ReactNode
}) {
  return (
    <th className="group/col relative px-2 py-1">
      {children}
      <ResizeHandle
        onPointerDown={e => cols.iniciarArrasto(id, e)}
        onDoubleClick={() => cols.restaurarColuna(id)}
      />
    </th>
  )
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const LS_FILTERS_KEY = 'lure:transacoes:filters'
const FILTER_KEYS = ['q', 'from', 'to', 'direction', 'category', 'costCenter', 'businessUnit', 'legalEntity', 'contact', 'documentId', 'accountId', 'sort', 'reportType', 'amountMin', 'amountMax', 'pageSize'] as const

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
  const [allocTarget, setAllocTarget] = useState<TxRow | null>(null)
  const [batchAllocOpen, setBatchAllocOpen] = useState(false)
  // Partes carregadas sob demanda ao expandir — trazer o rateio de todos os
  // lançamentos numa página de 1.000 seria pagar por informação que quase
  // ninguém abre.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [partsCache, setPartsCache] = useState<Record<string, AllocationRow[]>>({})
  const [loadingParts, setLoadingParts] = useState(false)

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (partsCache[id]) return
    setLoadingParts(true)
    const partes = await getAllocations(id)
    setPartsCache(prev => ({ ...prev, [id]: partes }))
    setLoadingParts(false)
  }
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([])
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCategorizing, setIsCategorizing] = useState(false)
  const [previaCategorizacao, setPreviaCategorizacao] =
    useState<{ count: number; custoEstimadoUsd: number } | null>(null)
  const [fromLocal, setFromLocal] = useState(searchParams.from ?? '')
  const [toLocal, setToLocal] = useState(searchParams.to ?? '')

  // Larguras de coluna: por navegador, chave própria (largura não é filtro, e
  // "Limpar" não pode levar o layout junto).
  const cols = useColumnWidths('transacoes', COLUNAS)

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
  const ctOptions  = options.contacts.map(c => ({ id: c.id, label: c.code ? `${c.code} – ${c.name}` : c.name }))
  const acctOptions = dataSources.map(s => ({ id: s.accountId, label: `${s.label} (${s.txCount})` }))

  const inflow  = Number(data.totals.inflow)
  const outflow = Number(data.totals.outflow)
  const net     = inflow - outflow

  /**
   * O clique agora ABRE A PRÉVIA em vez de disparar. Este botão manda o job com
   * `forceRun`, que ignora o toggle de categorização automática — era o único
   * caminho capaz de gerar milhares de chamadas de IA sem aviso nenhum.
   */
  async function handleTriggerCategorization() {
    setIsCategorizing(true)
    const p = await previewCategorization()
    setIsCategorizing(false)
    if (p.count === 0) { toast.info('Não há lançamentos sem categoria.'); return }
    setPreviaCategorizacao(p)
  }

  async function confirmarCategorizacao() {
    setIsCategorizing(true)
    const result = await triggerCategorization()
    setIsCategorizing(false)
    setPreviaCategorizacao(null)
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
          {cols.customizado && (
            <Button
              variant="ghost"
              size="sm"
              onClick={cols.restaurarTudo}
              className="h-7 text-xs gap-1"
              title="Devolve as colunas à largura padrão"
            >
              <RotateCcw className="h-3 w-3" />Larguras
            </Button>
          )}
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
          <Button variant="outline" size="sm" onClick={() => setBatchAllocOpen(true)}>
            <Split className="h-3.5 w-3.5 mr-1.5" />Ratear em lote
          </Button>
          <Button variant="outline" size="sm" className="text-destructive border-destructive/40 hover:bg-destructive/5" onClick={() => setDeleteTargetIds(Array.from(selectedIds))}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />Apagar selecionados
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Cancelar</Button>
        </div>
      )}

      {/* ── Tabela (scroll interno) ────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden px-6 pb-0">
        <div className="h-full overflow-auto border rounded-lg">
            {/* `min-w-full` preserva o comportamento de sempre em tela larga: se a
                soma das colunas couber no contêiner, a tabela ainda ocupa a
                largura toda. Passando disso, manda a soma — e é ela que produz a
                rolagem lateral. */}
            <table
              ref={cols.tableRef}
              style={{ width: cols.total }}
              className="min-w-full text-sm table-fixed [&_td]:border-r [&_th]:border-r [&_td]:border-border/20 [&_th]:border-border/20 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0"
            >
              <colgroup>
                {COLUNAS.map(c => <col key={c.id} {...cols.propsDaColuna(c.id)} />)}
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted border-b">
                  {/* checkbox */}
                  <th className="px-2 py-1.5 text-left">
                    <input type="checkbox" className="rounded border-input" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected }} onChange={toggleAll} />
                  </th>
                  {/* Data */}
                  <ThRedim id="date" cols={cols}>
                    <ColHeader hasValue={false} onClear={() => {}} sortKey="date" currentSort={searchParams.sort} onSort={() => toggleSort('date')}>
                      <span className="text-xs font-medium text-muted-foreground px-1">Data</span>
                    </ColHeader>
                  </ThRedim>
                  {/* Descrição */}
                  <ThRedim id="desc" cols={cols}>
                    <ColHeader hasValue={!!searchParams.q} onClear={() => updateFilters({ q: undefined, page: undefined })} sortKey="desc" currentSort={searchParams.sort} onSort={() => toggleSort('desc')}>
                      <DescFilter value={searchParams.q} onUpdate={v => updateFilters({ q: v, page: undefined })} />
                    </ColHeader>
                  </ThRedim>
                  {/* Valor */}
                  <ThRedim id="amount" cols={cols}>
                    <ColHeader hasValue={!!(searchParams.amountMin || searchParams.amountMax)} onClear={() => updateFilters({ amountMin: undefined, amountMax: undefined, page: undefined })} sortKey="amount" currentSort={searchParams.sort} onSort={() => toggleSort('amount')}>
                      <AmountFilter amountMin={searchParams.amountMin} amountMax={searchParams.amountMax} onUpdate={updateFilters} />
                    </ColHeader>
                  </ThRedim>
                  {/* Banco / Conta */}
                  <ThRedim id="account" cols={cols}>
                    <ColHeader hasValue={!!searchParams.accountId} onClear={() => updateFilters({ accountId: undefined, page: undefined })} sortKey="account" currentSort={searchParams.sort} onSort={() => toggleSort('account')}>
                      <MultiSelectFilter placeholder="Banco/Conta" value={searchParams.accountId} options={acctOptions} onUpdate={v => updateFilters({ accountId: v, page: undefined })} width="w-72" />
                    </ColHeader>
                  </ThRedim>
                  {/* Tipo movimento */}
                  <ThRedim id="direction" cols={cols}>
                    <ColHeader hasValue={!!searchParams.direction} onClear={() => updateFilters({ direction: undefined, page: undefined })} sortKey="direction" currentSort={searchParams.sort} onSort={() => toggleSort('direction')}>
                      <DirectionFilter value={searchParams.direction} onUpdate={v => updateFilters({ direction: v, page: undefined })} />
                    </ColHeader>
                  </ThRedim>
                  {/* Origem DRE/BP */}
                  <ThRedim id="reporttype" cols={cols}>
                    <ColHeader hasValue={!!searchParams.reportType} onClear={() => updateFilters({ reportType: undefined, page: undefined })} sortKey="reporttype" currentSort={searchParams.sort} onSort={() => toggleSort('reporttype')}>
                      <ReportTypeFilter value={searchParams.reportType} onUpdate={v => updateFilters({ reportType: v, page: undefined })} />
                    </ColHeader>
                  </ThRedim>
                  {/* Categoria */}
                  <ThRedim id="category" cols={cols}>
                    <ColHeader hasValue={!!searchParams.category} onClear={() => updateFilters({ category: undefined, page: undefined })} sortKey="category" currentSort={searchParams.sort} onSort={() => toggleSort('category')}>
                      <MultiSelectFilter placeholder="Categoria" value={searchParams.category} options={[]} grouped={categoryFilterGroups} showSpecial onUpdate={v => updateFilters({ category: v, page: undefined })} width="w-72" />
                    </ColHeader>
                  </ThRedim>
                  {/* C. custo */}
                  <ThRedim id="costcenter" cols={cols}>
                    <ColHeader hasValue={!!searchParams.costCenter} onClear={() => updateFilters({ costCenter: undefined, page: undefined })} sortKey="costcenter" currentSort={searchParams.sort} onSort={() => toggleSort('costcenter')}>
                      <MultiSelectFilter placeholder="C. custo" value={searchParams.costCenter} options={ccOptions} showSpecial onUpdate={v => updateFilters({ costCenter: v, page: undefined })} />
                    </ColHeader>
                  </ThRedim>
                  {/* Un. negócio */}
                  <ThRedim id="businessunit" cols={cols}>
                    <ColHeader hasValue={!!searchParams.businessUnit} onClear={() => updateFilters({ businessUnit: undefined, page: undefined })} sortKey="businessunit" currentSort={searchParams.sort} onSort={() => toggleSort('businessunit')}>
                      <MultiSelectFilter placeholder="Un. negócio" value={searchParams.businessUnit} options={buOptions} showSpecial onUpdate={v => updateFilters({ businessUnit: v, page: undefined })} />
                    </ColHeader>
                  </ThRedim>
                  {/* Entidade */}
                  <ThRedim id="legalentity" cols={cols}>
                    <ColHeader hasValue={!!searchParams.legalEntity} onClear={() => updateFilters({ legalEntity: undefined, page: undefined })} sortKey="legalentity" currentSort={searchParams.sort} onSort={() => toggleSort('legalentity')}>
                      <MultiSelectFilter placeholder="Entidade" value={searchParams.legalEntity} options={leOptions} showSpecial onUpdate={v => updateFilters({ legalEntity: v, page: undefined })} />
                    </ColHeader>
                  </ThRedim>
                  {/* Contato */}
                  <ThRedim id="contact" cols={cols}>
                    <ColHeader hasValue={!!searchParams.contact} onClear={() => updateFilters({ contact: undefined, page: undefined })} sortKey="contact" currentSort={searchParams.sort} onSort={() => toggleSort('contact')}>
                      <MultiSelectFilter placeholder="Contato" value={searchParams.contact} options={ctOptions} showSpecial onUpdate={v => updateFilters({ contact: v, page: undefined })} width="w-72" />
                    </ColHeader>
                  </ThRedim>
                  {/* ações */}
                  <th />
                </tr>
              </thead>
              <tbody>
                {localRows.map(tx => {
                  const isClassifying = classifyingId === tx.id
                  // Lançamento rateado: as dimensões vivem nas partes, e o banco
                  // recusa gravá-las aqui. A célula vira leitura até a 10.4
                  // trazer a edição do rateio. A categoria segue editável — ela
                  // não se parte.
                  const dimLocked = tx.isAllocated === true
                  const acctLabel = tx.accountType ? (ACCT_LABELS[tx.accountType] ?? tx.accountType) : null
                  const acctStr = acctLabel
                    ? (tx.accountNumber ? `${acctLabel} · ${tx.accountNumber}` : acctLabel)
                    : null

                  return (
                    <Fragment key={tx.id}>
                    <tr className="group border-b last:border-0 hover:bg-muted/20 transition-colors">
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
                      {dimLocked ? (
                        <td className="px-2 py-1.5 text-xs text-muted-foreground" colSpan={4}>
                          <button
                            onClick={() => toggleExpand(tx.id)}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors"
                            title="Ver as partes do rateio"
                          >
                            {expandedId === tx.id
                              ? <ChevronDown className="h-3 w-3" />
                              : <ChevronRight className="h-3 w-3" />}
                            Rateado
                          </button>
                          <span className="ml-2">a classificação está nas partes</span>
                        </td>
                      ) : (
                        <>
                          <td className="px-1 py-1">
                            <CellCombobox value={tx.costCenterId ?? null} options={options.costCenters} onValueChange={v => handleClassify(tx.id, 'costCenterId', v)} disabled={isClassifying} />
                          </td>
                          <td className="px-1 py-1">
                            <CellCombobox value={tx.businessUnitId ?? null} options={options.businessUnits} onValueChange={v => handleClassify(tx.id, 'businessUnitId', v)} disabled={isClassifying} />
                          </td>
                          <td className="px-1 py-1">
                            <CellCombobox value={tx.legalEntityId ?? null} options={options.legalEntities} onValueChange={v => handleClassify(tx.id, 'legalEntityId', v)} disabled={isClassifying} />
                          </td>
                          <td className="px-1 py-1">
                            <CellCombobox value={tx.contactId ?? null} options={options.contacts} onValueChange={v => handleClassify(tx.id, 'contactId', v)} disabled={isClassifying} />
                          </td>
                        </>
                      )}
                      <td className="px-1 py-1 text-center">
                        <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setAllocTarget(tx)} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/5" title={dimLocked ? 'Editar rateio' : 'Ratear entre dimensões'}>
                            <Split className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setDeleteTargetIds([tx.id])} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/5" title="Apagar lançamento">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === tx.id && (
                      <tr className="bg-violet-50/40 border-b">
                        <td />
                        <td colSpan={12} className="px-2 py-2">
                          {loadingParts && !partsCache[tx.id] ? (
                            <span className="text-xs text-muted-foreground">Carregando partes…</span>
                          ) : (
                            <div className="space-y-1">
                              {(partsCache[tx.id] ?? []).map(p => (
                                <div key={p.id} className="flex items-center gap-3 text-xs">
                                  <span className="text-muted-foreground">└</span>
                                  <span className="tabular-nums font-medium w-24 text-right">{formatBRL(p.amount)}</span>
                                  <span className="text-muted-foreground">
                                    {[
                                      options.costCenters.find(c => c.id === p.costCenterId)?.name,
                                      options.businessUnits.find(c => c.id === p.businessUnitId)?.name,
                                      options.legalEntities.find(c => c.id === p.legalEntityId)?.name,
                                      options.contacts.find(c => c.id === p.contactId)?.name,
                                    ].filter(Boolean).join(' · ') || 'sem dimensão'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
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

      {/* ── Rodapé: totais selecionados + page size + paginação ───────────── */}
      {(selectedIds.size > 0 || data.pages > 1 || data.total > 100) && (
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
          {/* Page size + Paginação */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <label htmlFor="pageSize">Linhas por página</label>
              <select
                id="pageSize"
                value={searchParams.pageSize ?? '100'}
                onChange={e => updateFilters({ pageSize: e.target.value, page: undefined })}
                className="rounded border border-border bg-background px-2 py-1 text-xs cursor-pointer hover:bg-muted/30 transition-colors"
              >
                {ALLOWED_PAGE_SIZES.map(n => <option key={n} value={String(n)}>{n}</option>)}
              </select>
            </div>
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
        </div>
      )}

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}
      <AlertDialog open={previaCategorizacao !== null} onOpenChange={open => { if (!open) setPreviaCategorizacao(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Classificar {previaCategorizacao?.count.toLocaleString('pt-BR')} lançamento
              {previaCategorizacao?.count !== 1 ? 's' : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Cada lançamento sem natureza que não casar por regra ou recorrência vai passar
                  pelo expert. O custo estimado desta rodada é de{' '}
                  <strong className="text-foreground tabular-nums">
                    US$ {previaCategorizacao?.custoEstimadoUsd.toFixed(2)}
                  </strong>.
                </p>
                <p className="text-[11px]">
                  É estimativa, não promessa: o consumo real depende de quantos lançamentos as
                  camadas determinísticas resolvem sozinhas antes de chegar ao expert.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCategorizing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarCategorizacao} disabled={isCategorizing}>
              {isCategorizing ? 'Iniciando...' : 'Classificar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
        contacts={options.contacts}
        onSuccess={() => { setSelectedIds(new Set()); router.refresh() }}
      />

      <AllocationDialog
        open={allocTarget !== null}
        onOpenChange={o => { if (!o) setAllocTarget(null) }}
        transaction={allocTarget}
        costCenters={options.costCenters.map(c => ({ id: c.id, name: c.name, code: c.code }))}
        businessUnits={options.businessUnits.map(c => ({ id: c.id, name: c.name, code: c.code }))}
        legalEntities={options.legalEntities.map(c => ({ id: c.id, name: c.name }))}
        contacts={options.contacts}
        onSaved={() => {
          // O cache de partes fica velho depois de salvar.
          if (allocTarget) setPartsCache(prev => { const n = { ...prev }; delete n[allocTarget.id]; return n })
          router.refresh()
        }}
      />

      <BatchAllocationDialog
        open={batchAllocOpen}
        onOpenChange={setBatchAllocOpen}
        selectedIds={Array.from(selectedIds)}
        costCenters={options.costCenters.map(c => ({ id: c.id, name: c.name, code: c.code }))}
        businessUnits={options.businessUnits.map(c => ({ id: c.id, name: c.name, code: c.code }))}
        legalEntities={options.legalEntities.map(c => ({ id: c.id, name: c.name }))}
        contacts={options.contacts}
        onSaved={() => { setSelectedIds(new Set()); setPartsCache({}); router.refresh() }}
      />
    </div>
  )
}
