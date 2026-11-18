'use client'

// Gerar folha: abre com a prévia (o que seria gravado), e só grava ao confirmar.
// Recusa bloqueia; aviso não. O servidor recalcula tudo no momento de gravar —
// a prévia mostrada aqui pode ter envelhecido, e a geração não confia nela.

import { useEffect, useMemo, useState, useTransition } from 'react'
import { AlertTriangle, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { COMPONENTES, ROTULO_COMPONENTE, type Componente } from '@/lib/payroll-types'
import type { PreviaFolha } from '@/lib/payroll-write'
import { generateFolha, previewFolha } from '@/server/payroll'
import { MESES_CURTOS, fmtCentavos } from './folha-format'

export function GerarFolhaDialog({
  open, onOpenChange, versionId, exercicio, editavel, onGenerated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  versionId: string
  exercicio: number
  editavel: boolean
  onGenerated: () => void
}) {
  const [previa, setPrevia] = useState<PreviaFolha | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [isGenerating, startGenerating] = useTransition()

  useEffect(() => {
    if (!open) return
    setPrevia(null)
    setErro(null)
    previewFolha(versionId)
      .then(r => { if ('error' in r) setErro(r.error); else setPrevia(r) })
      .catch(() => setErro('Não foi possível calcular a prévia. Tente de novo em instantes.'))
  }, [open, versionId])

  const meses = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${exercicio}-${String(i + 1).padStart(2, '0')}`),
    [exercicio],
  )

  const matriz = useMemo(() => {
    if (!previa) return []
    const porComp = new Map<Componente, Map<string, number>>()
    for (const c of previa.porComponenteMes) {
      if (!porComp.has(c.componente)) porComp.set(c.componente, new Map())
      porComp.get(c.componente)!.set(c.mes, c.centavos)
    }
    return COMPONENTES.filter(c => porComp.has(c)).map(c => {
      const m = porComp.get(c)!
      return { componente: c, porMes: m, total: Array.from(m.values()).reduce((s, v) => s + v, 0) }
    })
  }, [previa])

  const totalMes = (mes: string) => matriz.reduce((s, r) => s + (r.porMes.get(mes) ?? 0), 0)
  // Quadro vazio (ou tudo zerado) com folha anterior gravada: gerar é REMOVER a
  // folha antiga — sem isso as séries `folha` ficariam travadas para sempre,
  // porque só a geração as apaga.
  const remover = !!previa && previa.recusas.length === 0 && previa.totalCentavos === 0 && previa.seriesExistentes > 0
  const bloqueado = !previa || previa.recusas.length > 0 || (previa.totalCentavos === 0 && !remover) || !editavel

  function gerar() {
    startGenerating(async () => {
      const r = await generateFolha(versionId)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(r.series === 0
        ? `Folha removida: ${r.substituidas} lançamento${r.substituidas === 1 ? '' : 's'} apagado${r.substituidas === 1 ? '' : 's'}.`
        : `Folha gerada: ${r.series} lançamentos, ${r.entries} ocorrências.`)
      onOpenChange(false)
      onGenerated()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerar folha · {exercicio}</DialogTitle>
          <DialogDescription>
            Confira o que vai para o orçamento. Confirmar apaga os lançamentos da folha desta versão e grava os novos, numa operação só.
          </DialogDescription>
        </DialogHeader>

        {erro ? (
          <p className="text-sm text-rose-600">{erro}</p>
        ) : !previa ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-8">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculando a folha…
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            {previa.recusas.length > 0 && (
              <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/20 p-3 space-y-1">
                <p className="font-medium text-rose-700 flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5" />
                  A folha não pode ser gerada enquanto {previa.recusas.length === 1 ? 'isto não for resolvido' : 'estes pontos não forem resolvidos'}:
                </p>
                <ul className="list-disc pl-6 text-rose-700 space-y-0.5">
                  {previa.recusas.map((r, i) => <li key={i}>{r.motivo}</li>)}
                </ul>
              </div>
            )}

            {previa.avisos.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-1">
                <p className="font-medium text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> Avisos (não impedem a geração)
                </p>
                <ul className="list-disc pl-6 text-amber-700 space-y-0.5">
                  {previa.avisos.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}

            <div className="flex items-baseline gap-6 flex-wrap">
              <span className="text-muted-foreground">
                Total do ano <span className="text-base font-semibold tabular-nums text-foreground">R$ {fmtCentavos(previa.totalCentavos)}</span>
              </span>
              {previa.seriesExistentes > 0 && !remover && (
                <span className="text-amber-600">
                  Substitui {previa.seriesExistentes} lançamento{previa.seriesExistentes > 1 ? 's' : ''} da folha anterior.
                </span>
              )}
            </div>

            {matriz.length > 0 && (
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full border-collapse text-[11px] [&_td]:border-r [&_th]:border-r [&_td]:border-border/20 [&_th]:border-border/20 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
                  <thead>
                    <tr className="bg-muted border-b">
                      <th className="text-left font-medium px-2 py-1.5 min-w-[200px]">Componente</th>
                      {meses.map((m, i) => <th key={m} className="text-right font-medium px-2 py-1.5">{MESES_CURTOS[i]}</th>)}
                      <th className="text-right font-medium px-2 py-1.5">Ano</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matriz.map(r => (
                      <tr key={r.componente} className="border-b">
                        <td className="px-2 py-1">{ROTULO_COMPONENTE[r.componente]}</td>
                        {meses.map(m => (
                          <td key={m} className="px-2 py-1 text-right tabular-nums">
                            {r.porMes.get(m) ? fmtCentavos(r.porMes.get(m)!) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right tabular-nums font-medium">{fmtCentavos(r.total)}</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/40 font-semibold">
                      <td className="px-2 py-1.5">Total</td>
                      {meses.map(m => <td key={m} className="px-2 py-1.5 text-right tabular-nums">{fmtCentavos(totalMes(m))}</td>)}
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtCentavos(previa.totalCentavos)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {previa.porPessoa.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">Por pessoa</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-0.5">
                  {previa.porPessoa.map(p => (
                    <div key={p.personId} className="flex justify-between gap-2 border-b border-border/30 py-0.5">
                      <span className="truncate">{p.nome}</span>
                      <span className={cn('tabular-nums', p.centavos === 0 && 'text-muted-foreground')}>
                        {p.centavos === 0 ? 'sem lançamento' : fmtCentavos(p.centavos)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {remover && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-amber-800 dark:text-amber-300">
                {previa.porPessoa.length === 0 ? 'O quadro está vazio' : 'O quadro não gera nenhum valor'}, mas o orçamento ainda tem a folha anterior.
                Confirmar apaga {previa.seriesExistentes === 1 ? 'o lançamento' : `os ${previa.seriesExistentes} lançamentos`} da folha desta versão e não grava nada no lugar.
              </div>
            )}

            {previa.porPessoa.length === 0 && !remover && (
              <p className="text-muted-foreground">O quadro está vazio. Adicione pessoas antes de gerar.</p>
            )}

            <p className="text-[11px] text-muted-foreground">
              Datas de caixa: salários no dia 5 do mês seguinte (5º dia útil simplificado), encargos no dia 20, 13º em 30/nov e 20/dez.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isGenerating}>Cancelar</Button>
          {editavel && (
            <Button onClick={gerar} disabled={bloqueado || isGenerating}>
              {isGenerating ? (remover ? 'Removendo…' : 'Gerando…') : (remover ? 'Remover a folha' : 'Gerar folha')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
