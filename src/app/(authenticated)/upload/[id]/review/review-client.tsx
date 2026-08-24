'use client'

import { useState, useEffect, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowUpDown, ChevronLeft, ChevronRight, Loader2, CheckCircle2, X, CopyCheck, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  updateStagingRow, batchUpdateStaging, approveAndInsert,
  setAllPendingDirection, setAllPendingEffectiveDate,
} from '@/server/staging'
import { AccountHeader, type ContaDoArquivo } from './account-header'
import type { TransactionStaging } from '@/db/schema/transactions-staging'
import type { Document } from '@/db/schema/documents'

const PAGE_SIZE = 100

const SOURCE_LABELS: Record<string, string> = {
  bank: 'Extrato bancário',
  erp: 'Relatório ERP',
  acquirer: 'Adquirente',
  credit_card: 'Fatura de cartão',
  sefaz: 'Nota fiscal',
  balance_sheet: 'Balanço Patrimonial',
  other: 'Outro',
}

type RowStatus = 'pending' | 'approved' | 'rejected'
type DirFilter = 'all' | 'inflow' | 'outflow'
type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected'

interface Row {
  id: string
  rowIndex: number
  date: string | null
  effectiveDate: string | null
  amount: string | null
  direction: string | null
  description: string | null
  status: RowStatus
}

interface EditCell {
  rowId: string
  field: 'date' | 'effectiveDate' | 'amount' | 'description'
  value: string
}

interface ResumoImportacao {
  aInserir: number
  duplicadas: number
  recusadas: { rowIndex: number; descricao: string; motivo: string }[]
  totalRecusadas: number
  deduplicando: boolean
  tipoDeRelatorio: 'movimentos' | 'balanco'
  dataDeReferencia: string | null
  folhasBp: number
  erro: string | null
}

interface Props {
  documentId: string
  contasExistentes: { nome: string; rotulo: string }[]
  initialData: {
    document: Document
    rows: TransactionStaging[]
    importedCount: number
    resumo: ResumoImportacao
    conta: ContaDoArquivo | null
  }
}

function toRow(r: TransactionStaging): Row {
  return {
    id: r.id,
    rowIndex: r.rowIndex,
    date: r.date,
    effectiveDate: r.effectiveDate,
    amount: r.amount,
    direction: r.direction,
    description: r.description,
    status: (r.status ?? 'pending') as RowStatus,
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

export default function ReviewClient({ documentId, initialData, contasExistentes }: Props) {
  const router = useRouter()
  const doc = initialData.document
  const resumo = initialData.resumo
  // O balanço é fotografia por documento, não lista de movimentos: a linha é
  // conta + saldo. Data e sentido vêm do ARQUIVO, então as colunas somem em vez
  // de repetir a mesma data em 100% das linhas e exibir "Entrada" sem sentido.
  const isBp = resumo.tipoDeRelatorio === 'balanco'
  const isProcessing = doc.extractionStatus !== 'completed' && doc.extractionStatus !== 'failed'

  const [rows, setRows] = useState<Row[]>(() => initialData.rows.map(toRow))
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
    setRows(initialData.rows.map(toRow))
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
  const noDirectionCount = isBp ? 0 : rows.filter(r => r.status !== 'rejected' && !r.direction).length
  const noCashDateCount  = isBp ? 0 : rows.filter(r => r.status !== 'rejected' && !r.effectiveDate).length
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

  async function handleSetAllCashDate(effectiveDate: string) {
    if (!effectiveDate) return
    setRows(prev => prev.map(r =>
      r.status !== 'rejected' && !r.effectiveDate ? { ...r, effectiveDate } : r,
    ))
    try {
      const result = await setAllPendingEffectiveDate(documentId, effectiveDate)
      if ('error' in result && result.error) { toast.error(result.error); router.refresh(); return }
      toast.success(`${result.updated} linha${result.updated === 1 ? '' : 's'} com data de caixa preenchida.`)
      router.refresh()
    } catch {
      toast.error('Erro ao preencher a data de caixa.')
      router.refresh()
    }
  }

  async function handleImport() {
    setImporting(true)
    try {
      const result = await approveAndInsert(documentId)
      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }
      const inserted = result.inserted ?? 0
      const skipped = result.skipped ?? 0
      const duplicadas = result.duplicadas ?? 0

      setRows(prev => prev.map(r => r.status === 'pending' ? { ...r, status: 'approved' } : r))
      if (inserted > 0) setIsImported(true)
      if (inserted > 0) {
        toast.success(`${inserted} ${isBp ? (inserted === 1 ? 'linha de balanço importada' : 'linhas de balanço importadas') : (inserted === 1 ? 'transação importada' : 'transações importadas')} com sucesso`)
        if (result.csvMatched && result.csvMatched > 0) {
          toast.info(
            `${result.csvMatched} ${result.csvMatched === 1 ? 'linha foi classificada' : 'linhas foram classificadas'} automaticamente pelo plano de contas do arquivo.`,
            { duration: 8000 },
          )
        }
      } else if (result.total === 0) {
        toast.info('Todas as linhas já foram rejeitadas — nenhuma transação a importar.')
      } else if (duplicadas > 0) {
        // O DoD literal da Sessão 2.8 do guia: subir o mesmo arquivo duas vezes
        // dá 0 inserções na segunda. Dizer isso em voz alta é o que separa
        // "funcionou" de "não fez nada".
        toast.info(
          `Nada novo a importar — ${duplicadas === 1 ? 'a linha já estava' : `as ${duplicadas} linhas já estavam`} no sistema.`,
          { duration: 8000 },
        )
      } else {
        toast.warning('Nenhuma transação importada. Verifique os avisos acima.')
      }
      if (duplicadas > 0 && inserted > 0) {
        toast.info(`${duplicadas} linha${duplicadas === 1 ? '' : 's'} ignorada${duplicadas === 1 ? '' : 's'} por já existir${duplicadas === 1 ? '' : 'em'} no sistema.`, { duration: 8000 })
      }
      if (skipped > 0) {
        const motivos = (result.recusadas ?? []).slice(0, 3).map(r => r.motivo)
        const unicos = Array.from(new Set(motivos))
        toast.warning(
          `${skipped} linha${skipped > 1 ? 's ignoradas' : ' ignorada'}${unicos.length > 0 ? `: ${unicos.join(' · ')}` : ''}`,
          { duration: 10000 },
        )
      }
      if (inserted > 0 && result.categorizationDispatched === false) {
        toast.warning(
          `${inserted} transações importadas, mas a categorização não foi iniciada. Vá em /transações e clique em "Categorizar agora".`,
          { duration: 15000 },
        )
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
          <h1 className="text-2xl font-semibold text-foreground">
            {isBp ? 'Revisão do balanço' : 'Revisão de linhas'}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {doc.filename}{sourceType && SOURCE_LABELS[sourceType] ? ` · ${SOURCE_LABELS[sourceType]}` : ''}
            {/* A data de referência é do ARQUIVO. Ela aparece uma vez aqui em vez
                de repetida em cada linha, e é ela que vira a coluna de /balanco. */}
            {isBp && resumo.dataDeReferencia ? ` · Saldos em ${formatDate(resumo.dataDeReferencia)}` : ''}
          </p>
        </div>
        <div className="shrink-0 pt-1">
          {isImported ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 size={15} className="shrink-0" />
              <span className="font-medium">
                {approvedCount} {isBp
                  ? `linha${approvedCount !== 1 ? 's' : ''} de balanço importada${approvedCount !== 1 ? 's' : ''}`
                  : `transaç${approvedCount !== 1 ? 'ões importadas' : 'ão importada'}`}.
              </span>
              <Button size="sm" variant="outline" className="ml-1 border-emerald-300 text-emerald-700 hover:bg-emerald-100" asChild>
                <Link href={isBp ? '/balanco' : '/transacoes'}>{isBp ? 'Ver Balanço' : 'Ver Transações'}</Link>
              </Button>
            </div>
          ) : (
            <Button onClick={handleImport} disabled={importing || toImportCount === 0}>
              {importing ? (
                <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Importando...</span>
              ) : isBp ? (
                `Confirmar e importar ${toImportCount} linha${toImportCount === 1 ? '' : 's'}`
              ) : (
                `Confirmar e importar ${toImportCount} transaç${toImportCount === 1 ? 'ão' : 'ões'}`
              )}
            </Button>
          )}
        </div>
      </div>

      {/* ── Zona 2: Totalizador + stats ─────────────────────────────────────── */}
      <div className="shrink-0 flex flex-wrap items-center gap-4 px-6 pb-3 text-xs text-muted-foreground">
        {isBp ? (
          <span>Total <span className="font-medium text-foreground tabular-nums">{formatBRL(totalInflow)}</span></span>
        ) : (
          <>
            <span>Entradas <span className="font-medium text-emerald-600 tabular-nums">{formatBRL(totalInflow)}</span></span>
            <span>Saídas <span className="font-medium text-rose-600 tabular-nums">{formatBRL(totalOutflow)}</span></span>
            <span>Líquido <span className={cn('font-medium tabular-nums', netBalance >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{netBalance >= 0 ? '' : '−'}{formatBRL(Math.abs(netBalance))}</span></span>
          </>
        )}
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

      {/* ── Zona 2.2: A conta do arquivo ────────────────────────────────────── */}
      <AccountHeader
        documentId={documentId}
        conta={initialData.conta}
        contasExistentes={contasExistentes}
        totalLinhas={rows.length}
        readOnly={isImported}
      />

      {/* ── Zona 2.25: Balanço sem plano patrimonial ────────────────────────── */}
      {/* Medido em 24/ago: `seed_categories_for_org` não cria uma única natureza
          de BP. Sem elas o arquivo importa e `/balanco` continua vazio, porque
          `getBpData` soma por tipo de categoria e ignora linha sem natureza. É
          o tipo de sucesso silencioso que faz perder uma tarde. */}
      {!isImported && isBp && resumo.folhasBp === 0 && (
        <div className="shrink-0 mx-6 mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-700" />
          <span className="text-amber-900">
            Esta organização ainda não tem <span className="font-medium">nenhuma natureza de Balanço</span> no
            plano de contas. As linhas serão importadas, mas entrarão sem classificação e a tela de
            Balanço continuará vazia. Crie as naturezas patrimoniais em{' '}
            <Link href="/configuracoes/categorias" className="font-medium underline underline-offset-2">
              Configurações → Plano de contas
            </Link>{' '}
            antes de importar.
          </span>
        </div>
      )}

      {/* ── Zona 2.3: Duplicadas ────────────────────────────────────────────── */}
      {/* O caminho de upload NUNCA deduplicou: subir o mesmo extrato duas vezes
          dobrava a contabilidade, e sempre dobrou. Dizer o número ANTES do clique
          é o que transforma a dedup de silenciosa em verificável. */}
      {!isImported && resumo.duplicadas > 0 && (
        <div className="shrink-0 mx-6 mb-3 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
          <CopyCheck size={15} className="mt-0.5 shrink-0 text-sky-700" />
          <span className="text-sky-900">
            <span className="font-medium">{resumo.duplicadas}</span> {resumo.duplicadas === 1 ? 'linha já existe' : 'linhas já existem'} no
            sistema e {resumo.duplicadas === 1 ? 'será ignorada' : 'serão ignoradas'} — {resumo.aInserir === 0
              ? 'nada novo a importar neste arquivo.'
              : `${resumo.aInserir} ${resumo.aInserir === 1 ? 'entrará' : 'entrarão'}.`}
          </span>
        </div>
      )}

      {/* ── Zona 2.4: Linhas que o contrato recusou ─────────────────────────── */}
      {!isImported && resumo.totalRecusadas > 0 && (
        <div className="shrink-0 mx-6 mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-700" />
          <div className="text-amber-900">
            <span className="font-medium">{resumo.totalRecusadas}</span> linha{resumo.totalRecusadas === 1 ? '' : 's'} não {resumo.totalRecusadas === 1 ? 'será importada' : 'serão importadas'}:
            <ul className="mt-1 space-y-0.5 text-xs">
              {Array.from(new Set(resumo.recusadas.map(r => r.motivo))).slice(0, 4).map(motivo => (
                <li key={motivo}>
                  · {motivo}{' '}
                  <span className="opacity-70">
                    (linha{resumo.recusadas.filter(r => r.motivo === motivo).length === 1 ? '' : 's'}{' '}
                    {resumo.recusadas.filter(r => r.motivo === motivo).slice(0, 8).map(r => r.rowIndex + 1).join(', ')}
                    {resumo.recusadas.filter(r => r.motivo === motivo).length > 8 ? '…' : ''})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Zona 2.45: Data de caixa em lote ────────────────────────────────── */}
      {/* O caso é a fatura de cartão, e é o princípio 13: a competência é a data
          de cada compra, o caixa é o vencimento da fatura — o MESMO para todas.
          Sem isto, a compra sai do fluxo no dia da compra e o pagamento da fatura
          sai de novo. */}
      {!isImported && !isBp && noCashDateCount > 0 && (
        <div className="shrink-0 mx-6 mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{noCashDateCount}</span> linha{noCashDateCount === 1 ? '' : 's'} sem
            data de caixa — {noCashDateCount === 1 ? 'entrará' : 'entrarão'} no fluxo pela data de competência.
            {sourceType === 'credit_card' && <span className="ml-1">Numa fatura, o caixa é o vencimento.</span>}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="caixa-lote" className="text-xs text-muted-foreground">Preencher todas com</label>
            <Input
              id="caixa-lote" type="date" className="h-7 w-36 text-sm"
              onChange={e => { if (e.target.value) handleSetAllCashDate(e.target.value) }}
            />
          </div>
        </div>
      )}

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
                {/* No balanço não há coluna de data: a data é do ARQUIVO e está
                    no cabeçalho. Repeti-la em 100% das linhas seria ruído. */}
                {!isBp && <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-28">Competência</th>}
                {!isBp && <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-32">Data de caixa</th>}
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground w-32">{isBp ? 'Saldo' : 'Valor'}</th>
                {/* Direção — filtro no header. Some no balanço: quem dá o lado é
                    a natureza, e a coluna ficaria presa em "Entrada". */}
                {!isBp && (
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
                )}
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{isBp ? 'Conta' : 'Descrição'}</th>
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
                  <td colSpan={9} className="px-6 py-12 text-center text-sm text-muted-foreground">
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

                  {/* Competência */}
                  {!isBp && (
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
                  )}

                  {/* Data de caixa — vazia significa IGUAL à competência, e é
                      isso que a célula diz. Repetir a data seria mentir sobre o
                      que o arquivo trouxe, e esconderia que ninguém informou. */}
                  {!isBp && (
                    <td className="px-3 py-2.5">
                      {!isImported && editCell?.rowId === row.id && editCell.field === 'effectiveDate' ? (
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
                          onClick={() => !isImported && setEditCell({ rowId: row.id, field: 'effectiveDate', value: row.effectiveDate ?? '' })}
                          className={cn('text-left', !isImported && 'hover:text-primary transition-colors')}
                          title={row.effectiveDate ? undefined : 'Sem data de caixa — o fluxo usa a competência'}
                        >
                          {row.effectiveDate
                            ? <span className="tabular-nums">{formatDate(row.effectiveDate)}</span>
                            : <span className="text-xs text-muted-foreground">= competência</span>}
                        </button>
                      )}
                    </td>
                  )}

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
                  {!isBp && (
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
                  )}

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
