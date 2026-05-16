'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowUpDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { updateStagingRow, batchUpdateStaging, approveAndInsert } from '@/server/staging'
import type { TransactionStaging } from '@/db/schema/transactions-staging'
import type { Document } from '@/db/schema/documents'

const PAGE_SIZE = 50

const SOURCE_LABELS: Record<string, string> = {
  bank: 'Extrato bancário',
  erp: 'Relatório ERP',
  acquirer: 'Adquirente',
  credit_card: 'Fatura de cartão',
  sefaz: 'Nota fiscal',
  other: 'Outro',
}

type RowStatus = 'pending' | 'approved' | 'rejected'

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
  const [, startTransition] = useTransition()

  // Atualiza linhas quando initialData muda (após router.refresh)
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

  // Polling enquanto o documento está sendo processado
  useEffect(() => {
    if (!isProcessing) return
    const timer = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(timer)
  }, [isProcessing, router])

  // ─── Derivados ────────────────────────────────────────────────────────────
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const pendingCount = rows.filter(r => r.status === 'pending').length
  const approvedCount = rows.filter(r => r.status === 'approved').length
  const rejectedCount = rows.filter(r => r.status === 'rejected').length
  const toImportCount = pendingCount + approvedCount
  const allPageSelected = pageRows.length > 0 && pageRows.every(r => selected.has(r.id))
  const selectedCount = selected.size

  const sourceType = (doc.metadata as Record<string, unknown>)?.source_type as string

  // ─── Helpers de estado ────────────────────────────────────────────────────
  function patchRow(id: string, patch: Partial<Row>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function togglePageSelect() {
    if (allPageSelected) {
      setSelected(prev => {
        const next = new Set(prev)
        pageRows.forEach(r => next.delete(r.id))
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        pageRows.forEach(r => next.add(r.id))
        return next
      })
    }
  }

  // ─── Edição inline ────────────────────────────────────────────────────────
  function saveEdit() {
    if (!editCell) return
    const cell = editCell
    setEditCell(null)
    patchRow(cell.rowId, { [cell.field]: cell.value || null })
    updateStagingRow(cell.rowId, { [cell.field]: cell.value || null }).catch(() =>
      toast.error('Erro ao salvar alteração'),
    )
  }

  async function flipDirection(rowId: string) {
    const row = rows.find(r => r.id === rowId)
    if (!row) return
    const newDir = row.direction === 'inflow' ? 'outflow' : 'inflow'
    patchRow(rowId, { direction: newDir })
    await updateStagingRow(rowId, { direction: newDir })
  }

  // ─── Ações em lote ────────────────────────────────────────────────────────
  function handleBatch(action: 'approve' | 'reject' | 'flip') {
    const ids = Array.from(selected)
    if (ids.length === 0) return

    if (action === 'approve') {
      ids.forEach(id => patchRow(id, { status: 'approved' }))
    } else if (action === 'reject') {
      ids.forEach(id => patchRow(id, { status: 'rejected' }))
    } else {
      setRows(prev =>
        prev.map(r =>
          ids.includes(r.id)
            ? { ...r, direction: r.direction === 'inflow' ? 'outflow' : 'inflow' }
            : r,
        ),
      )
    }
    setSelected(new Set())

    startTransition(async () => {
      await batchUpdateStaging(documentId, ids, action)
    })
  }

  // ─── Importar ─────────────────────────────────────────────────────────────
  async function handleImport() {
    setImporting(true)
    try {
      const result = await approveAndInsert(documentId)

      // Reflete aprovação das pendentes no estado local
      setRows(prev =>
        prev.map(r => r.status === 'pending' ? { ...r, status: 'approved' } : r),
      )

      if (result.inserted > 0) {
        toast.success(
          `${result.inserted} transaç${result.inserted === 1 ? 'ão importada' : 'ões importadas'} com sucesso`,
        )
      } else if (result.total === 0) {
        toast.info('Todas as linhas já foram rejeitadas — nenhuma transação a importar.')
      } else {
        // inserted=0 mas havia linhas — provavelmente dados incompletos
        toast.warning(
          `Nenhuma transação importada. Verifique se as linhas têm data, valor e direção preenchidos.`,
        )
      }

      if (result.skipped > 0) {
        toast.warning(
          `${result.skipped} linha${result.skipped > 1 ? 's ignoradas' : ' ignorada'} por dados incompletos (sem data, valor ou direção).`,
        )
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao importar transações'
      toast.error(msg)
    } finally {
      setImporting(false)
    }
  }

  // ─── Estado: processando ──────────────────────────────────────────────────
  if (isProcessing) {
    return (
      <div className="space-y-4">
        <Link
          href="/upload"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Novo upload
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">Revisão de linhas</h1>
        <p className="text-sm text-muted-foreground">{doc.filename}</p>
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-8 justify-center">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">expert está processando o arquivo...</p>
        </div>
      </div>
    )
  }

  // ─── Estado: falha na extração ────────────────────────────────────────────
  if (doc.extractionStatus === 'failed') {
    return (
      <div className="space-y-4">
        <Link
          href="/upload"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Novo upload
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">Revisão de linhas</h1>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          Não foi possível extrair dados deste arquivo. Verifique se o formato é suportado e tente novamente.
        </div>
        <Button variant="outline" asChild>
          <Link href="/upload">Tentar outro arquivo</Link>
        </Button>
      </div>
    )
  }

  // ─── Estado: sem linhas ───────────────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Link
          href="/upload"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Novo upload
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
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div>
        <Link
          href="/upload"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft size={14} /> Novo upload
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">Revisão de linhas</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {doc.filename}
          {sourceType && SOURCE_LABELS[sourceType] ? ` · ${SOURCE_LABELS[sourceType]}` : ''}
        </p>
      </div>

      {/* Barra de resumo + paginação no topo */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap gap-6 text-sm">
          <span>
            <span className="font-semibold text-foreground">{rows.length}</span>{' '}
            <span className="text-muted-foreground">linhas</span>
          </span>
          <span>
            <span className="font-semibold text-amber-600">{pendingCount}</span>{' '}
            <span className="text-muted-foreground">pendentes</span>
          </span>
          <span>
            <span className="font-semibold text-emerald-600">{approvedCount}</span>{' '}
            <span className="text-muted-foreground">aprovadas</span>
          </span>
          {rejectedCount > 0 && (
            <span>
              <span className="font-semibold text-rose-600">{rejectedCount}</span>{' '}
              <span className="text-muted-foreground">rejeitadas</span>
            </span>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <span className="tabular-nums">
              {currentPage}/{totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage === 1}
              onClick={() => { setCurrentPage(p => p - 1); setSelected(new Set()) }}
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage === totalPages}
              onClick={() => { setCurrentPage(p => p + 1); setSelected(new Set()) }}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </div>

      {/* Toolbar de ações em lote */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
          <span className="text-sm font-medium">
            {selectedCount} selecionada{selectedCount > 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => handleBatch('approve')}>
              Aprovar
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBatch('reject')}>
              Rejeitar
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBatch('flip')}>
              <ArrowUpDown size={13} className="mr-1" />
              Inverter direção
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-muted-foreground"
          >
            Limpar seleção
          </Button>
        </div>
      )}

      {/* Tabela */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={togglePageSelect}
                  className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                  aria-label="Selecionar página"
                />
              </th>
              <th className="px-3 py-3 text-left font-medium text-muted-foreground w-10">#</th>
              <th className="px-3 py-3 text-left font-medium text-muted-foreground">Data</th>
              <th className="px-3 py-3 text-right font-medium text-muted-foreground">Valor</th>
              <th className="px-3 py-3 text-left font-medium text-muted-foreground">Direção</th>
              <th className="px-3 py-3 text-left font-medium text-muted-foreground">Descrição</th>
              <th className="px-3 py-3 text-left font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(row => (
              <tr
                key={row.id}
                className={cn(
                  'border-b last:border-0 transition-colors',
                  selected.has(row.id) ? 'bg-primary/5' : 'hover:bg-muted/20',
                )}
              >
                {/* Checkbox */}
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleSelect(row.id)}
                    className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                    aria-label={`Selecionar linha ${row.rowIndex + 1}`}
                  />
                </td>

                {/* Índice */}
                <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                  {row.rowIndex + 1}
                </td>

                {/* Data */}
                <td className="px-3 py-2.5">
                  {editCell?.rowId === row.id && editCell.field === 'date' ? (
                    <Input
                      type="date"
                      value={editCell.value}
                      onChange={e =>
                        setEditCell(c => (c ? { ...c, value: e.target.value } : c))
                      }
                      onBlur={saveEdit}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveEdit()
                        if (e.key === 'Escape') setEditCell(null)
                      }}
                      className="h-7 w-36 text-sm"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() =>
                        setEditCell({ rowId: row.id, field: 'date', value: row.date ?? '' })
                      }
                      className="tabular-nums text-left hover:text-primary transition-colors"
                    >
                      {formatDate(row.date)}
                    </button>
                  )}
                </td>

                {/* Valor */}
                <td className="px-3 py-2.5 text-right">
                  {editCell?.rowId === row.id && editCell.field === 'amount' ? (
                    <Input
                      type="number"
                      value={editCell.value}
                      onChange={e =>
                        setEditCell(c => (c ? { ...c, value: e.target.value } : c))
                      }
                      onBlur={saveEdit}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveEdit()
                        if (e.key === 'Escape') setEditCell(null)
                      }}
                      className="h-7 w-32 text-sm text-right"
                      autoFocus
                      step="0.01"
                      min="0"
                    />
                  ) : (
                    <button
                      onClick={() =>
                        setEditCell({
                          rowId: row.id,
                          field: 'amount',
                          value: row.amount ?? '',
                        })
                      }
                      className="tabular-nums hover:text-primary transition-colors"
                    >
                      {formatAmount(row.amount)}
                    </button>
                  )}
                </td>

                {/* Direção — clique inverte */}
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => flipDirection(row.id)}
                    title="Clique para inverter"
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                      row.direction === 'inflow'
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        : row.direction === 'outflow'
                          ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    <ArrowUpDown size={10} />
                    {row.direction === 'inflow'
                      ? 'Entrada'
                      : row.direction === 'outflow'
                        ? 'Saída'
                        : '—'}
                  </button>
                </td>

                {/* Descrição */}
                <td className="px-3 py-2.5 max-w-xs">
                  {editCell?.rowId === row.id && editCell.field === 'description' ? (
                    <Input
                      value={editCell.value}
                      onChange={e =>
                        setEditCell(c => (c ? { ...c, value: e.target.value } : c))
                      }
                      onBlur={saveEdit}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveEdit()
                        if (e.key === 'Escape') setEditCell(null)
                      }}
                      className="h-7 text-sm"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() =>
                        setEditCell({
                          rowId: row.id,
                          field: 'description',
                          value: row.description ?? '',
                        })
                      }
                      className="text-left max-w-xs truncate hover:text-primary transition-colors"
                      title={row.description ?? ''}
                    >
                      {row.description || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </button>
                  )}
                </td>

                {/* Status */}
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                      row.status === 'approved' && 'bg-emerald-100 text-emerald-700',
                      row.status === 'rejected' && 'bg-rose-100 text-rose-700',
                      row.status === 'pending' && 'bg-amber-100 text-amber-700',
                    )}
                  >
                    {row.status === 'approved'
                      ? 'Aprovada'
                      : row.status === 'rejected'
                        ? 'Rejeitada'
                        : 'Pendente'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {currentPage} de {totalPages} · {rows.length} linhas
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage === 1}
              onClick={() => { setCurrentPage(p => p - 1); setSelected(new Set()) }}
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage === totalPages}
              onClick={() => { setCurrentPage(p => p + 1); setSelected(new Set()) }}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Botão de importação */}
      <div className="flex items-center justify-between border-t pt-4">
        <p className="text-sm text-muted-foreground">
          {rejectedCount > 0
            ? `${rejectedCount} linha${rejectedCount > 1 ? 's rejeitadas' : ' rejeitada'} serão ignoradas.`
            : 'Rejeite linhas indesejadas antes de confirmar.'}
        </p>
        <Button
          onClick={handleImport}
          disabled={importing || toImportCount === 0}
          size="lg"
        >
          {importing ? (
            <span className="flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              Importando...
            </span>
          ) : (
            `Confirmar e importar ${toImportCount} transaç${toImportCount === 1 ? 'ão' : 'ões'}`
          )}
        </Button>
      </div>
    </div>
  )
}
