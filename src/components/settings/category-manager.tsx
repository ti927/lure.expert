'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  Plus, Pencil, Archive, ArchiveRestore, Trash2, Check, X,
  ChevronDown, ChevronRight, Tags, GripVertical, Filter,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
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
  receita_operacional:    'Receita Operacional',
  deducoes_tributarias:   'Deduções Tributárias',
  deducoes_operacionais:  'Deduções Operacionais',
  cpv:                    'CPV / CMV / CSP',
  sga:                    'SG&A',
  resultado_financeiro:   'Receitas & Despesas Financeiras',
  ir:                     'Impostos Sobre Renda',
  investimento:           'Investimentos & Amortizações',
  transfer:               'Transitórios',
  // BP
  ativo_circulante:       'Ativo Circulante',
  ativo_nao_circulante:   'Ativo Não-Circulante',
  passivo_circulante:     'Passivo Circulante',
  passivo_nao_circulante: 'Passivo Não-Circulante',
  patrimonio_liquido:     'Patrimônio Líquido',
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
  onMove: (filhoId: string, newParentId: string) => Promise<{ success?: boolean; error?: string }>
}

type TreeNode = CategoryItem & { children: TreeNode[] }

function buildTree(flat: CategoryItem[], parentId: string | null = null): TreeNode[] {
  return flat
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((c) => ({ ...c, children: buildTree(flat, c.id) }))
}

// ─── Shared row action buttons ────────────────────────────────────────────────

interface RowActionsProps {
  node: CategoryItem
  isPending: boolean
  onEditRequest: (id: string) => void
  onToggleActiveRequest: (item: CategoryItem) => void
  onDeleteRequest: (item: CategoryItem) => void
}

function RowActions({ node, isPending, onEditRequest, onToggleActiveRequest, onDeleteRequest }: RowActionsProps) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <Button
        size="sm" variant="ghost" className="h-7 w-7 p-0"
        onClick={() => onEditRequest(node.id)} title="Editar"
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
        onClick={() => onDeleteRequest(node)} title="Deletar"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ─── MultiFilter helper ───────────────────────────────────────────────────────

function MultiFilter({
  label,
  icon,
  selectedCount,
  placeholder,
  popoverWidth,
  children,
}: {
  label: string
  icon?: React.ReactNode
  selectedCount: number
  placeholder: string
  popoverWidth: string
  children: React.ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          {icon}
          {label}
          {selectedCount > 0 && (
            <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-xs ml-0.5">
              {selectedCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-0', popoverWidth)} align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
            <CommandGroup>{children}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function CategoryManager({
  categories,
  onCreate,
  onUpdate,
  onToggleActive,
  onDelete,
  onMove,
}: CategoryManagerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Local categories for optimistic DnD updates
  const [localCategories, setLocalCategories] = useState(categories)
  useEffect(() => { setLocalCategories(categories) }, [categories])

  const [showArchived, setShowArchived] = useState(false)
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CategoryItem | null>(null)

  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [paiFilter, setPaiFilter] = useState<string[]>([])
  const [filhoFilter, setFilhoFilter] = useState<string[]>([])

  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  // Filter options
  const allPais = localCategories.filter(c => c.parentId === null && c.isActive)
  const allFilhos = localCategories.filter(c => c.parentId !== null && c.isActive)
  const typesWithCategories = TYPE_ORDER.filter(t => localCategories.some(c => c.type === t))

  // Apply filters
  const visibleCategories = (() => {
    let result = showArchived ? localCategories : localCategories.filter(c => c.isActive)

    if (typeFilter.length > 0)
      result = result.filter(c => typeFilter.includes(c.type))

    if (paiFilter.length > 0) {
      const paiIds = new Set(paiFilter)
      result = result.filter(c => paiIds.has(c.id) || (c.parentId !== null && paiIds.has(c.parentId)))
    }

    if (filhoFilter.length > 0) {
      const filhoIds = new Set(filhoFilter)
      const parentIds = new Set(
        localCategories.filter(c => filhoIds.has(c.id)).map(c => c.parentId).filter(Boolean) as string[]
      )
      result = result.filter(c => filhoIds.has(c.id) || parentIds.has(c.id))
    }

    return result
  })()

  const archivedCount = localCategories.filter(c => !c.isActive).length
  const hasActiveFilters = typeFilter.length > 0 || paiFilter.length > 0 || filhoFilter.length > 0

  const byType: Record<string, TreeNode[]> = {}
  for (const type of TYPE_ORDER) {
    byType[type] = buildTree(visibleCategories.filter(c => c.type === type))
  }

  function toggleTypeCollapse(type: string) {
    setCollapsedTypes(prev => {
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

  function handleDragStart({ active }: DragStartEvent) {
    setActiveDragId(active.id as string)
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveDragId(null)
    if (!over) return

    const filhoId = active.id as string
    const newParentId = over.id as string
    const draggedItem = localCategories.find(c => c.id === filhoId)
    const newParent = localCategories.find(c => c.id === newParentId)
    if (!draggedItem || !newParent || newParent.parentId !== null) return
    if (draggedItem.parentId === newParentId) return

    const prev = [...localCategories]
    setLocalCategories(cs =>
      cs.map(c => c.id === filhoId ? { ...c, parentId: newParentId, type: newParent.type } : c)
    )
    startTransition(async () => {
      const result = await onMove(filhoId, newParentId)
      if (result.error) {
        toast.error(result.error)
        setLocalCategories(prev)
      } else {
        toast.success('Natureza movida.')
        router.refresh()
      }
    })
  }

  const activeDragItem = activeDragId ? localCategories.find(c => c.id === activeDragId) : null

  const sharedProps = {
    editingId,
    isPending,
    onEditRequest: setEditingId,
    onCancelEdit: () => setEditingId(null),
    onUpdateRequest: handleUpdate,
    onToggleActiveRequest: handleToggleActive,
    onDeleteRequest: setDeleteTarget,
  }

  return (
    <div className="space-y-4">
      {/* Toolbar Row 1 */}
      <div className="flex items-center justify-between">
        <Button size="sm" onClick={() => setShowCreateDialog(true)} disabled={isPending}>
          <Plus className="h-4 w-4 mr-1" />
          Nova natureza
        </Button>
        {archivedCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowArchived(v => !v)}>
            <Archive className="h-4 w-4 mr-1" />
            {showArchived ? 'Ocultar arquivadas' : `Mostrar arquivadas (${archivedCount})`}
          </Button>
        )}
      </div>

      {/* Toolbar Row 2: Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <MultiFilter
          label="Tipo"
          icon={<Filter className="h-3.5 w-3.5" />}
          selectedCount={typeFilter.length}
          placeholder="Buscar tipo..."
          popoverWidth="w-64"
        >
          {typesWithCategories.map(type => (
            <CommandItem
              key={type}
              onSelect={() => setTypeFilter(prev =>
                prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
              )}
              className="cursor-pointer"
            >
              <Check className={cn('mr-2 h-4 w-4', typeFilter.includes(type) ? 'opacity-100' : 'opacity-0')} />
              {TYPE_LABELS[type] ?? type}
            </CommandItem>
          ))}
        </MultiFilter>

        <MultiFilter
          label="Natureza Pai"
          selectedCount={paiFilter.length}
          placeholder="Buscar natureza pai..."
          popoverWidth="w-72"
        >
          {allPais.map(pai => (
            <CommandItem
              key={pai.id}
              onSelect={() => setPaiFilter(prev =>
                prev.includes(pai.id) ? prev.filter(x => x !== pai.id) : [...prev, pai.id]
              )}
              className="cursor-pointer"
            >
              <Check className={cn('mr-2 h-4 w-4', paiFilter.includes(pai.id) ? 'opacity-100' : 'opacity-0')} />
              <span className="font-mono text-xs text-muted-foreground mr-1.5">{pai.code}</span>
              {pai.name}
            </CommandItem>
          ))}
        </MultiFilter>

        <MultiFilter
          label="Natureza Filho"
          selectedCount={filhoFilter.length}
          placeholder="Buscar natureza filho..."
          popoverWidth="w-72"
        >
          {allFilhos.map(filho => (
            <CommandItem
              key={filho.id}
              onSelect={() => setFilhoFilter(prev =>
                prev.includes(filho.id) ? prev.filter(x => x !== filho.id) : [...prev, filho.id]
              )}
              className="cursor-pointer"
            >
              <Check className={cn('mr-2 h-4 w-4', filhoFilter.includes(filho.id) ? 'opacity-100' : 'opacity-0')} />
              <span className="font-mono text-xs text-muted-foreground mr-1.5">{filho.code}</span>
              {filho.name}
            </CommandItem>
          ))}
        </MultiFilter>

        {hasActiveFilters && (
          <Button
            variant="ghost" size="sm" className="h-8 text-muted-foreground"
            onClick={() => { setTypeFilter([]); setPaiFilter([]); setFilhoFilter([]) }}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Árvore por tipo */}
      {localCategories.length === 0 ? (
        <EmptyState
          icon={<Tags className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Nenhuma categoria cadastrada"
          description='Clique em "Nova natureza" para começar.'
        />
      ) : (
        <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="space-y-4">
            {([['DRE', DRE_TYPES], ['Balanço Patrimonial', BP_TYPES]] as [string, string[]][]).map(
              ([sectionLabel, sectionTypes]) => {
                const hasAny = sectionTypes.some(t => (byType[t]?.length ?? 0) > 0)
                if (!hasAny) return null
                return (
                  <div key={sectionLabel}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1">
                      {sectionLabel}
                    </p>
                    <div className="space-y-2">
                      {sectionTypes.map(type => {
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
                              {isCollapsed
                                ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                              }
                              <span className="text-sm font-semibold text-foreground">
                                {TYPE_LABELS[type] ?? type}
                              </span>
                              <span className="text-xs text-muted-foreground ml-1">({nodes.length})</span>
                            </button>

                            {!isCollapsed && (
                              <div>
                                {nodes.map(paiNode => (
                                  <PaiSection
                                    key={paiNode.id}
                                    node={paiNode}
                                    activeDragId={activeDragId}
                                    {...sharedProps}
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
              }
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeDragItem && (
              <div className="flex items-center gap-3 px-3 py-2 bg-background shadow-lg border rounded-md text-sm ring-1 ring-primary/30">
                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-mono text-xs text-muted-foreground">{activeDragItem.code}</span>
                <span className="text-foreground">{activeDragItem.name}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      <CreateCategoryDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        categories={localCategories}
        onSubmit={handleCreate}
        isPending={isPending}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
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

// ─── PaiSection (droppable container) ─────────────────────────────────────────

interface SectionProps {
  node: TreeNode
  activeDragId: string | null
  editingId: string | null
  isPending: boolean
  onEditRequest: (id: string) => void
  onCancelEdit: () => void
  onUpdateRequest: (id: string, formData: FormData) => void
  onToggleActiveRequest: (item: CategoryItem) => void
  onDeleteRequest: (item: CategoryItem) => void
}

function PaiSection({
  node,
  activeDragId,
  editingId,
  isPending,
  onEditRequest,
  onCancelEdit,
  onUpdateRequest,
  onToggleActiveRequest,
  onDeleteRequest,
}: SectionProps) {
  const { setNodeRef, isOver } = useDroppable({ id: node.id })
  // Don't highlight when dragging from this same Pai
  const isDragFromSelf = activeDragId !== null && node.children.some(c => c.id === activeDragId)
  const showDropHighlight = isOver && !isDragFromSelf

  const rowProps = { isPending, onEditRequest, onCancelEdit, onUpdateRequest, onToggleActiveRequest, onDeleteRequest }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'divide-y border-t first:border-t-0 transition-colors',
        showDropHighlight && 'bg-primary/5',
      )}
    >
      <PaiRow node={node} editingId={editingId} isDropTarget={showDropHighlight} {...rowProps} />
      {node.children.map(child => (
        <DraggableFilhoRow key={child.id} node={child} editingId={editingId} {...rowProps} />
      ))}
    </div>
  )
}

// ─── PaiRow (static, not draggable) ──────────────────────────────────────────

interface PaiRowProps {
  node: CategoryItem
  editingId: string | null
  isDropTarget: boolean
  isPending: boolean
  onEditRequest: (id: string) => void
  onCancelEdit: () => void
  onUpdateRequest: (id: string, formData: FormData) => void
  onToggleActiveRequest: (item: CategoryItem) => void
  onDeleteRequest: (item: CategoryItem) => void
}

function PaiRow({
  node,
  editingId,
  isDropTarget,
  isPending,
  onEditRequest,
  onCancelEdit,
  onUpdateRequest,
  onToggleActiveRequest,
  onDeleteRequest,
}: PaiRowProps) {
  const isEditing = editingId === node.id

  if (isEditing) {
    return (
      <form
        action={(fd) => onUpdateRequest(node.id, fd)}
        className="flex gap-2 items-center px-3 py-2 bg-muted/20"
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
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 transition-colors',
        !node.isActive && 'opacity-60',
        isDropTarget && 'ring-1 ring-inset ring-primary/50',
      )}
    >
      <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">{node.code}</span>
      <span className="flex-1 text-sm font-medium text-foreground truncate">{node.name}</span>
      {node.txCount > 0 && (
        <span className="text-xs text-muted-foreground shrink-0">{node.txCount} tx</span>
      )}
      {!node.isActive && (
        <Badge variant="secondary" className="text-xs shrink-0">Arquivada</Badge>
      )}
      <RowActions
        node={node}
        isPending={isPending}
        onEditRequest={onEditRequest}
        onToggleActiveRequest={onToggleActiveRequest}
        onDeleteRequest={onDeleteRequest}
      />
    </div>
  )
}

// ─── DraggableFilhoRow ────────────────────────────────────────────────────────

interface FilhoRowProps {
  node: CategoryItem
  editingId: string | null
  isPending: boolean
  onEditRequest: (id: string) => void
  onCancelEdit: () => void
  onUpdateRequest: (id: string, formData: FormData) => void
  onToggleActiveRequest: (item: CategoryItem) => void
  onDeleteRequest: (item: CategoryItem) => void
}

function DraggableFilhoRow({
  node,
  editingId,
  isPending,
  onEditRequest,
  onCancelEdit,
  onUpdateRequest,
  onToggleActiveRequest,
  onDeleteRequest,
}: FilhoRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: node.id })
  const isEditing = editingId === node.id

  if (isEditing) {
    return (
      <form
        action={(fd) => onUpdateRequest(node.id, fd)}
        className="flex gap-2 items-center px-3 py-2 bg-muted/20 pl-[32px]"
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
    )
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      className={cn(
        'flex items-center gap-3 px-3 py-2 transition-opacity',
        !node.isActive && 'opacity-60',
        isDragging && 'opacity-30',
      )}
    >
      <span
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground shrink-0 transition-colors"
        title="Arrastar para mover de Natureza Pai"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <span className="text-muted-foreground/40 text-xs select-none">└</span>
      <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">{node.code}</span>
      <span className="flex-1 text-sm text-foreground truncate">{node.name}</span>
      {node.txCount > 0 && (
        <span className="text-xs text-muted-foreground shrink-0">{node.txCount} tx</span>
      )}
      {!node.isActive && (
        <Badge variant="secondary" className="text-xs shrink-0">Arquivada</Badge>
      )}
      <RowActions
        node={node}
        isPending={isPending}
        onEditRequest={onEditRequest}
        onToggleActiveRequest={onToggleActiveRequest}
        onDeleteRequest={onDeleteRequest}
      />
    </div>
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

  const rootCategories = categories.filter((c) => c.parentId === null && c.isActive)

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
              <Label htmlFor="cat-parent">
                Natureza Pai <span className="text-destructive">*</span>
              </Label>
              <Select name="parentId" value={selectedParentId} onValueChange={handleParentChange} required>
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
                          <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                        ))}
                      </div>
                    )
                  })}
                </SelectContent>
              </Select>
              <input type="hidden" name="type" value={effectiveType} />
            </div>
          )}

          {/* Nome e Código */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="cat-name">Nome</Label>
              <Input
                id="cat-name" name="name" className="mt-1"
                placeholder={level === 'pai' ? 'Ex: Despesas com Pessoal' : 'Ex: Salários'}
                required
              />
            </div>
            <div>
              <Label htmlFor="cat-code">Código</Label>
              <Input
                id="cat-code" name="code" className="mt-1"
                placeholder={level === 'pai' ? '5.1' : '5.1.1'}
                required
              />
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
