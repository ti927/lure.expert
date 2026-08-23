'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { KeyRound, ShieldCheck, TriangleAlert, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { saveAiKey, removeAiKey, saveAiLimit, type AiSettingsView } from '@/server/ai-settings'

const fmtUsd = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function AiKeyManager({ inicial, taxaUsdBrl }: { inicial: AiSettingsView; taxaUsdBrl: number }) {
  const router = useRouter()
  const [isPending, start] = useTransition()

  const [chave, setChave] = useState('')
  const [removendo, setRemovendo] = useState(false)
  const [teto, setTeto] = useState(inicial.tetoUsd === null ? '' : String(inicial.tetoUsd))
  const [limiar, setLimiar] = useState(String(inicial.limiarAlerta))

  const temChave = !!inicial.ultimos4
  const naPlataforma = inicial.origem === 'platform'
  // O caso que precisa gritar: a organização se comprometeu a trazer a própria
  // chave e não tem nenhuma. A IA está desligada agora.
  const desligada = !naPlataforma && !temChave

  function salvarChave() {
    start(async () => {
      const r = await saveAiKey(chave)
      if ('error' in r && r.error) { toast.error(r.error); return }
      toast.success('Chave testada e salva. O expert voltou a funcionar nesta organização.')
      setChave('')
      router.refresh()
    })
  }

  function remover() {
    start(async () => {
      await removeAiKey()
      setRemovendo(false)
      toast.success('Chave removida. O expert está desligado nesta organização.')
      router.refresh()
    })
  }

  function salvarLimite() {
    const t = teto.trim() === '' ? null : Number(teto.replace(',', '.'))
    const l = Number(limiar.replace(',', '.'))
    if (t !== null && !Number.isFinite(t)) { toast.error('Limite inválido.'); return }
    if (!Number.isFinite(l) || l < 1 || l > 100) { toast.error('O aviso precisa ficar entre 1% e 100%.'); return }
    start(async () => {
      const r = await saveAiLimit({ tetoUsd: t, limiarAlerta: l })
      if ('error' in r && r.error) { toast.error(r.error); return }
      toast.success(t === null ? 'Limite removido.' : `Limite de US$ ${fmtUsd(t)} salvo.`)
      router.refresh()
    })
  }

  const pctUsado = inicial.tetoUsd && inicial.tetoUsd > 0
    ? Math.min(100, (inicial.gastoMesUsd / inicial.tetoUsd) * 100)
    : null

  return (
    <div className="space-y-4">
      {!inicial.cryptoPronta && (
        <p className="text-xs text-rose-600 flex items-start gap-1.5">
          <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          O servidor não está configurado para guardar chaves com segurança. Cadastrar chave vai
          falhar até isso ser resolvido.
        </p>
      )}

      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Chave de IA</CardTitle>
              <CardDescription className="mt-1.5">
                O expert usa a API da Anthropic para classificar lançamentos e ler extratos em PDF.
                Com chave própria, o consumo é cobrado direto na sua conta e você acompanha aqui.
              </CardDescription>
            </div>
            <div className={cn(
              'flex items-center gap-1.5 text-xs px-2 py-1 rounded-md shrink-0',
              desligada     ? 'bg-rose-50 text-rose-700'
              : temChave    ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600',
            )}>
              {desligada ? <TriangleAlert className="h-3.5 w-3.5" />
                : temChave ? <ShieldCheck className="h-3.5 w-3.5" />
                : <KeyRound className="h-3.5 w-3.5" />}
              {desligada ? 'Expert desligado' : temChave ? 'Chave própria' : 'Chave da Lure'}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {desligada && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-1">
              <p className="font-medium">O expert está desligado nesta organização.</p>
              <p>
                Lançamentos continuam sendo classificados por regras e pelo histórico, e planilhas
                continuam importando. <strong>Extratos em PDF não funcionam</strong> — a leitura de
                PDF depende do expert e não tem alternativa.
              </p>
            </div>
          )}

          {naPlataforma && (
            <p className="text-xs text-muted-foreground">
              Esta organização usa a chave da Lure. Ao cadastrar uma chave própria, o consumo passa
              a ser cobrado na sua conta da Anthropic — e essa mudança não tem volta pela tela.
            </p>
          )}

          {temChave && (
            <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-3 py-2">
              <div className="text-xs">
                <p className="font-medium text-foreground tabular-nums">···· ···· {inicial.ultimos4}</p>
                <p className="text-muted-foreground mt-0.5">
                  {inicial.validadaEm
                    ? `Testada em ${new Date(inicial.validadaEm).toLocaleDateString('pt-BR')}`
                    : 'Ainda não testada'}
                </p>
              </div>
              <Button variant="outline" size="sm" disabled={isPending}
                onClick={() => setRemovendo(true)}
                className="text-destructive border-destructive/40 hover:bg-destructive/5">
                <Trash2 className="h-3.5 w-3.5 mr-1" />Remover
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="chave-ia" className="text-xs">
              {temChave ? 'Substituir por outra chave' : 'Chave da Anthropic'}
            </Label>
            <div className="flex gap-2">
              <Input
                id="chave-ia" type="password" value={chave} autoComplete="off"
                onChange={e => setChave(e.target.value)}
                placeholder="sk-ant-api03-…"
                className="h-8 text-sm font-mono"
              />
              <Button size="sm" onClick={salvarChave}
                disabled={isPending || chave.trim().length < 20 || !inicial.cryptoPronta}>
                {isPending ? 'Testando…' : 'Testar e salvar'}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              A chave é testada contra a Anthropic antes de ser guardada, e fica cifrada no banco —
              depois de salva, nem esta tela consegue lê-la de volta. Você a obtém em
              console.anthropic.com, em API Keys.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Limite mensal</CardTitle>
          <CardDescription className="mt-1.5">
            Ao atingir o limite, o expert para de classificar até o mês virar. A importação continua
            funcionando pelas regras e pelo histórico — nada trava.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pctUsado !== null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  US$ {fmtUsd(inicial.gastoMesUsd)} de US$ {fmtUsd(inicial.tetoUsd!)} neste mês
                </span>
                <span className={cn('tabular-nums font-medium',
                  pctUsado >= 100 ? 'text-rose-600' : pctUsado >= inicial.limiarAlerta ? 'text-amber-600' : 'text-muted-foreground')}>
                  {pctUsado.toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className={cn('h-full rounded-full',
                  pctUsado >= 100 ? 'bg-rose-500' : pctUsado >= inicial.limiarAlerta ? 'bg-amber-500' : 'bg-emerald-600')}
                  style={{ width: `${pctUsado}%` }} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="teto-ia" className="text-xs">Limite em dólar</Label>
              <Input id="teto-ia" value={teto} inputMode="decimal"
                onChange={e => setTeto(e.target.value)}
                placeholder="sem limite" className="h-8 w-36 text-sm tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="limiar-ia" className="text-xs">Avisar em</Label>
              <div className="flex items-center gap-1">
                <Input id="limiar-ia" value={limiar} inputMode="numeric"
                  onChange={e => setLimiar(e.target.value)}
                  className="h-8 w-20 text-sm tabular-nums" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={salvarLimite} disabled={isPending}>
              {isPending ? 'Salvando…' : 'Salvar limite'}
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Em branco significa <strong>sem limite</strong>. Zero significa <strong>expert
            desligado</strong> — não é o mesmo. O valor equivale a
            {teto.trim() && Number.isFinite(Number(teto.replace(',', '.')))
              ? ` R$ ${fmtUsd(Number(teto.replace(',', '.')) * taxaUsdBrl)}`
              : ' — '}
            pelo câmbio usado nesta tela.
          </p>
        </CardContent>
      </Card>

      <AlertDialog open={removendo} onOpenChange={v => !v && setRemovendo(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a chave de IA?</AlertDialogTitle>
            <AlertDialogDescription>
              O expert para de classificar lançamentos e <strong>extratos em PDF deixam de
              funcionar</strong> nesta organização. Planilhas e CSV continuam importando, e a
              classificação segue pelas regras e pelo histórico. Você pode cadastrar outra chave a
              qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={remover} disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isPending ? 'Removendo…' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
