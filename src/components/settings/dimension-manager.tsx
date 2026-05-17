'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, Check, X, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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

export type DimensionItem = {
  id: string
  name: string
  code: string | null
  isActive: boolean
  createdAt: Date
  cnpj?: string | null
}

interface DimensionManagerProps {
  items: DimensionItem[]
  title: string
  description?: string
  singularLabel: string
  showCnpj?: boolean
  onCreate: (formData: FormData) => Promise<{ success?: boolean; error?: string }>
  onUpdate: (id: string, formData: FormData) => Promise<{ success?: boolean; error?: string }>
  onToggleActive: (id: string, isActive: boolean) => Promise<{ success?: boolean; error?: string }>
  onDelete: (id: string) => Promise<{ success?: boolean; error?: string }>
  getLinkedCount: (id: string) => Promise<number>
}

export function DimensionManager({
  items,
  singularLabel,
  showCnpj,
  onCreate,
  onUpdate,
  onToggleActive,
  onDelete,
  getLinkedCount,
}: DimensionManagerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [showArchived, setShowArchived] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; linkedCount: number } | null>(null)

  const createFormRef = useRef<HTMLFormElement>(null)

  const active = items.filter((i) => i.isActive)
  const archived = items.filter((i) => !i.isActive)
  const visible = showArchived ? items : active

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      const result = await onCreate(formData)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(`${singularLabel} criado com sucesso.`)
        setShowCreateForm(false)
        createFormRef.current?.reset()
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

  function handleToggleActive(id: string, currentlyActive: boolean) {
    startTransition(async () => {
      const result = await onToggleActive(id, !currentlyActive)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(currentlyActive ? 'Arquivado.' : 'Reativado.')
        router.refresh()
      }
    })
  }

  async function handleDeleteClick(item: DimensionItem) {
    const linkedCount = await getLinkedCount(item.id)
    setDeleteTarget({ id: item.id, name: item.name, linkedCount })
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await onDelete(deleteTarget.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Deletado com sucesso.')
        setDeleteTarget(null)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <Button
          size="sm"
          onClick={() => setShowCreateForm((v) => !v)}
          disabled={isPending}
        >
          <Plus className="h-4 w-4 mr-1" />
          Novo {singularLabel.toLowerCase()}
        </Button>

        {archived.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowArchived((v) => !v)}
          >
            <Archive className="h-4 w-4 mr-1" />
            {showArchived ? 'Ocultar arquivados' : `Mostrar arquivados (${archived.length})`}
          </Button>
        )}
      </div>

      {/* Formulário de criação */}
      {showCreateForm && (
        <form
          ref={createFormRef}
          action={handleCreate}
          className="flex gap-2 items-end p-3 border rounded-lg bg-muted/30"
        >
          <div className="flex-1 min-w-0">
            <Label htmlFor="new-name" className="text-xs mb-1 block">Nome</Label>
            <Input id="new-name" name="name" placeholder={`Nome do ${singularLabel.toLowerCase()}`} required autoFocus />
          </div>
          <div className="w-28">
            <Label htmlFor="new-code" className="text-xs mb-1 block">Código (opcional)</Label>
            <Input id="new-code" name="code" placeholder="Ex: CC01" />
          </div>
          {showCnpj && (
            <div className="w-36">
              <Label htmlFor="new-cnpj" className="text-xs mb-1 block">CNPJ (opcional)</Label>
              <Input id="new-cnpj" name="cnpj" placeholder="00.000.000/0001-00" />
            </div>
          )}
          <Button type="submit" size="sm" disabled={isPending}>
            <Check className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setShowCreateForm(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </form>
      )}

      {/* Lista */}
      {visible.length === 0 && !showCreateForm ? (
        <EmptyState
          icon={<Building2 className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title={`Nenhum ${singularLabel.toLowerCase()} cadastrado`}
          description={`Clique em "Novo ${singularLabel.toLowerCase()}" para começar.`}
        />
      ) : (
        <div className="divide-y rounded-lg border">
          {visible.map((item) => (
            <DimensionRow
              key={item.id}
              item={item}
              showCnpj={showCnpj}
              isEditing={editingId === item.id}
              isPending={isPending}
              onEdit={() => setEditingId(item.id)}
              onCancelEdit={() => setEditingId(null)}
              onUpdate={(fd) => handleUpdate(item.id, fd)}
              onToggleActive={() => handleToggleActive(item.id, item.isActive)}
              onDelete={() => handleDeleteClick(item)}
            />
          ))}
        </div>
      )}

      {/* Dialog de confirmação de exclusão */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar {singularLabel.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.linkedCount && deleteTarget.linkedCount > 0 ? (
                <>
                  <strong>{deleteTarget.name}</strong> está vinculado a{' '}
                  <strong>{deleteTarget.linkedCount} transação(ões)</strong>. Ao deletar, essas
                  transações perderão esta classificação. Esta ação não pode ser desfeita.
                </>
              ) : (
                <>
                  Tem certeza que deseja deletar <strong>{deleteTarget?.name}</strong>? Esta ação
                  não pode ser desfeita.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Row ─────────────────────────────────────────────────────────────────────

interface RowProps {
  item: DimensionItem
  showCnpj?: boolean
  isEditing: boolean
  isPending: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onUpdate: (formData: FormData) => void
  onToggleActive: () => void
  onDelete: () => void
}

function DimensionRow({
  item,
  showCnpj,
  isEditing,
  isPending,
  onEdit,
  onCancelEdit,
  onUpdate,
  onToggleActive,
  onDelete,
}: RowProps) {
  if (isEditing) {
    return (
      <form
        action={onUpdate}
        className="flex gap-2 items-center px-3 py-2 bg-muted/20"
      >
        <Input
          name="name"
          defaultValue={item.name}
          className="h-8 flex-1"
          autoFocus
          required
        />
        <Input
          name="code"
          defaultValue={item.code ?? ''}
          className="h-8 w-24"
          placeholder="Código"
        />
        {showCnpj && (
          <Input
            name="cnpj"
            defaultValue={item.cnpj ?? ''}
            className="h-8 w-36"
            placeholder="CNPJ"
          />
        )}
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
    <div className={`flex items-center gap-3 px-3 py-2.5 ${!item.isActive ? 'opacity-60' : ''}`}>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground truncate">{item.name}</span>
        <div className="flex gap-2 mt-0.5">
          {item.code && (
            <span className="text-xs text-muted-foreground font-mono">{item.code}</span>
          )}
          {showCnpj && item.cnpj && (
            <span className="text-xs text-muted-foreground">{item.cnpj}</span>
          )}
        </div>
      </div>

      {!item.isActive && (
        <Badge variant="secondary" className="text-xs shrink-0">Arquivado</Badge>
      )}

      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={onEdit}
          title="Editar"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={onToggleActive}
          title={item.isActive ? 'Arquivar' : 'Reativar'}
          disabled={isPending}
        >
          {item.isActive ? (
            <Archive className="h-3.5 w-3.5" />
          ) : (
            <ArchiveRestore className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
          title="Deletar"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
