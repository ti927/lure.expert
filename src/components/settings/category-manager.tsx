'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Plus, Pencil, Archive, ArchiveRestore, Trash2, Check, X,
  ChevronDown, ChevronRight, Tags,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/states/empty-state'

export type CategoryItem = {
  id: string
  code: string
  name: string
  type: string
  parentId: string | null
  isActive: boolean
  txCount: number
  createdAt: Date
  updatedAt: Date
}

const TYPE_LABELS: Record<string, string> = {
  // DRE
  receita_operacional:   'Receita Operacional',
  deducoes_tributarias:  'Deduções Tributárias',
  deducoes_operacionais: 'Deduções Operacionais',
  cpv:                   'CPV / CMV / CSP',
  sga:                   'SG&A',
  resultado_financeiro:  'Receitas & Despesas Financeiras',
  ir:                    'Impostos Sobre Renda',
  investimento:          'Investimentos & Amortizações',
  transfer:              'Transferências',
  // BP
  ativo_circulante:      'Ativo Circulante',
  ativo_nao_circulante:  'Ativo Não-Circulante',
  passivo_circulante:    'Passivo Circulante',
  passivo_nao_circulante:'Passivo Não-Circulante',
  patrimonio_liquido:    'Patrimônio Líquido',
}

const DRE_TYPES = [
  'receita_operacional', 'deducoes_tributarias', 'deducoes_operacionais',
  'cpv', 'sga', 'resultado_financeiro', 'ir', 'investimento', 'transfer',
]
const BP_TYPES = [
  'ativo_circulante', 'ativo_nao_circulante',
  'passivo_circulante', 'passivo_nao_circulante',
  'patrimonio_liquido',
]
const TYPE_ORDER = [...DRE_TYPES, ...BP_TYPES]

interface CategoryManagerProps {
  categories: CategoryItem[]
  onCreate: (formData: FormData) => Promise<{ success?: boolean; error?: string }>
  onUpdate: (id: string, formData: FormData) => Promise<{ success?: boolean; error?: string }>
  onToggleActive: (id: string, isActive: boolean) => Promise<{ success?: boolean; error?: string }>
  onDelete: (id: string) => Promise<{ success?: boolean; error?: string }>
}

type TreeNode = CategoryItem & { children: TreeNode[] }

function buildTree(flat: CategoryItem[], parentId: string | null = null): TreeNode[] {
  return flat
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((c) => ({ ...c, children: buildTree(flat, c.id) }))
}

export function CategoryManager({
  categories,
  onCreate,
  onUpdate,
  onToggleActive,
  onDelete,
}: CategoryManagerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [showArchived, setShowArchived] = useState(false)
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CategoryItem | null>(null)

  const visibleCategories = showArchived ? categories : categories.filter((c) => c.isActive)
  const archivedCount = categories.filter((c) => !c.isActive).length

  const byType: Record<string, TreeNode[]> = {}
  for (const type of TYPE_ORDER) {
    const typeItems = visibleCategories.filter((c) => c.type === type)
    byType[type] = buildTree(typeItems)
  }

  function toggleTypeCollapse(type: string) {
    setCollapsedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      const result = await onCreate(formData)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Categoria criada.')
        setShowCreateDialog(false)
        router.refresh()
      }
    })
  }

  function handleUpdate(id: string, formData: FormData) {
    startTransition(async () => {
      const result = await onUpdate(id, formData)
      if (result.error) {
        toast.error(result.error)
      } else {
        setEditingId(null)
        router.refresh()
      }
    })
  }

  function handleToggleActive(item: CategoryItem) {
    startTransition(async () => {
      const result = await onToggleActive(item.id, !item.isActive)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(item.isActive ? 'Arquivada.' : 'Reativada.')
        router.refresh()
      }
    })
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await onDelete(deleteTarget.id)
      if (result.error) {
        toast.error(result.error)
        setDeleteTarget(null)
      } else {
        toast.success('Categoria deletada.')
        setDeleteTarget(null)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <Button size="sm" onClick={() => setShowCreateDialog(true)} disabled={isPending}>
          <Plus className="h-4 w-4 mr-1" />
          Nova natureza
        </Button>

        {archivedCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowArchived((v) => !v)}
          >
            <Archive className="h-4 w-4 mr-1" />
            {showArchived ? 'Ocultar arquivadas' : `Mostrar arquivadas (${archivedCount})`}
          </Button>
        )}
      </div>

      {/* Árvore por tipo */}
      {categories.length === 0 ? (
        <EmptyState
          icon={<Tags className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Nenhuma categoria cadastrada"
          description='Clique em "Nova categoria" para começar.'
        />
      ) : (
        <div className="space-y-4">
          {([['DRE', DRE_TYPES], ['Balanço Patrimonial', BP_TYPES]] as [string, string[]][]).map(([sectionLabel, sectionTypes]) => {
            const hasAny = sectionTypes.some(t => (byType[t]?.length ?? 0) > 0)
            if (!hasAny) return null
            return (
              <div key={sectionLabel}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1">
                  {sectionLabel}
                </p>
                <div className="space-y-2">
                  {sectionTypes.map((type) => {
                    const nodes = byType[type]
                    if (!nodes || nodes.length === 0) return null
                    const isCollapsed = collapsedTypes.has(type)

                    return (
                      <div key={type} className="border rounded-lg overflow-hidden">
                        <button
                          type="button"
                          className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/60 text-left transition-colors"
                          onClick={() => toggleTypeCollapse(type)}
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="text-sm font-semibold text-foreground">
                            {TYPE_LABELS[type] ?? type}
                          </span>
                          <span className="text-xs text-muted-foreground ml-1">({nodes.length})</span>
                        </button>

                        {!isCollapsed && (
                          <div className="divide-y">
                            {nodes.map((node) => (
                              <CategoryNodeRow
                                key={node.id}
                                node={node}
                                depth={0}
                                editingId={editingId}
                                isPending={isPending}
                                onEditRequest={setEditingId}
                                onCancelEdit={() => setEditingId(null)}
                                onUpdateRequest={handleUpdate}
                                onToggleActiveRequest={handleToggleActive}
                                onDeleteRequest={setDeleteTarget}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <CreateCategoryDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        categories={categories}
        onSubmit={handleCreate}
        isPending={isPending}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar categoria?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar <strong>{deleteTarget?.name}</strong>?{' '}
              {deleteTarget?.txCount && deleteTarget.txCount > 0 ? (
                <>
                  Esta categoria possui <strong>{deleteTarget.txCount} transação(ões)</strong>{' '}
                  vinculadas e não pode ser deletada. Archive-a em vez disso.
                </>
              ) : (
                'Esta ação não pode ser desfeita.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {(!deleteTarget?.txCount || deleteTarget.txCount === 0) && (
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Deletar
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Node recursivo ──────────────────────────────────────────────────────────

interface NodeRowProps {
  node: TreeNode
  depth: number
  editingId: string | null
  isPending: boolean
  onEditRequest: (id: string) => void
  onCancelEdit: () => void
  onUpdateRequest: (id: string, formData: FormData) => void
  onToggleActiveRequest: (item: CategoryItem) => void
  onDeleteRequest: (item: CategoryItem) => void
}

function CategoryNodeRow({
  node,
  depth,
  editingId,
  isPending,
  onEditRequest,
  onCancelEdit,
  onUpdateRequest,
  onToggleActiveRequest,
  onDeleteRequest,
}: NodeRowProps) {
  const isEditing = editingId === node.id
  const indent = depth * 20

  return (
    <>
      {isEditing ? (
        <form
          action={(fd) => onUpdateRequest(node.id, fd)}
          className="flex gap-2 items-center px-3 py-2 bg-muted/20"
          style={{ paddingLeft: `${12 + indent}px` }}
        >
          <Input name="name" defaultValue={node.name} className="h-8 flex-1" autoFocus required />
          <Input name="code" defaultValue={node.code} className="h-8 w-24" required />
          <Button type="submit" size="sm" variant="ghost" disabled={isPending}>
            <Check className="h-4 w-4 text-emerald-600" />
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancelEdit}>
            <X className="h-4 w-4" />
          </Button>
        </form>
      ) : (
        <div
          className={`flex items-center gap-3 px-3 py-2 ${!node.isActive ? 'opacity-60' : ''}`}
          style={{ paddingLeft: `${12 + indent}px` }}
        >
          {depth > 0 && (
            <span className="text-muted-foreground/40 text-xs select-none">└</span>
          )}
          <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">{node.code}</span>
          <span className="flex-1 text-sm text-foreground truncate">{node.name}</span>

          {node.txCount > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">{node.txCount} tx</span>
          )}
          {!node.isActive && (
            <Badge variant="secondary" className="text-xs shrink-0">Arquivada</Badge>
          )}

          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm" variant="ghost" className="h-7 w-7 p-0"
              onClick={() => onEditRequest(node.id)}
              title="Editar"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm" variant="ghost" className="h-7 w-7 p-0"
              onClick={() => onToggleActiveRequest(node)}
              title={node.isActive ? 'Arquivar' : 'Reativar'}
              disabled={isPending}
            >
              {node.isActive ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              onClick={() => onDeleteRequest(node)}
              title="Deletar"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {node.children.map((child) => (
        <CategoryNodeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          editingId={editingId}
          isPending={isPending}
          onEditRequest={onEditRequest}
          onCancelEdit={onCancelEdit}
          onUpdateRequest={onUpdateRequest}
          onToggleActiveRequest={onToggleActiveRequest}
          onDeleteRequest={onDeleteRequest}
        />
      ))}
    </>
  )
}

// ─── Dialog criar categoria ──────────────────────────────────────────────────

function CreateCategoryDialog({
  open,
  onClose,
  categories,
  onSubmit,
  isPending,
}: {
  open: boolean
  onClose: () => void
  categories: CategoryItem[]
  onSubmit: (formData: FormData) => void
  isPending: boolean
}) {
  const [level, setLevel] = useState<'pai' | 'filho'>('filho')
  const [selectedType, setSelectedType] = useState<string>('')
  const [selectedParentId, setSelectedParentId] = useState<string>('')
  const formRef = useRef<HTMLFormElement>(null)

  // Naturezas Pai disponíveis (sem parent_id): filtradas por tipo quando criando Filho
  const rootCategories = categories.filter((c) => c.parentId === null && c.isActive)
  const parentOptions = level === 'filho' && selectedType
    ? rootCategories.filter((c) => c.type === selectedType)
    : rootCategories

  // Tipo efetivo: se Filho, herdado do pai selecionado; se Pai, selecionado manualmente
  const parentCategory = rootCategories.find((c) => c.id === selectedParentId)
  const effectiveType = level === 'filho' ? (parentCategory?.type ?? selectedType) : selectedType

  function handleLevelChange(next: 'pai' | 'filho') {
    setLevel(next)
    setSelectedParentId('')
    if (next === 'pai') setSelectedType('')
  }

  function handleParentChange(parentId: string) {
    setSelectedParentId(parentId)
    const parent = rootCategories.find((c) => c.id === parentId)
    if (parent) setSelectedType(parent.type)
  }

  function handleSubmit(formData: FormData) {
    onSubmit(formData)
    formRef.current?.reset()
    setLevel('filho')
    setSelectedType('')
    setSelectedParentId('')
  }

  const canSubmit = !isPending && !!effectiveType && (level === 'pai' || !!selectedParentId)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova natureza</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="space-y-4 mt-2">
          {/* Nível: Pai ou Filho */}
          <div>
            <Label>Nível</Label>
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => handleLevelChange('pai')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm text-center transition-colors ${
                  level === 'pai'
                    ? 'border-primary bg-primary/5 text-primary font-medium'
                    : 'border-input text-muted-foreground hover:border-muted-foreground'
                }`}
              >
                Natureza Pai
              </button>
              <button
                type="button"
                onClick={() => handleLevelChange('filho')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm text-center transition-colors ${
                  level === 'filho'
                    ? 'border-primary bg-primary/5 text-primary font-medium'
                    : 'border-input text-muted-foreground hover:border-muted-foreground'
                }`}
              >
                Natureza Filho
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {level === 'pai'
                ? 'Agrupamento. Não pode ser atribuído diretamente a transações.'
                : 'Classificação final. Atribuído às transações.'}
            </p>
          </div>

          {/* Tipo (Pai: manual; Filho: herdado do pai selecionado) */}
          {level === 'pai' ? (
            <div>
              <Label htmlFor="cat-type">Tipo da Natureza</Label>
              <Select name="type" value={selectedType} onValueChange={setSelectedType} required>
                <SelectTrigger id="cat-type" className="mt-1">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">DRE</div>
                  {DRE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                  ))}
                  <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-1">Balanço Patrimonial</div>
                  {BP_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label htmlFor="cat-parent">Natureza Pai <span className="text-destructive">*</span></Label>
              <Select
                name="parentId"
                value={selectedParentId}
                onValueChange={handleParentChange}
                required
              >
                <SelectTrigger id="cat-parent" className="mt-1">
                  <SelectValue placeholder="Selecione a Natureza Pai" />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_ORDER.filter(t => rootCategories.some(c => c.type === t)).map((t) => {
                    const options = rootCategories.filter(c => c.type === t)
                    if (options.length === 0) return null
                    return (
                      <div key={t}>
                        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          {TYPE_LABELS[t] ?? t}
                        </div>
                        {options.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.code} — {c.name}
                          </SelectItem>
                        ))}
                      </div>
                    )
                  })}
                </SelectContent>
              </Select>
              {/* Hidden field para manter o type no FormData */}
              <input type="hidden" name="type" value={effectiveType} />
            </div>
          )}

          {/* Nome e Código */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="cat-name">Nome</Label>
              <Input id="cat-name" name="name" className="mt-1" placeholder={level === 'pai' ? 'Ex: Despesas com Pessoal' : 'Ex: Salários'} required />
            </div>
            <div>
              <Label htmlFor="cat-code">Código</Label>
              <Input id="cat-code" name="code" className="mt-1" placeholder={level === 'pai' ? '5.1' : '5.1.1'} required />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!canSubmit}>Criar natureza</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
