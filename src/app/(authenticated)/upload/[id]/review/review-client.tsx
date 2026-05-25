'use client'

import { useState, useEffect, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowUpDown, ChevronLeft, ChevronRight, Loader2, CheckCircle2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { updateStagingRow, batchUpdateStaging, approveAndInsert, setAllPendingDirection } from '@/server/staging'
import type { TransactionStaging } from '@/db/schema/transactions-staging'
import type { Document } from '@/db/schema/documents'

const PAGE_SIZE = 100

const SOURCE_LABELS: Record<string, string> = {
  bank: 'Extrato bancário',
  erp: 'Relatório ERP',
  acquirer: 'Adquirente',
  credit_card: 'Fatura de cartão',
  sefaz: 'Nota fiscal',
  other: 'Outro',
}

type RowStatus = 'pending' | 'approved' | 'rejected'
type DirFilter = 'all' | 'inflow' | 'outflow'
type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected'

interface Row {
  id: string
  rowIndex: number
  date: string | null
  amount: string | null
  direction: string | null
  description: string | null
  status: RowStatus
}

interface EditCell {
  rowId: string
  field: 'date' | 'amount' | 'description'
  value: string
}

interface Props {
  documentId: string
  initialData: {
    document: Document
    rows: TransactionStaging[]
    importedCount: number
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function formatAmount(amt: string | null): string {
  if (!amt) return '—'
  return Number(amt).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function ReviewClient({ documentId, initialData }: Props) {
  const router = useRouter()
  const doc = initialData.document
  const isProcessing = doc.extractionStatus !== 'completed' && doc.extractionStatus !== 'failed'

  const [rows, setRows] = useState<Row[]>(() =>
    initialData.rows.map(r => ({
      id: r.id,
      rowIndex: r.rowIndex,
      date: r.date,
      amount: r.amount,
      direction: r.direction,
      description: r.description,
      status: (r.status ?? 'pending') as RowStatus,
    })),
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editCell, setEditCell] = useState<EditCell | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [importing, setImporting] = useState(false)
  const [isImported, setIsImported] = useState(initialData.importedCount > 0)
  const [pollingTimedOut, setPollingTimedOut] = useState(false)
  const [dirFilter, setDirFilter] = useState<DirFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [, startTransition] = useTransition()

  useEffect(() => {
    setRows(
      initialData.rows.map(r => ({
        id: r.id,
        rowIndex: r.rowIndex,
        date: r.date,
        amount: r.amount,
        direction: r.direction,
        description: r.description,
        status: (r.status ?? 'pending') as RowStatus,
      })),
    )
  }, [initialData.rows])

  useEffect(() => {
    if (!isProcessing) return
    setPollingTimedOut(false)
    const poll = setInterval(() => router.refresh(), 3000)
    const timeout = setTimeout(() => {
      clearInterval(poll)
      setPollingTimedOut(true)
    }, 120_000)
    return () => { clearInterval(poll); clearTimeout(timeout) }
  }, [isProcessing, router])

  // ─── Derivados ────────────────────────────────────────────────────────────
  const pendingCount   = rows.filter(r => r.status === 'pending').length
  const approvedCount  = rows.filter(r => r.status === 'approved').length
  const rejectedCount  = rows.filter(r => r.status === 'rejected').length
  const toImportCount  = pendingCount + approvedCount
  const noDirectionCount = rows.filter(r => r.status !== 'rejected' && !r.direction).length
  const sourceType     = (doc.metadata as Record<string, unknown>)?.source_type as string

  const totalInflow  = rows.filter(r => r.status !== 'rejected' && r.direction === 'inflow'  && r.amount).reduce((s, r) => s + Number(r.amount), 0)
  const totalOutflow = rows.filter(r => r.status !== 'rejected' && r.direction === 'outflow' && r.amount).reduce((s, r) => s + Number(r.amount), 0)
  const netBalance   = totalInflow - totalOutflow

  const filteredRows = useMemo(() => rows.filter(r => {
    if (dirFilter    !== 'all' && r.direction !== dirFilter)  return false
    if (statusFilter !== 'all' && r.status    !== statusFilter) return false
    return true
  }), [rows, dirFilter, statusFilter])

  const totalPages     = Math.ceil(filteredRows.length / PAGE_SIZE)
  const pageRows       = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const allPageSelected = pageRows.length > 0 && pageRows.every(r => selected.has(r.id))

  // Reset página quando filtro reduz o total
  useEffect(() => {
    if (currentPage > Math.max(1, totalPages)) setCurrentPage(1)
  }, [totalPages, currentPage])

  const selTotals = useMemo(() => {
    let selInflow = 0, selOutflow = 0
    for (const row of filteredRows) {
      if (!selected.has(row.id)) continue
      const amt = Number(row.amount)
      if (row.direction === 'inflow') selInflow += amt
      else selOutflow += amt
    }
    return { inflow: selInflow, outflow: selOutflow, net: selInflow - selOutflow }
  }, [filteredRows, selected])

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function patchRow(id: string, patch: Partial<Row>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  function togglePageSelect() {
    if (allPageSelected) {
      setSelected(prev => { const next = new Set(prev); pageRows.forEach(r => next.delete(r.id)); return next })
    } else {
      setSelected(prev => { const next = new Set(prev); pageRows.forEach(r => next.add(r.id)); return next })
    }
  }

  function saveEdit() {
    if (!editCell) return
    const cell = editCell
    setEditCell(null)
    patchRow(cell.rowId, { [cell.field]: cell.value || null })
    updateStagingRow(cell.rowId, { [cell.field]: cell.value || null }).catch(() => toast.error('Erro ao salvar alteração'))
  }

  async function flipDirection(rowId: string) {
    const row = rows.find(r => r.id === rowId)
    if (!row) return
    const newDir = row.direction === 'inflow' ? 'outflow' : 'inflow'
    patchRow(rowId, { direction: newDir })
    await updateStagingRow(rowId, { direction: newDir })
  }

  function handleBatch(action: 'approve' | 'reject' | 'flip') {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (action === 'approve') {
      ids.forEach(id => patchRow(id, { status: 'approved' }))
    } else if (action === 'reject') {
      ids.forEach(id => patchRow(id, { status: 'rejected' }))
    } else {
      setRows(prev => prev.map(r => ids.includes(r.id) ? { ...r, direction: r.direction === 'inflow' ? 'outflow' : 'inflow' } : r))
    }
    setSelected(new Set())
    startTransition(async () => { await batchUpdateStaging(documentId, ids, action) })
  }

  async function handleSetAllDirection(direction: 'inflow' | 'outflow') {
    setRows(prev => prev.map(r =>
      r.status !== 'rejected' && !r.direction ? { ...r, direction } : r,
    ))
    try {
      const result = await setAllPendingDirection(documentId, direction)
      const label = direction === 'inflow' ? 'entrada' : 'saída'
      toast.success(`${result.updated} linha${result.updated === 1 ? '' : 's'} marcada${result.updated === 1 ? '' : 's'} como ${label}.`)
    } catch {
      toast.error('Erro ao atualizar direção das linhas.')
      router.refresh()
    }
  }

  async function handleImport() {
    setImporting(true)
    try {
      const result = await approveAndInsert(documentId)
      setRows(prev => prev.map(r => r.status === 'pending' ? { ...r, status: 'approved' } : r))
      if (result.inserted > 0) setIsImported(true)
      if (result.inserted > 0) {
        toast.success(`${result.inserted} transaç${result.inserted === 1 ? 'ão importada' : 'ões importadas'} com sucesso`)
      } else if (result.total === 0) {
        toast.info('Todas as linhas já foram rejeitadas — nenhuma transação a importar.')
      } else {
        toast.warning('Nenhuma transação importada. Verifique se as linhas têm data, valor e direção preenchidos.')
      }
      if (result.skipped > 0) {
        toast.warning(`${result.skipped} linha${result.skipped > 1 ? 's ignoradas' : ' ignorada'} por dados incompletos (sem data, valor ou direção).`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao importar transações')
    } finally {
      setImporting(false)
    }
  }

  // ─── Estado: processando ──────────────────────────────────────────────────
  if (isProcessing) {
    return (
      <div className="p-6 space-y-4">
        <Link href="/upload" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Enviar arquivo
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">Revisão de linhas</h1>
        <p className="text-sm text-muted-foreground">{doc.filename}</p>
        {pollingTimedOut ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center space-y-2">
            <p className="text-sm font-medium text-amber-800">O processamento está demorando mais do que o esperado.</p>
            <p className="text-xs text-amber-700">O expert continua trabalhando em segundo plano. Você pode voltar a esta página em alguns minutos.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => { setPollingTimedOut(false); router.refresh() }}>Verificar novamente</Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-8 justify-center">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">expert está processando o arquivo...</p>
          </div>
        )}
      </div>
    )
  }

  // ─── Estado: falha na extração ────────────────────────────────────────────
  if (doc.extractionStatus === 'failed') {
    return (
      <div className="p-6 space-y-4">
        <Link href="/upload" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Enviar arquivo
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">Revisão de linhas</h1>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive space-y-1">
          <p className="font-medium">Não foi possível extrair dados deste arquivo.</p>
          {Boolean((doc.extractedData as Record<string, unknown>)?.error) && (
            <p className="text-xs opacity-80 font-mono break-all">{String((doc.extractedData as Record<string, unknown>).error)}</p>
          )}
        </div>
        <Button variant="outline" asChild><Link href="/upload">Tentar outro arquivo</Link></Button>
      </div>
    )
  }

  // ─── Estado: sem linhas ───────────────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <Link href="/upload" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Enviar arquivo
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">Revisão de linhas</h1>
        <p className="text-sm text-muted-foreground">{doc.filename}</p>
        <div className="rounded-lg border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          Nenhuma linha extraída. O arquivo pode estar vazio ou em formato não suportado.
        </div>
      </div>
    )
  }

  // ─── Tabela principal ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Zona 1: Cabeçalho ───────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-start justify-between gap-4 px-6 pt-5 pb-3">
        <div>
          <Link href="/upload" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft size={14} /> Enviar arquivo
          </Link>
          <h1 className="text-2xl font-semibold text-foreground">Revisão de linhas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {doc.filename}{sourceType && SOURCE_LABELS[sourceType] ? ` · ${SOURCE_LABELS[sourceType]}` : ''}
          </p>
        </div>
        <div className="shrink-0 pt-1">
          {isImported ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 size={15} className="shrink-0" />
              <span className="font-medium">{approvedCount} transaç{approvedCount !== 1 ? 'ões importadas' : 'ão importada'}.</span>
              <Button size="sm" variant="outline" className="ml-1 border-emerald-300 text-emerald-700 hover:bg-emerald-100" asChild>
                <Link href="/transacoes">Ver Transações</Link>
              </Button>
            </div>
          ) : (
            <Button onClick={handleImport} disabled={importing || toImportCount === 0}>
              {importing ? (
                <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Importando...</span>
              ) : (
                `Confirmar e importar ${toImportCount} transaç${toImportCount === 1 ? 'ão' : 'ões'}`
              )}
            </Button>
          )}
        </div>
      </div>

      {/* ── Zona 2: Totalizador + stats ─────────────────────────────────────── */}
      <div className="shrink-0 flex flex-wrap items-center gap-4 px-6 pb-3 text-xs text-muted-foreground">
        <span>Entradas <span className="font-medium text-emerald-600 tabular-nums">{formatBRL(totalInflow)}</span></span>
        <span>Saídas <span className="font-medium text-rose-600 tabular-nums">{formatBRL(totalOutflow)}</span></span>
        <span>Líquido <span className={cn('font-medium tabular-nums', netBalance >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{netBalance >= 0 ? '' : '−'}{formatBRL(Math.abs(netBalance))}</span></span>
        <span className="text-border/60">·</span>
        <span>{rows.length} linhas</span>
        <span className="text-amber-600 font-medium">{pendingCount} pendentes</span>
        <span className="text-emerald-600 font-medium">{approvedCount} aprovadas</span>
        {rejectedCount > 0 && <span className="text-rose-600 font-medium">{rejectedCount} rejeitadas</span>}
        {(dirFilter !== 'all' || statusFilter !== 'all') && (
          <button
            onClick={() => { setDirFilter('all'); setStatusFilter('all') }}
            className="inline-flex items-center gap-1 text-primary hover:text-primary/80"
          >
            <X className="h-3 w-3" />Limpar filtros
          </button>
        )}
      </div>

      {/* ── Zona 2.5: Aviso de direção pendente ─────────────────────────────── */}
      {!isImported && noDirectionCount > 0 && (
        <div className="shrink-0 mx-6 mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          <span className="text-amber-800">
            <span className="font-medium">{noDirectionCount}</span> linha{noDirectionCount === 1 ? '' : 's'} sem direção definida — não serão importadas.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-100" onClick={() => handleSetAllDirection('inflow')}>
              Marcar todas como Entrada
            </Button>
            <Button size="sm" variant="outline" className="border-rose-300 text-rose-700 hover:bg-rose-100" onClick={() => handleSetAllDirection('outflow')}>
              Marcar todas como Saída
            </Button>
          </div>
        </div>
      )}

      {/* ── Zona 3: Toolbar de seleção em lote ──────────────────────────────── */}
      {!isImported && selected.size > 0 && (
        <div className="shrink-0 flex items-center gap-3 bg-primary/5 border-y border-primary/20 px-6 py-2">
          <span className="text-sm font-medium">{selected.size} selecionada{selected.size !== 1 ? 's' : ''}</span>
          <Button size="sm" variant="outline" onClick={() => handleBatch('approve')}>Aprovar</Button>
          <Button size="sm" variant="outline" onClick={() => handleBatch('reject')}>Rejeitar</Button>
          <Button size="sm" variant="outline" onClick={() => handleBatch('flip')}>
            <ArrowUpDown size={13} className="mr-1" />Inverter direção
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto text-muted-foreground">Cancelar</Button>
        </div>
      )}

      {/* ── Zona 4: Tabela com scroll interno ───────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden px-6 pb-0">
        <div className="h-full overflow-auto border rounded-lg">
          <table className="w-full text-sm [&_td]:border-r [&_th]:border-r [&_td]:border-border/20 [&_th]:border-border/20 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted border-b">
                {!isImported && (
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={togglePageSelect}
                      className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                      aria-label="Selecionar página"
                    />
                  </th>
                )}
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-10">#</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-28">Data</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground w-32">Valor</th>
                {/* Direção — filtro no header */}
                <th className="px-3 py-2 w-28">
                  <div className="flex items-center gap-1">
                    <select
                      value={dirFilter}
                      onChange={e => { setDirFilter(e.target.value as DirFilter); setCurrentPage(1) }}
                      className="text-xs font-medium text-muted-foreground bg-transparent border-none outline-none cursor-pointer appearance-none hover:text-foreground transition-colors"
                    >
                      <option value="all">Direção</option>
                      <option value="inflow">Entrada</option>
                      <option value="outflow">Saída</option>
                    </select>
                    {dirFilter !== 'all' && (
                      <button onClick={() => { setDirFilter('all'); setCurrentPage(1) }} className="text-muted-foreground hover:text-foreground">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Descrição</th>
                {/* Status — filtro no header */}
                <th className="px-3 py-2 w-32">
                  <div className="flex items-center gap-1">
                    <select
                      value={statusFilter}
                      onChange={e => { setStatusFilter(e.target.value as StatusFilter); setCurrentPage(1) }}
                      className="text-xs font-medium text-muted-foreground bg-transparent border-none outline-none cursor-pointer appearance-none hover:text-foreground transition-colors"
                    >
                      <option value="all">Status</option>
                      <option value="pending">Pendente</option>
                      <option value="approved">Aprovada</option>
                      <option value="rejected">Rejeitada</option>
                    </select>
                    {statusFilter !== 'all' && (
                      <button onClick={() => { setStatusFilter('all'); setCurrentPage(1) }} className="text-muted-foreground hover:text-foreground">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={isImported ? 6 : 7} className="px-6 py-12 text-center text-sm text-muted-foreground">
                    Nenhuma linha corresponde ao filtro selecionado.
                  </td>
                </tr>
              ) : pageRows.map(row => (
                <tr
                  key={row.id}
                  className={cn('border-b last:border-0 transition-colors', selected.has(row.id) ? 'bg-primary/5' : 'hover:bg-muted/20')}
                >
                  {/* Checkbox */}
                  {!isImported && (
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleSelect(row.id)}
                        className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                      />
                    </td>
                  )}

                  {/* Índice */}
                  <td className="px-3 py-2.5 text-muted-foreground tabular-nums text-xs">{row.rowIndex + 1}</td>

                  {/* Data */}
                  <td className="px-3 py-2.5">
                    {!isImported && editCell?.rowId === row.id && editCell.field === 'date' ? (
                      <Input
                        type="date"
                        value={editCell.value}
                        onChange={e => setEditCell(c => (c ? { ...c, value: e.target.value } : c))}
                        onBlur={saveEdit}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditCell(null) }}
                        className="h-7 w-34 text-sm"
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => !isImported && setEditCell({ rowId: row.id, field: 'date', value: row.date ?? '' })}
                        className={cn('tabular-nums text-left', !isImported && 'hover:text-primary transition-colors')}
                      >
                        {formatDate(row.date)}
                      </button>
                    )}
                  </td>

                  {/* Valor */}
                  <td className="px-3 py-2.5 text-right">
                    {!isImported && editCell?.rowId === row.id && editCell.field === 'amount' ? (
                      <Input
                        type="number"
                        value={editCell.value}
                        onChange={e => setEditCell(c => (c ? { ...c, value: e.target.value } : c))}
                        onBlur={saveEdit}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditCell(null) }}
                        className="h-7 w-32 text-sm text-right"
                        autoFocus step="0.01" min="0"
                      />
                    ) : (
                      <button
                        onClick={() => !isImported && setEditCell({ rowId: row.id, field: 'amount', value: row.amount ?? '' })}
                        className={cn('tabular-nums', !isImported && 'hover:text-primary transition-colors')}
                      >
                        {formatAmount(row.amount)}
                      </button>
                    )}
                  </td>

                  {/* Direção */}
                  <td className="px-3 py-2.5">
                    <span
                      onClick={() => !isImported && flipDirection(row.id)}
                      title={isImported ? undefined : 'Clique para inverter'}
                      role={isImported ? undefined : 'button'}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                        row.direction === 'inflow'
                          ? cn('bg-emerald-100 text-emerald-700', !isImported && 'hover:bg-emerald-200 cursor-pointer')
                          : row.direction === 'outflow'
                            ? cn('bg-rose-100 text-rose-700', !isImported && 'hover:bg-rose-200 cursor-pointer')
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {!isImported && <ArrowUpDown size={10} />}
                      {row.direction === 'inflow' ? 'Entrada' : row.direction === 'outflow' ? 'Saída' : '—'}
                    </span>
                  </td>

                  {/* Descrição */}
                  <td className="px-3 py-2.5 max-w-xs">
                    {!isImported && editCell?.rowId === row.id && editCell.field === 'description' ? (
                      <Input
                        value={editCell.value}
                        onChange={e => setEditCell(c => (c ? { ...c, value: e.target.value } : c))}
                        onBlur={saveEdit}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditCell(null) }}
                        className="h-7 text-sm"
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => !isImported && setEditCell({ rowId: row.id, field: 'description', value: row.description ?? '' })}
                        className={cn('text-left max-w-xs truncate block', !isImported && 'hover:text-primary transition-colors')}
                        title={row.description ?? ''}
                      >
                        {row.description || <span className="text-muted-foreground">—</span>}
                      </button>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-3 py-2.5">
                    <span className={cn(
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                      row.status === 'approved' && 'bg-emerald-100 text-emerald-700',
                      row.status === 'rejected' && 'bg-rose-100 text-rose-700',
                      row.status === 'pending'  && 'bg-amber-100 text-amber-700',
                    )}>
                      {row.status === 'approved' ? 'Aprovada' : row.status === 'rejected' ? 'Rejeitada' : 'Pendente'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Zona 5: Rodapé — totais selecionados + paginação ────────────────── */}
      {(selected.size > 0 || totalPages > 1) && (
        <div className="shrink-0 flex items-center justify-between px-6 py-2 border-t gap-4">
          {selected.size > 0 ? (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{selected.size} selecionada{selected.size !== 1 ? 's' : ''}</span>
              <span>Entradas <span className="font-medium text-emerald-600 tabular-nums">{formatBRL(selTotals.inflow)}</span></span>
              <span>Saídas <span className="font-medium text-rose-600 tabular-nums">{formatBRL(selTotals.outflow)}</span></span>
              <span>Líquido <span className={cn('font-medium tabular-nums', selTotals.net >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{selTotals.net >= 0 ? '' : '−'}{formatBRL(Math.abs(selTotals.net))}</span></span>
            </div>
          ) : <div />}
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => { setCurrentPage(p => p - 1); setSelected(new Set()) }}>
                <ChevronLeft size={14} className="mr-1" />Anterior
              </Button>
              <span className="text-sm text-muted-foreground px-2">Página {currentPage} de {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => { setCurrentPage(p => p + 1); setSelected(new Set()) }}>
                Próxima<ChevronRight size={14} className="ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
