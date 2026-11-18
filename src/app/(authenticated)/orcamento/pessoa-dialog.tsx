'use client'

// Criar ou editar uma pessoa do quadro. O vínculo vem primeiro porque decide
// quais campos existem; à direita, a prévia do custo roda ao vivo no navegador.

import { useEffect, useMemo, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { CellCombobox, CategoryCellCombobox } from '@/components/transacoes-shared/cell-combobox'
import type { CategoryItem, SimpleDimensionItem } from '@/components/transacoes-shared/types'
import { cn } from '@/lib/utils'
import {
  ROTULO_COMPONENTE, VINCULOS, VINCULO_LABELS, type ParametrosVersaoCalc,
} from '@/lib/payroll-types'
import type { PessoaDoQuadro, QuadroDaVersao } from '@/lib/payroll-write'
import type { LegalEntity } from '@/db/schema/legal-entities'
import { savePessoa } from '@/server/payroll'
import { COMPONENTES_DO_VINCULO, MESES_CURTOS, MESES_LONGOS, ROTULO_VALOR_BASE, inputCls, numParaCampo } from './folha-format'
import { TODOS_OS_MESES, formDaPessoa, formVazio, montarEntrada, ujParaCalculo, type Form } from './pessoa-form'
import { AlocacoesEditor, BeneficiosEditor } from './pessoa-linhas'
import { PessoaPrevia } from './pessoa-previa'

function MesSelect({ value, onChange, vazio, disabled, de = 1 }: {
  value: string; onChange: (v: string) => void; vazio?: string; disabled?: boolean; de?: number
}) {
  return (
    <select className={inputCls} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {vazio !== undefined && <option value="">{vazio}</option>}
      {TODOS_OS_MESES.filter(m => m >= de).map(m => <option key={m} value={m}>{MESES_LONGOS[m - 1]}</option>)}
    </select>
  )
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  versionId: string
  exercicio: number
  settings: QuadroDaVersao['settings']
  pessoa?: PessoaDoQuadro
  editavel: boolean
  legalEntities: LegalEntity[]
  costCenters: SimpleDimensionItem[]
  businessUnits: SimpleDimensionItem[]
  contactOptions: SimpleDimensionItem[]
  leafCategories: CategoryItem[]
  onSaved: () => void
}

export function PessoaDialog({
  open, onOpenChange, versionId, exercicio, settings, pessoa, editavel,
  legalEntities, costCenters, businessUnits, contactOptions, leafCategories, onSaved,
}: Props) {
  const [f, setF] = useState<Form>(formVazio)
  const [naturezasAbertas, setNaturezasAbertas] = useState(false)
  const [isSaving, startSaving] = useTransition()

  useEffect(() => {
    if (!open) return
    setF(pessoa ? formDaPessoa(pessoa) : formVazio())
    setNaturezasAbertas(!!pessoa && Object.keys(pessoa.naturezas).length > 0)
  }, [open, pessoa])

  const set = (patch: Partial<Form>) => setF(prev => ({ ...prev, ...patch }))

  const entrada = useMemo(() => montarEntrada(f), [f])
  const versaoCalc: ParametrosVersaoCalc = useMemo(() => ({
    modoProvisao: settings.modoProvisao,
    dissidioMes: settings.dissidioMes,
    dissidioPct: settings.dissidioPct === null ? null : settings.dissidioPct / 100,
  }), [settings])
  const uj = useMemo(
    () => ujParaCalculo(legalEntities.find(l => l.id === f.legalEntityId)),
    [legalEntities, f.legalEntityId],
  )

  const ujOptions: SimpleDimensionItem[] = legalEntities.map(l => ({ id: l.id, name: l.name, code: l.code }))
  const ehClt = f.vinculo === 'clt'
  const ehPj = f.vinculo === 'pj'
  const precisaUJ = ehClt || f.vinculo === 'pro_labore'
  const ro = !editavel || isSaving

  function salvar() {
    startSaving(async () => {
      const r = await savePessoa(versionId, entrada, pessoa?.id)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(pessoa ? 'Pessoa atualizada.' : 'Pessoa adicionada ao quadro.')
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{pessoa ? `Editar ${pessoa.nomeExibido}` : 'Adicionar pessoa'}</DialogTitle>
          <DialogDescription>
            O custo é calculado pelos parâmetros da versão e da unidade jurídica. Nada vai para o orçamento até você gerar a folha.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4 min-w-0">
            {/* Vínculo */}
            <div className="space-y-1.5">
              <Label className="text-xs">Vínculo</Label>
              <div className="flex gap-1">
                {VINCULOS.map(v => (
                  <button key={v} type="button" disabled={ro} onClick={() => set({ vinculo: v })}
                    className={cn('h-8 px-3 rounded-md border text-xs transition-colors disabled:opacity-50',
                      f.vinculo === v ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-input hover:bg-muted')}>
                    {VINCULO_LABELS[v]}
                  </button>
                ))}
              </div>
            </div>

            {/* Identificação */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Nome</Label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={f.isVaga} disabled={ro}
                      onChange={e => set({ isVaga: e.target.checked })} />
                    É vaga
                  </label>
                </div>
                <input className={inputCls} value={f.isVaga ? '' : f.nome} disabled={ro || f.isVaga}
                  placeholder={f.isVaga ? 'Vaga — aparece como "Vaga · cargo"' : 'Nome da pessoa'}
                  onChange={e => set({ nome: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cargo</Label>
                <input className={inputCls} value={f.cargo} disabled={ro} placeholder="Ex.: Analista financeiro"
                  onChange={e => set({ cargo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Unidade jurídica{precisaUJ ? '' : ' (opcional)'}
                </Label>
                <div className="border rounded-md">
                  <CellCombobox value={f.legalEntityId} options={ujOptions} placeholder="Escolha a unidade"
                    disabled={ro} onValueChange={v => set({ legalEntityId: v })} />
                </div>
                {precisaUJ && uj && !uj.regime && (
                  <p className="text-[11px] text-amber-600">Esta unidade não tem regime tributário informado.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Contato (opcional)</Label>
                <div className="border rounded-md">
                  <CellCombobox value={f.contactId} options={contactOptions} placeholder={ehPj ? 'Fornecedor PJ' : '—'}
                    disabled={ro} onValueChange={v => set({ contactId: v })} />
                </div>
              </div>
            </div>

            {/* Valores e período */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{ROTULO_VALOR_BASE[f.vinculo]}</Label>
                <input className={cn(inputCls, 'text-right tabular-nums')} value={f.valorBase} disabled={ro}
                  inputMode="decimal" placeholder="0,00" onChange={e => set({ valorBase: e.target.value })} />
              </div>
              {ehClt && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Outros proventos fixos (R$/mês)</Label>
                  <input className={cn(inputCls, 'text-right tabular-nums')} value={f.outrosProventos} disabled={ro}
                    inputMode="decimal" placeholder="0,00" onChange={e => set({ outrosProventos: e.target.value })} />
                </div>
              )}
              {ehPj && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Dia de pagamento (mês seguinte)</Label>
                  <input className={cn(inputCls, 'text-right tabular-nums')} value={f.diaPagamentoPj} disabled={ro}
                    inputMode="numeric" onChange={e => set({ diaPagamentoPj: e.target.value })} />
                </div>
              )}
            </div>

            {ehPj ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Meses com honorário em {exercicio}</Label>
                <div className="flex flex-wrap gap-1">
                  {TODOS_OS_MESES.map(m => {
                    const on = f.mesesPj.includes(m)
                    return (
                      <button key={m} type="button" disabled={ro}
                        onClick={() => set({ mesesPj: on ? f.mesesPj.filter(x => x !== m) : [...f.mesesPj, m] })}
                        className={cn('h-7 w-11 rounded-md border text-[11px] transition-colors disabled:opacity-50',
                          on ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-input text-muted-foreground hover:bg-muted')}>
                        {MESES_CURTOS[m - 1]}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Mês de entrada{f.isVaga ? ' (previsto)' : ''}</Label>
                  <MesSelect value={f.mesEntrada} disabled={ro} vazio={f.isVaga ? 'Escolha o mês' : 'janeiro (padrão)'}
                    onChange={v => set({ mesEntrada: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Mês de saída</Label>
                  <MesSelect value={f.mesSaida} disabled={ro} onChange={v => set({ mesSaida: v })} />
                </div>
                {ehClt && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Mês de férias</Label>
                    <MesSelect value={f.mesFerias} disabled={ro} vazio="aniversário da entrada"
                      onChange={v => set({ mesFerias: v })} />
                  </div>
                )}
              </div>
            )}

            {ehClt ? (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={f.aplicaDissidio} disabled={ro}
                  onChange={e => set({ aplicaDissidio: e.target.checked })} />
                Aplicar o dissídio da versão
                <span className="text-muted-foreground">
                  {settings.dissidioMes && settings.dissidioPct !== null
                    ? `(${numParaCampo(settings.dissidioPct)}% a partir de ${MESES_LONGOS[settings.dissidioMes - 1]})`
                    : '(a versão não tem dissídio)'}
                </span>
              </label>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Reajuste próprio — mês</Label>
                  <MesSelect value={f.reajusteMes} disabled={ro} vazio="sem reajuste"
                    onChange={v => set({ reajusteMes: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Reajuste (%)</Label>
                  <input className={cn(inputCls, 'text-right tabular-nums')} value={f.reajustePct}
                    disabled={ro || f.reajusteMes === ''} inputMode="decimal" placeholder="0"
                    onChange={e => set({ reajustePct: e.target.value })} />
                </div>
              </div>
            )}

            <AlocacoesEditor linhas={f.alocacoes} onChange={l => set({ alocacoes: l })}
              costCenters={costCenters} businessUnits={businessUnits} disabled={ro} />

            <BeneficiosEditor linhas={f.beneficios} onChange={l => set({ beneficios: l })}
              leafCategories={leafCategories} disabled={ro} />

            {/* Naturezas desta pessoa (recolhido) */}
            <div className="rounded-md border">
              <button type="button" onClick={() => setNaturezasAbertas(o => !o)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-left hover:bg-muted/40">
                {naturezasAbertas ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Naturezas desta pessoa
                <span className="text-muted-foreground">
                  — vazio usa o mapa da folha
                  {Object.values(entrada.naturezas ?? {}).length > 0 && ` · ${Object.values(entrada.naturezas ?? {}).length} exceção(ões)`}
                </span>
              </button>
              {naturezasAbertas && (
                <div className="px-2 pb-2 space-y-1">
                  {COMPONENTES_DO_VINCULO[f.vinculo].map(c => (
                    <div key={c} className="flex items-center gap-2">
                      <span className="w-56 shrink-0 text-[11px] text-muted-foreground">{ROTULO_COMPONENTE[c]}</span>
                      <div className="flex-1 border rounded-md">
                        <CategoryCellCombobox value={f.naturezas[c] ?? null} categories={leafCategories} disabled={ro}
                          emptyLabel="Natureza do mapa"
                          onValueChange={v => set({ naturezas: { ...f.naturezas, [c]: v ?? undefined } })} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Observação (opcional)</Label>
              <textarea className={cn(inputCls, 'h-14 py-1.5 resize-none')} value={f.observacao} disabled={ro}
                onChange={e => set({ observacao: e.target.value })} />
            </div>
          </div>

          <div className="lg:sticky lg:top-0 self-start">
            <PessoaPrevia input={entrada} versao={versaoCalc} uj={uj} exercicio={exercicio} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {editavel ? 'Cancelar' : 'Fechar'}
          </Button>
          {editavel && (
            <Button onClick={salvar} disabled={isSaving}>
              {isSaving ? 'Salvando…' : pessoa ? 'Salvar' : 'Adicionar'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
