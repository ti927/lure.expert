'use client'

// O mapa componente → natureza da organização. Vale para todas as versões.
// Componente sem linha gravada mostra a SUGESTÃO do plano padrão, que só passa
// a valer para a geração depois de salvar.

import { useEffect, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CategoryCellCombobox } from '@/components/transacoes-shared/cell-combobox'
import type { CategoryItem } from '@/components/transacoes-shared/types'
import { COMPONENTES, ROTULO_COMPONENTE, type Componente } from '@/lib/payroll-types'
import { getMapaFolha, saveMapaFolha } from '@/server/payroll'

type Linha = { componente: Componente; categoryId: string | null; sugerida: boolean }

export function NaturezasFolhaDialog({
  open, onOpenChange, leafCategories, editavel, onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leafCategories: CategoryItem[]
  editavel: boolean
  onSaved: () => void
}) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()

  useEffect(() => {
    if (!open) return
    setLinhas(null)
    setErro(null)
    getMapaFolha()
      .then(setLinhas)
      .catch(() => setErro('Não foi possível carregar o mapa da folha. Tente de novo em instantes.'))
  }, [open])

  const sugeridas = linhas?.filter(l => l.sugerida && l.categoryId).length ?? 0

  function salvar() {
    if (!linhas) return
    const mapa = Object.fromEntries(linhas.map(l => [l.componente, l.categoryId])) as Partial<Record<Componente, string | null>>
    startSaving(async () => {
      const r = await saveMapaFolha(mapa)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Naturezas da folha salvas.')
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Naturezas da folha</DialogTitle>
          <DialogDescription>
            Para onde cada componente vai na DRE. Vale para todas as versões; a pessoa pode ter exceções no próprio cadastro.
          </DialogDescription>
        </DialogHeader>

        {erro ? (
          <p className="text-sm text-rose-600">{erro}</p>
        ) : !linhas ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-6">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando o mapa…
          </div>
        ) : (
          <div className="space-y-1">
            {sugeridas > 0 && (
              <p className="text-[11px] text-amber-600 pb-1">
                {sugeridas} componente{sugeridas > 1 ? 's vêm' : ' vem'} sugerido{sugeridas > 1 ? 's' : ''} pelo plano padrão.
                A sugestão só vale para gerar a folha depois de salvar.
              </p>
            )}
            {COMPONENTES.map(c => {
              const l = linhas.find(x => x.componente === c)!
              return (
                <div key={c} className="flex items-center gap-2">
                  <span className="w-60 shrink-0 text-xs">{ROTULO_COMPONENTE[c]}</span>
                  <div className="flex-1 border rounded-md">
                    <CategoryCellCombobox value={l.categoryId} categories={leafCategories} disabled={!editavel || isSaving}
                      emptyLabel="Sem natureza"
                      onValueChange={v => setLinhas(prev => prev!.map(x =>
                        x.componente === c ? { ...x, categoryId: v, sugerida: false } : x))} />
                  </div>
                  <span className="w-16 text-[10px] text-amber-600">{l.sugerida && l.categoryId ? 'sugestão' : ''}</span>
                </div>
              )
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {editavel ? 'Cancelar' : 'Fechar'}
          </Button>
          {editavel && (
            <Button onClick={salvar} disabled={isSaving || !linhas}>
              {isSaving ? 'Salvando…' : 'Salvar naturezas'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
