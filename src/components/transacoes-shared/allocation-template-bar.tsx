'use client'

import { useEffect, useState, useTransition } from 'react'
import { BookmarkPlus, Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { formatProportion } from '@/lib/allocation-math'
import {
  listAllocationTemplates, saveAllocationTemplate,
  type TemplateRow, type TemplateLineInput,
} from '@/server/allocation-templates'

interface Props {
  /** Modelo aplicado agora — some assim que o usuário edita qualquer coisa. */
  applied: string | null
  onApply: (t: TemplateRow) => void
  /**
   * As partes de agora, em formato de modelo. `null` desabilita o salvar —
   * é o caso de um rateio incompleto, que não descreve divisão nenhuma.
   */
  currentLines: TemplateLineInput[] | null
  /** Recarrega a lista quando um modelo novo nasce aqui. */
  onSaved?: () => void
}

/**
 * Barra de modelos dos diálogos de rateio: aplicar um salvo, ou salvar o atual.
 *
 * A lista é buscada aqui, e não recebida por prop, porque os dois diálogos que
 * usam a barra estão a dois e três níveis de profundidade das telas que os
 * abrem — passar por prop obrigaria `/transacoes`, o drill-down e a revisão a
 * carregarem modelos que talvez nunca sejam abertos.
 */
export function AllocationTemplateBar({ applied, onApply, currentLines, onSaved }: Props) {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null)
  const [aberto, setAberto] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [nome, setNome] = useState('')
  const [isBusy, startBusy] = useTransition()

  function recarregar() {
    startBusy(async () => setTemplates(await listAllocationTemplates()))
  }
  useEffect(recarregar, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const aplicado = templates?.find(t => t.id === applied) ?? null

  function salvar() {
    if (!currentLines) return
    startBusy(async () => {
      const r = await saveAllocationTemplate({ name: nome, lines: currentLines })
      if ('error' in r && r.error) { toast.error(r.error); return }
      toast.success(`Modelo "${nome.trim()}" salvo.`)
      setSalvando(false)
      setNome('')
      recarregar()
      onSaved?.()
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs font-normal justify-between min-w-[200px]">
            <span className={cn('truncate', !aplicado && 'text-muted-foreground')}>
              {aplicado ? aplicado.name : 'Aplicar modelo…'}
            </span>
            {isBusy && templates === null
              ? <Loader2 className="h-3 w-3 animate-spin shrink-0 opacity-50" />
              : <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[340px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar modelo…" className="h-8 text-xs" />
            <CommandList>
              <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                Nenhum modelo salvo. Monte um rateio e use &ldquo;Salvar como modelo&rdquo;.
              </CommandEmpty>
              <CommandGroup>
                {(templates ?? []).map(t => (
                  <CommandItem
                    key={t.id}
                    value={t.name}
                    onSelect={() => { onApply(t); setAberto(false) }}
                    className="text-xs"
                  >
                    <Check className={cn('mr-2 h-3 w-3', applied === t.id ? 'opacity-100' : 'opacity-0')} />
                    <span className="flex-1 truncate">{t.name}</span>
                    <span className="ml-2 text-[10px] text-muted-foreground tabular-nums shrink-0">
                      {formatProportion(t.lines.map(l => l.weight))}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost" size="sm" className="h-7 text-xs"
        disabled={!currentLines}
        title={currentLines ? 'Salvar esta divisão como modelo' : 'Complete o rateio para poder salvá-lo'}
        onClick={() => setSalvando(true)}
      >
        <BookmarkPlus className="h-3.5 w-3.5 mr-1" />Salvar como modelo
      </Button>

      <Dialog open={salvando} onOpenChange={setSalvando}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Salvar como modelo</DialogTitle>
            <DialogDescription>
              A divisão fica salva em proporção
              {currentLines && <> ({formatProportion(currentLines.map(l => l.weight))})</>}, então
              serve para lançamentos de qualquer valor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="nome-modelo" className="text-xs">Nome</Label>
            <Input
              id="nome-modelo" value={nome} autoFocus
              onChange={e => setNome(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && nome.trim()) salvar() }}
              placeholder="Rateio padrão"
              className="h-8 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSalvando(false)} disabled={isBusy}>
              Cancelar
            </Button>
            <Button size="sm" onClick={salvar} disabled={!nome.trim() || isBusy}>
              {isBusy ? 'Salvando…' : 'Salvar modelo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
