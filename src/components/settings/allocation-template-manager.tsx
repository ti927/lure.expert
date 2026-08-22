'use client'

import { Fragment, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Archive, ArchiveRestore, ChevronRight, Split } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/states/empty-state'
import { cn } from '@/lib/utils'
import { formatProportion, normalizeWeights } from '@/lib/allocation-math'
import { WeightRowsEditor, novaLinhaPeso, type WeightRow } from '@/components/transacoes-shared/weight-rows-editor'
import type { SimpleDimensionItem } from '@/components/transacoes-shared/types'
import {
  saveAllocationTemplate, deleteAllocationTemplate, toggleAllocationTemplateActive,
  type TemplateRow,
} from '@/server/allocation-templates'

interface Props {
  templates: TemplateRow[]
  costCenters:   SimpleDimensionItem[]
  businessUnits: SimpleDimensionItem[]
  legalEntities: SimpleDimensionItem[]
  contacts:      SimpleDimensionItem[]
}

/** Rascunho em edição. `id` nulo é modelo novo. */
interface Rascunho {
  id:    string | null
  name:  string
  lines: WeightRow[]
}

export function AllocationTemplateManager({
  templates, costCenters, businessUnits, legalEntities, contacts,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [mostrarArquivados, setMostrarArquivados] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [apagando, setApagando] = useState<TemplateRow | null>(null)

  const nomes = useMemo(() => {
    const mapa = (lista: SimpleDimensionItem[]) => new Map(lista.map(i => [i.id, i.name]))
    return {
      cc: mapa(costCenters), bu: mapa(businessUnits),
      le: mapa(legalEntities), ct: mapa(contacts),
    }
  }, [costCenters, businessUnits, legalEntities, contacts])

  const visiveis = mostrarArquivados ? templates : templates.filter(t => t.isActive)
  const arquivados = templates.filter(t => !t.isActive).length

  function abrirNovo() {
    setRascunho({ id: null, name: '', lines: [novaLinhaPeso(60), novaLinhaPeso(40)] })
  }

  function abrirEdicao(t: TemplateRow) {
    setRascunho({
      id: t.id,
      name: t.name,
      lines: t.lines.map(l => ({
        ...novaLinhaPeso(l.weight),
        costCenterId: l.costCenterId, businessUnitId: l.businessUnitId,
        legalEntityId: l.legalEntityId, contactId: l.contactId,
      })),
    })
  }

  function gravar() {
    if (!rascunho) return
    startTransition(async () => {
      const r = await saveAllocationTemplate({
        id:   rascunho.id,
        name: rascunho.name,
        lines: rascunho.lines.map(l => ({
          weight: l.weight,
          costCenterId: l.costCenterId, businessUnitId: l.businessUnitId,
          legalEntityId: l.legalEntityId, contactId: l.contactId,
        })),
      })
      if ('error' in r && r.error) { toast.error(r.error); return }
      toast.success(rascunho.id ? 'Modelo atualizado.' : 'Modelo criado.')
      setRascunho(null)
      router.refresh()
    })
  }

  function arquivar(t: TemplateRow) {
    startTransition(async () => {
      await toggleAllocationTemplateActive(t.id, !t.isActive)
      toast.success(t.isActive ? 'Modelo arquivado.' : 'Modelo reativado.')
      router.refresh()
    })
  }

  function apagar() {
    if (!apagando) return
    const alvo = apagando
    startTransition(async () => {
      await deleteAllocationTemplate(alvo.id)
      toast.success(`Modelo "${alvo.name}" apagado. Os rateios feitos com ele continuam valendo.`)
      setApagando(null)
      router.refresh()
    })
  }

  /** As dimensões de uma linha, em texto — só as preenchidas. */
  function descreverLinha(l: TemplateRow['lines'][number]): string {
    const partes = [
      l.costCenterId   && nomes.cc.get(l.costCenterId),
      l.businessUnitId && nomes.bu.get(l.businessUnitId),
      l.legalEntityId  && nomes.le.get(l.legalEntityId),
      l.contactId      && nomes.ct.get(l.contactId),
    ].filter(Boolean)
    return partes.length > 0 ? partes.join(' · ') : 'sem dimensão'
  }

  const rascunhoValido = !!rascunho
    && rascunho.name.trim().length > 0
    && rascunho.lines.length >= 2
    && rascunho.lines.every(l => l.weight > 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={abrirNovo}>
          <Plus className="h-4 w-4 mr-1" />Novo modelo
        </Button>
        {arquivados > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox checked={mostrarArquivados} onCheckedChange={v => setMostrarArquivados(v === true)} />
            Mostrar arquivados ({arquivados})
          </label>
        )}
      </div>

      {visiveis.length === 0 ? (
        <EmptyState
          icon={<Split className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Nenhum modelo salvo"
          description="Modelos guardam uma divisão que você repete — 60% Comercial, 40% Administrativo — para reaplicar em um clique. Crie um aqui, ou salve direto do diálogo de rateio em /transacoes."
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium w-20 text-right">Partes</th>
                <th className="px-3 py-2 font-medium w-40">Proporção</th>
                <th className="px-3 py-2 font-medium w-40">Usado em</th>
                <th className="px-3 py-2 font-medium w-28" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map(t => (
                <Fragment key={t.id}>
                  <tr className={cn('border-b last:border-0 hover:bg-muted/30', !t.isActive && 'opacity-60')}>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setExpandido(expandido === t.id ? null : t.id)}
                        className="flex items-center gap-1.5 text-left hover:text-foreground"
                      >
                        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform',
                          expandido === t.id && 'rotate-90')} />
                        <span className="font-medium">{t.name}</span>
                        {!t.isActive && <Badge variant="secondary" className="ml-1 text-[10px]">arquivado</Badge>}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{t.lines.length}</td>
                    <td className="px-3 py-2 tabular-nums text-xs">{formatProportion(t.lines.map(l => l.weight))}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                      {t.usageCount === 0
                        ? '—'
                        : `${t.usageCount} ${t.usageCount === 1 ? 'lançamento' : 'lançamentos'}`}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <button onClick={() => abrirEdicao(t)} disabled={isPending}
                          className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
                          aria-label="Editar">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => arquivar(t)} disabled={isPending}
                          className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
                          aria-label={t.isActive ? 'Arquivar' : 'Reativar'}>
                          {t.isActive ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                        </button>
                        <button onClick={() => setApagando(t)} disabled={isPending}
                          className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                          aria-label="Apagar">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandido === t.id && (
                    <tr className="border-b last:border-0 bg-muted/20">
                      <td colSpan={5} className="px-3 py-2">
                        <table className="w-full text-xs">
                          <tbody>
                            {t.lines.map((l, i) => {
                              const pcts = normalizeWeights(t.lines.map(x => x.weight))
                              return (
                                <tr key={l.id}>
                                  <td className="py-0.5 pr-3 w-16 text-muted-foreground">Parte {i + 1}</td>
                                  <td className="py-0.5 pr-3 w-20 text-right tabular-nums font-medium">
                                    {pcts[i].toString().replace('.', ',')}%
                                  </td>
                                  <td className="py-0.5 text-muted-foreground">{descreverLinha(l)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Criar / editar */}
      <Dialog open={!!rascunho} onOpenChange={v => !v && setRascunho(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{rascunho?.id ? 'Editar modelo' : 'Novo modelo de rateio'}</DialogTitle>
            <DialogDescription>
              Os pesos são relativos: 60 : 40 e 6 : 4 são a mesma divisão. Ao aplicar, os valores são
              fechados no centavo para o lançamento em questão.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="nome-modelo-mgr" className="text-xs">Nome</Label>
            <Input
              id="nome-modelo-mgr" value={rascunho?.name ?? ''} autoFocus
              onChange={e => setRascunho(r => r && { ...r, name: e.target.value })}
              placeholder="Rateio padrão"
              className="h-8 text-sm max-w-sm"
            />
          </div>

          {rascunho && (
            <WeightRowsEditor
              rows={rascunho.lines}
              onChange={lines => setRascunho(r => r && { ...r, lines })}
              costCenters={costCenters}
              businessUnits={businessUnits}
              legalEntities={legalEntities}
              contacts={contacts}
              minRows={2}
            />
          )}

          {rascunho && rascunho.lines.length < 2 && (
            <p className="text-[11px] text-amber-600">Um modelo de rateio precisa de ao menos 2 partes.</p>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRascunho(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button size="sm" onClick={gravar} disabled={!rascunhoValido || isPending}>
              {isPending ? 'Salvando…' : 'Salvar modelo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apagar */}
      <AlertDialog open={!!apagando} onOpenChange={v => !v && setApagando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar &ldquo;{apagando?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              {apagando && apagando.usageCount > 0 ? (
                <>
                  Este modelo rateou {apagando.usageCount}{' '}
                  {apagando.usageCount === 1 ? 'lançamento' : 'lançamentos'}. Os rateios
                  <strong> continuam exatamente como estão</strong> — só perdem a etiqueta de
                  origem, e nenhum número de DRE muda. Se quiser preservar o rastro, arquive em vez
                  de apagar.
                </>
              ) : (
                <>O modelo some do seletor de rateio. Nenhum lançamento é afetado.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={apagar} disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isPending ? 'Apagando…' : 'Apagar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
