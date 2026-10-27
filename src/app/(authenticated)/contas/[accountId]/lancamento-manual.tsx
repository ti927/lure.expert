'use client'

// Lançar à mão numa conta manual, e restaurar o lançamento manual apagado.
// A regra mora em `lib/lancamento-manual.ts` (Decisão 30).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Loader2, History, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { CategoryCellCombobox } from '@/components/transacoes-shared/cell-combobox'
import { formatBRL } from '@/components/transacoes-shared/transactions-table'
import { parseAmount } from '@/lib/format'
import { cn } from '@/lib/utils'
import { lancarManual, getManuaisApagados, restaurarManual } from '@/server/lancamento-manual'
import type { ManualApagado } from '@/lib/lancamento-manual'
import type { Category } from '@/db/schema/categories'
import { dataBR } from './cabecalho-da-conta'

const CHAVE_DISPOSITIVO = 'lure:dispositivo'

/**
 * O identificador deste navegador: um código aleatório criado na primeira vez e
 * lembrado aqui. Diferencia "o notebook do escritório" do "celular", mas some
 * se o navegador for limpo — é pista, não prova, e é dito assim.
 */
function idDoDispositivo(): string | null {
  try {
    let id = localStorage.getItem(CHAVE_DISPOSITIVO)
    if (!id) {
      id = crypto.randomUUID().slice(0, 8)
      localStorage.setItem(CHAVE_DISPOSITIVO, id)
    }
    return id
  } catch { return null }
}

function hoje(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function LancarManual({ accountId, categories, dataPadrao }: {
  accountId: string
  categories: Category[]
  /** Na fatura aberta, o vencimento dela vira a data de caixa sugerida. */
  dataPadrao?: { caixa?: string }
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [data, setData] = useState(hoje())
  const [dataCaixa, setDataCaixa] = useState('')
  const [valor, setValor] = useState('')
  const [sentido, setSentido] = useState<'inflow' | 'outflow'>('outflow')
  const [descricao, setDescricao] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [salvando, startSalvar] = useTransition()

  function abrir() {
    setData(hoje()); setDataCaixa(dataPadrao?.caixa ?? ''); setValor(''); setSentido('outflow')
    setDescricao(''); setCategoryId(null); setAberto(true)
  }

  function salvar() {
    const v = parseAmount(valor)
    if (v === null || v === 0) { toast.error('Informe o valor (ex.: 1.234,56).'); return }
    startSalvar(async () => {
      const r = await lancarManual(accountId, {
        data, dataCaixa: dataCaixa || null, valor: Math.abs(v), sentido, descricao, categoryId,
      }, idDoDispositivo())
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Lançamento manual criado.')
      setAberto(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={abrir}>
        <Plus className="h-4 w-4" />Lançar
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Lançamento manual</DialogTitle>
            <DialogDescription>
              Fica marcado como <strong>manual</strong>, com quem lançou, a data e a hora, o navegador e
              o IP. Se for apagado, pode ser restaurado pela conferência desta conta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lm-data">Data (competência)</Label>
                <Input id="lm-data" type="date" value={data} onChange={e => setData(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lm-caixa">Data de caixa</Label>
                <Input id="lm-caixa" type="date" value={dataCaixa} onChange={e => setDataCaixa(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">Vazia = a mesma da competência.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lm-valor">Valor (R$)</Label>
                <Input id="lm-valor" inputMode="decimal" placeholder="1.234,56" value={valor}
                  onChange={e => setValor(e.target.value)} className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label>Sentido</Label>
                <div className="flex h-9 rounded-md border p-0.5">
                  {(['inflow', 'outflow'] as const).map(s => (
                    <button key={s} type="button" onClick={() => setSentido(s)}
                      className={cn('flex-1 rounded text-xs font-medium transition-colors',
                        sentido === s
                          ? (s === 'inflow' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')
                          : 'text-muted-foreground hover:bg-muted/50')}>
                      {s === 'inflow' ? 'Entrada' : 'Saída'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lm-desc">Descrição</Label>
              <Input id="lm-desc" value={descricao} maxLength={300} onChange={e => setDescricao(e.target.value)}
                placeholder="ex.: tarifa de manutenção de setembro" />
            </div>
            <div className="space-y-1.5">
              <Label>Natureza (opcional)</Label>
              <div className="rounded-md border">
                <CategoryCellCombobox value={categoryId} categories={categories} onValueChange={setCategoryId} emptyLabel="sem natureza" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={salvando}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando || !descricao.trim()}>
              {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Lançar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ManuaisApagados({ accountId }: { accountId: string }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [lista, setLista] = useState<ManualApagado[] | null>(null)
  const [restaurando, setRestaurando] = useState<string | null>(null)

  async function abrir() {
    setAberto(true); setLista(null)
    setLista(await getManuaisApagados(accountId))
  }

  async function restaurar(eventoId: string) {
    setRestaurando(eventoId)
    const r = await restaurarManual(accountId, eventoId)
    setRestaurando(null)
    if ('error' in r) { toast.error(r.error); return }
    toast.success('Lançamento restaurado.')
    setLista(prev => prev?.filter(x => x.eventoId !== eventoId) ?? null)
    router.refresh()
  }

  return (
    <>
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={abrir}
        title="Lançamentos manuais apagados nos últimos 90 dias">
        <History className="h-4 w-4" />Apagados
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Lançamentos manuais apagados</DialogTitle>
            <DialogDescription>
              Os últimos 90 dias. Restaurar devolve o lançamento como era, com a natureza, as
              dimensões e o rateio, e marca quem restaurou.
            </DialogDescription>
          </DialogHeader>
          {lista === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /></p>
          ) : lista.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum lançamento manual apagado nesta conta.</p>
          ) : (
            <div className="max-h-96 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Data</th>
                    <th className="px-2 py-1.5 text-left font-medium">Descrição</th>
                    <th className="px-2 py-1.5 text-right font-medium">Valor</th>
                    <th className="px-2 py-1.5 text-left font-medium">Apagado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lista.map(a => (
                    <tr key={a.eventoId} className="border-t">
                      <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{dataBR(a.data)}</td>
                      <td className="px-2 py-1.5">
                        <div className="truncate max-w-[220px]" title={a.descricao}>{a.descricao}</div>
                        {a.lancadoPor && <div className="text-[10px] text-muted-foreground">lançado por {a.lancadoPor}</div>}
                      </td>
                      <td className={cn('px-2 py-1.5 text-right tabular-nums whitespace-nowrap',
                        a.sentido === 'inflow' ? 'text-emerald-600' : 'text-rose-600')}>
                        {a.sentido === 'outflow' && '−'}{formatBRL(a.valor)}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                        {new Date(a.apagadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        {a.apagadoPor && <div className="text-[10px]">por {a.apagadoPor}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
                          disabled={restaurando === a.eventoId} onClick={() => restaurar(a.eventoId)}>
                          {restaurando === a.eventoId ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                          Restaurar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
