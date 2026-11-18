'use client'

// Copiar o quadro de outra versão (de outro exercício também). Substitui o quadro
// desta versão; não gera a folha — quem gera é o botão "Gerar folha", depois de conferir.

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { CellCombobox } from '@/components/transacoes-shared/cell-combobox'
import type { SimpleDimensionItem } from '@/components/transacoes-shared/types'
import type { BudgetVersionListItem } from '@/lib/budget-types'
import { copyQuadro } from '@/server/payroll'

export function CopiarQuadroDialog({
  open, onOpenChange, destino, versions, pessoasAtuais, onCopied,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  destino: BudgetVersionListItem
  versions: BudgetVersionListItem[]
  pessoasAtuais: number
  onCopied: () => void
}) {
  const [origemId, setOrigemId] = useState<string | null>(null)
  const [isCopying, startCopying] = useTransition()

  useEffect(() => { if (open) setOrigemId(null) }, [open])

  const opcoes: SimpleDimensionItem[] = versions
    .filter(v => v.id !== destino.id)
    .map(v => ({ id: v.id, name: v.name, code: String(v.fiscalYear) }))

  function copiar() {
    if (!origemId) return
    startCopying(async () => {
      const r = await copyQuadro(origemId, destino.id)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(`${r.pessoas} pessoa${r.pessoas === 1 ? '' : 's'} copiada${r.pessoas === 1 ? '' : 's'}. Confira e gere a folha.`)
      onOpenChange(false)
      onCopied()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Copiar quadro de outra versão</DialogTitle>
          <DialogDescription>
            Traz as pessoas, as alocações, os benefícios e os parâmetros da folha. A folha não é gerada — confira e gere em seguida.
          </DialogDescription>
        </DialogHeader>

        {opcoes.length === 0 ? (
          <p className="text-xs text-muted-foreground">Não há outra versão de onde copiar.</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Copiar de</Label>
              <div className="border rounded-md">
                <CellCombobox value={origemId} options={opcoes} placeholder="Escolha a versão" onValueChange={setOrigemId} />
              </div>
            </div>
            {pessoasAtuais > 0 && (
              <p className="text-xs text-amber-600">
                O quadro de {destino.name} tem {pessoasAtuais} pessoa{pessoasAtuais > 1 ? 's' : ''}. Copiar substitui todas.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCopying}>Cancelar</Button>
          <Button onClick={copiar} disabled={!origemId || isCopying}>
            {isCopying ? 'Copiando…' : pessoasAtuais > 0 ? 'Substituir quadro' : 'Copiar quadro'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
