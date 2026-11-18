'use client'

// As duas listas editáveis do diálogo da pessoa: alocações (CC + UEN + %) e
// benefícios (nome + valor + natureza opcional). Estado em texto — quem
// converte para número é o diálogo, na hora de montar a entrada.

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { CellCombobox, CategoryCellCombobox } from '@/components/transacoes-shared/cell-combobox'
import type { CategoryItem, SimpleDimensionItem } from '@/components/transacoes-shared/types'
import { cn } from '@/lib/utils'
import { parseAmount } from '@/lib/format'
import { inputCls } from './folha-format'
import { novaChave, type AlocacaoForm, type BeneficioForm } from './pessoa-form'

const iconBtn =
  'h-7 w-7 shrink-0 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted disabled:opacity-30 disabled:pointer-events-none'

export function AlocacoesEditor({
  linhas, onChange, costCenters, businessUnits, disabled,
}: {
  linhas: AlocacaoForm[]
  onChange: (l: AlocacaoForm[]) => void
  costCenters: SimpleDimensionItem[]
  businessUnits: SimpleDimensionItem[]
  disabled?: boolean
}) {
  const soma = linhas.reduce((s, l) => s + Math.round((parseAmount(l.percentual) ?? 0) * 100), 0) / 100
  const fecha = Math.abs(soma - 100) < 0.005
  const set = (key: string, patch: Partial<AlocacaoForm>) =>
    onChange(linhas.map(l => (l.key === key ? { ...l, ...patch } : l)))

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-xs">Alocação</Label>
        {linhas.length > 0 && (
          <span className={cn('text-[11px] tabular-nums', fecha ? 'text-muted-foreground' : 'text-rose-600 font-medium')}>
            soma {soma.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%{!fecha && ' — precisa fechar 100%'}
          </span>
        )}
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 text-[11px] gap-1" disabled={disabled}
          onClick={() => onChange([...linhas, {
            key: novaChave(), costCenterId: null, businessUnitId: null,
            percentual: linhas.length === 0 ? '100' : String(Math.max(0, Math.round((100 - soma) * 100) / 100)).replace('.', ','),
          }])}>
          <Plus className="h-3 w-3" /> Adicionar
        </Button>
      </div>
      {linhas.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Sem alocação, os lançamentos saem sem centro de custo e sem unidade de negócio.
        </p>
      ) : (
        <div className="space-y-1">
          {linhas.map(l => (
            <div key={l.key} className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0 border rounded-md">
                <CellCombobox value={l.costCenterId} options={costCenters} placeholder="Centro de custo"
                  onValueChange={v => set(l.key, { costCenterId: v })} disabled={disabled} />
              </div>
              <div className="flex-1 min-w-0 border rounded-md">
                <CellCombobox value={l.businessUnitId} options={businessUnits} placeholder="Unidade de negócio"
                  onValueChange={v => set(l.key, { businessUnitId: v })} disabled={disabled} />
              </div>
              <div className="w-20 relative">
                <input className={cn(inputCls, 'text-right pr-5 tabular-nums')} value={l.percentual} disabled={disabled}
                  inputMode="decimal" aria-label="Percentual"
                  onChange={e => set(l.key, { percentual: e.target.value })} />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
              </div>
              <button type="button" className={iconBtn} disabled={disabled} title="Remover"
                onClick={() => onChange(linhas.filter(x => x.key !== l.key))}>
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function BeneficiosEditor({
  linhas, onChange, leafCategories, disabled,
}: {
  linhas: BeneficioForm[]
  onChange: (l: BeneficioForm[]) => void
  leafCategories: CategoryItem[]
  disabled?: boolean
}) {
  const set = (key: string, patch: Partial<BeneficioForm>) =>
    onChange(linhas.map(l => (l.key === key ? { ...l, ...patch } : l)))

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-xs">Benefícios</Label>
        <span className="text-[11px] text-muted-foreground">custo mensal para a empresa, já líquido do desconto</span>
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 text-[11px] gap-1" disabled={disabled}
          onClick={() => onChange([...linhas, { key: novaChave(), nome: '', valor: '', categoryId: null }])}>
          <Plus className="h-3 w-3" /> Adicionar
        </Button>
      </div>
      {linhas.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Nenhum benefício.</p>
      ) : (
        <div className="space-y-1">
          {linhas.map(l => (
            <div key={l.key} className="flex items-center gap-1.5">
              <input className={cn(inputCls, 'flex-1 min-w-0')} placeholder="Ex.: Vale-refeição" value={l.nome}
                disabled={disabled} onChange={e => set(l.key, { nome: e.target.value })} />
              <input className={cn(inputCls, 'w-28 text-right tabular-nums')} placeholder="0,00" value={l.valor}
                inputMode="decimal" disabled={disabled} aria-label="Valor mensal"
                onChange={e => set(l.key, { valor: e.target.value })} />
              <div className="w-56 border rounded-md">
                <CategoryCellCombobox value={l.categoryId} categories={leafCategories} disabled={disabled}
                  emptyLabel="Natureza do mapa" onValueChange={v => set(l.key, { categoryId: v })} />
              </div>
              <button type="button" className={iconBtn} disabled={disabled} title="Remover"
                onClick={() => onChange(linhas.filter(x => x.key !== l.key))}>
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
