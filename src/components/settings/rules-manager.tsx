'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Pencil, Trash2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/states/empty-state'
import { ColHeader } from '@/components/transacoes-shared/col-header'
import { MultiSelectFilter, DescFilter } from '@/components/transacoes-shared/filters'
import { CATEGORY_TYPE_LABELS } from '@/components/transacoes-shared/types'
import type {
  CategoryItem, SimpleDimensionItem,
  DimensionOption, GroupedDimensionOption,
} from '@/components/transacoes-shared/types'
import { Checkbox } from '@/components/ui/checkbox'
import { RuleEditDialog, type RuleInitialValues, type AccountOption } from './rule-edit-dialog'
import { deleteRule, deleteRules, type RuleRow, type RulesListResult } from '@/server/categorization-rules'

interface SearchParams {
  page?: string
  q?: string
  accounts?: string
  categories?: string
}

interface Props {
  data: RulesListResult
  categories: CategoryItem[]
  costCenters: SimpleDimensionItem[]
  businessUnits: SimpleDimensionItem[]
  legalEntities: SimpleDimensionItem[]
  contacts: SimpleDimensionItem[]
  accounts: AccountOption[]
  searchParams: SearchParams
}

const FILTER_KEYS = ['page', 'q', 'accounts', 'categories'] as const

const EMPTY_INITIAL: RuleInitialValues = {
  description: '',
  accountId: null,
  targetCategoryId: null,
  targetCostCenterId: null,
  targetBusinessUnitId: null,
  targetLegalEntityId: null,
  targetContactId: null,
}

export function RulesManager({
  data, categories, costCenters, businessUnits, legalEntities, contacts, accounts, searchParams,
}: Props) {
  const router = useRouter()
  const [, startNav] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [dialogInitial, setDialogInitial] = useState<RuleInitialValues>(EMPTY_INITIAL)
  const [deleteTarget, setDeleteTarget] = useState<RuleRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)

  function updateFilters(updates: Record<string, string | undefined>) {
    // Trocar de página ou filtro descarta a seleção: o "apagar selecionadas"
    // age sobre o que está VISÍVEL, nunca sobre linhas que saíram da tela.
    setSelectedIds(new Set())
    const current: Record<string, string> = {}
    for (const k of FILTER_KEYS) { if (searchParams[k]) current[k] = searchParams[k]! }
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) delete current[k]
      else current[k] = v
    }
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(current)) { if (v) params.set(k, v) }
    startNav(() => router.push(`/configuracoes/regras?${params.toString()}`))
  }

  function clearAllFilters() {
    setSelectedIds(new Set())
    startNav(() => router.push('/configuracoes/regras'))
  }

  // Seleção em lote — sempre relativa à página visível
  const allSelected = data.rows.length > 0 && data.rows.every(r => selectedIds.has(r.id))
  const someSelected = data.rows.some(r => selectedIds.has(r.id))

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(data.rows.map(r => r.id)))
  }

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const hasFilters = !!(searchParams.q || searchParams.accounts || searchParams.categories)

  // Filtros: opções
  const accountOptions: DimensionOption[] = useMemo(
    () => accounts.map(a => ({ id: a.accountId, label: a.label })),
    [accounts]
  )

  const categoryFilterGroups: GroupedDimensionOption[] = useMemo(() => {
    // Apenas leaf nodes (sem filhos) — mesma regra do /transacoes
    const parentIds = new Set(categories.map(c => c.parentId).filter((p): p is string => !!p))
    const leaves = categories.filter(c => !parentIds.has(c.id))
    const byType: Record<string, DimensionOption[]> = {}
    for (const c of leaves) {
      if (!byType[c.type]) byType[c.type] = []
      byType[c.type].push({ id: c.id, label: `${c.code ?? '—'} – ${c.name}` })
    }
    return Object.entries(byType).map(([type, items]) => ({ type, items }))
  }, [categories])

  // Helper para resolver labels
  const accountLabelMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of accounts) m.set(a.accountId, a.label)
    return m
  }, [accounts])

  function handleEdit(rule: RuleRow) {
    setDialogMode('edit')
    setDialogInitial({
      id: rule.id,
      description: rule.description,
      accountId: rule.accountId,
      targetCategoryId: rule.targetCategoryId,
      targetCostCenterId: rule.targetCostCenterId,
      targetBusinessUnitId: rule.targetBusinessUnitId,
      targetLegalEntityId: rule.targetLegalEntityId,
      targetContactId: rule.targetContactId,
    })
    setDialogOpen(true)
  }

  function handleCreate() {
    setDialogMode('create')
    setDialogInitial(EMPTY_INITIAL)
    setDialogOpen(true)
  }

  async function handleBatchDelete() {
    const ids = Array.from(selectedIds)
    setIsDeleting(true)
    try {
      const r = await deleteRules(ids)
      if ('error' in r && r.error) {
        toast.error(r.error)
      } else {
        toast.success(`${ids.length} regra${ids.length !== 1 ? 's' : ''} apagada${ids.length !== 1 ? 's' : ''}.`)
        setSelectedIds(new Set())
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao apagar.')
    } finally {
      setIsDeleting(false)
      setBatchDeleteOpen(false)
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await deleteRule(deleteTarget.id)
      // Sai também da seleção — senão o contador do lote mentiria sobre uma
      // linha que já não existe.
      setSelectedIds(prev => {
        if (!prev.has(deleteTarget.id)) return prev
        const next = new Set(prev)
        next.delete(deleteTarget.id)
        return next
      })
      toast.success('Regra apagada.')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao apagar.')
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
  }

  function onDialogSaved() {
    router.refresh()
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Zona 1 — Cabeçalho */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Regras de categorização</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Regras que o expert aplica antes de chamar o LLM. Editar aqui altera o que será atribuído na próxima categorização.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-xs">
              Limpar filtros
            </Button>
          )}
          <Button size="sm" onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-1" /> Nova regra
          </Button>
        </div>
      </div>

      {/* Zona 2 — Totalizador (regras encontradas) */}
      <div className="px-6 py-2 text-xs text-muted-foreground border-b shrink-0">
        {data.total === 0 ? 'Nenhuma regra' : `${data.total} regra${data.total !== 1 ? 's' : ''} ${hasFilters ? 'encontrada' + (data.total !== 1 ? 's' : '') : 'no total'}`}
      </div>

      {/* Zona 3 — Toolbar de lote (só com seleção) */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-6 py-2 border-b bg-muted/40 shrink-0">
          <span className="text-xs font-medium text-foreground">
            {selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <Button
            variant="outline" size="sm"
            className="h-7 text-xs text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700"
            onClick={() => setBatchDeleteOpen(true)}
            disabled={isDeleting}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Apagar selecionadas
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>
            Cancelar
          </Button>
        </div>
      )}

      {/* Zona 4 — Tabela */}
      <div className="flex-1 min-h-0 overflow-auto">
        {data.rows.length === 0 ? (
          <div className="flex items-center justify-center h-full p-6">
            <EmptyState
              title={hasFilters ? 'Nenhuma regra com esses filtros' : 'Nenhuma regra criada ainda'}
              description={hasFilters
                ? 'Ajuste ou limpe os filtros para ver as regras existentes.'
                : 'Classifique transações em /transacoes ou crie uma regra manual.'}
            />
          </div>
        ) : (
          <table className="w-full text-xs [&_td]:border-r [&_td]:border-border/20 [&_th]:border-r [&_th]:border-border/20 last:[&_td]:border-r-0 last:[&_th]:border-r-0">
            <thead className="bg-muted sticky top-0 z-10">
              <tr className="border-b">
                <th className="w-8 px-2 py-1">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                    aria-label="Selecionar todas as regras da página"
                  />
                </th>
                <th className="px-2 py-1 text-left min-w-[220px]">
                  <ColHeader hasValue={!!searchParams.q} onClear={() => updateFilters({ q: undefined, page: undefined })}>
                    <DescFilter value={searchParams.q} onUpdate={v => updateFilters({ q: v, page: undefined })} />
                  </ColHeader>
                </th>
                <th className="px-2 py-1 text-left w-[200px]">
                  <ColHeader hasValue={!!searchParams.accounts} onClear={() => updateFilters({ accounts: undefined, page: undefined })}>
                    <MultiSelectFilter
                      placeholder="Conta"
                      value={searchParams.accounts}
                      options={accountOptions}
                      onUpdate={v => updateFilters({ accounts: v, page: undefined })}
                      width="w-72"
                    />
                  </ColHeader>
                </th>
                <th className="px-2 py-1 text-left w-[220px]">
                  <ColHeader hasValue={!!searchParams.categories} onClear={() => updateFilters({ categories: undefined, page: undefined })}>
                    <MultiSelectFilter
                      placeholder="Categoria-alvo"
                      value={searchParams.categories}
                      options={[]}
                      grouped={categoryFilterGroups}
                      onUpdate={v => updateFilters({ categories: v, page: undefined })}
                      width="w-80"
                    />
                  </ColHeader>
                </th>
                <th className="px-2 py-1 text-left text-muted-foreground font-medium w-[140px]">C. custo</th>
                <th className="px-2 py-1 text-left text-muted-foreground font-medium w-[140px]">Un. negócio</th>
                <th className="px-2 py-1 text-left text-muted-foreground font-medium w-[140px]">Entidade</th>
                <th className="px-2 py-1 text-left text-muted-foreground font-medium w-[140px]">Contato</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map(rule => {
                const accountLabel = rule.accountId
                  ? (accountLabelMap.get(rule.accountId) ?? '—')
                  : null
                return (
                  <tr
                    key={rule.id}
                    className={`group border-b last:border-0 hover:bg-muted/20 transition-colors ${selectedIds.has(rule.id) ? 'bg-primary/5' : ''}`}
                  >
                    <td className="px-2 py-2">
                      <Checkbox
                        checked={selectedIds.has(rule.id)}
                        onCheckedChange={() => toggleOne(rule.id)}
                        aria-label={`Selecionar a regra ${rule.description}`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="text-xs text-foreground break-words">{rule.description}</div>
                      {rule.matchCount > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          aplicada {rule.matchCount}×
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {accountLabel ? (
                        <span className="text-xs">{accountLabel}</span>
                      ) : (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                          Todas as contas
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {rule.targetCategoryId ? (
                        <div className="flex flex-col">
                          <span className="text-xs">{rule.targetCategoryCode} – {rule.targetCategoryName}</span>
                          {rule.targetCategoryType && (
                            <span className="text-[10px] text-muted-foreground">
                              {CATEGORY_TYPE_LABELS[rule.targetCategoryType] ?? rule.targetCategoryType}
                            </span>
                          )}
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {rule.targetCostCenterName ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {rule.targetBusinessUnitName ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {rule.targetLegalEntityName ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {rule.targetContactName ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleEdit(rule)}
                          className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                          aria-label="Editar regra"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(rule)}
                          className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50"
                          aria-label="Apagar regra"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Zona 5 — Rodapé / paginação */}
      {data.pages > 1 && (
        <div className="flex items-center justify-end gap-2 px-6 py-2 border-t shrink-0">
          <span className="text-xs text-muted-foreground">Página {data.page} de {data.pages}</span>
          <Button
            variant="outline" size="sm"
            onClick={() => updateFilters({ page: data.page > 2 ? String(data.page - 1) : undefined })}
            disabled={data.page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => updateFilters({ page: String(data.page + 1) })}
            disabled={data.page >= data.pages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Dialog de edição/criação */}
      <RuleEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        initial={dialogInitial}
        categories={categories}
        costCenters={costCenters}
        businessUnits={businessUnits}
        legalEntities={legalEntities}
        contacts={contacts}
        accounts={accounts}
        onSaved={onDialogSaved}
      />

      {/* Confirmação de delete em lote */}
      <AlertDialog open={batchDeleteOpen} onOpenChange={(o) => { if (!o) setBatchDeleteOpen(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Apagar {selectedIds.size} regra{selectedIds.size !== 1 ? 's' : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Apagar não desfaz classificações já feitas — as regras só deixam de valer para as
              próximas categorizações.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleBatchDelete} disabled={isDeleting} className="bg-rose-600 hover:bg-rose-700">
              {isDeleting ? 'Apagando…' : 'Apagar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação de delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar regra?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  <span className="block">Descrição: <span className="font-medium text-foreground">{deleteTarget.description}</span></span>
                  {deleteTarget.matchCount > 0 && (
                    <span className="block mt-1 text-xs">Já foi aplicada {deleteTarget.matchCount}× — apagar não desfaz classificações anteriores.</span>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting} className="bg-rose-600 hover:bg-rose-700">
              {isDeleting ? 'Apagando…' : 'Apagar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
