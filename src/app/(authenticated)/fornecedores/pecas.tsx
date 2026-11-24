'use client'

// Peças pequenas que as três abas de /fornecedores compartilham. Ficam aqui, e não
// em /components, porque só esta tela as usa — no dia em que outra precisar, mudam
// de casa no mesmo commit (princípio 8).

import { cn } from '@/lib/utils'
import { PT_MONTHS_SHORT } from '@/lib/format'
import type { Classe } from '@/lib/fornecedores-types'

export const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const numero = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const inteiro = new Intl.NumberFormat('pt-BR')
export const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** "2026-08" → "Ago/26"; o mês corrente leva "(parcial)". */
export function rotuloMes(mes: string, mesCorrente: string): string {
  const r = `${PT_MONTHS_SHORT[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`
  return mes === mesCorrente ? `${r} (parcial)` : r
}

export function dataBR(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

export function ClasseChip({ classe }: { classe: Classe }) {
  return (
    <span className={cn(
      'inline-flex min-w-[1.6rem] justify-center rounded-full border px-1.5 text-[11px] font-medium',
      classe === 'A' && 'border-foreground bg-foreground text-background',
      classe === 'B' && 'border-muted-foreground',
      classe === 'C' && 'text-muted-foreground',
    )}>{classe}</span>
  )
}

/** O botão "+ Mesa" / "Na mesa" que aparece ao lado de cada fornecedor. */
export function BotaoMesa({ naMesa, salvando, podeEditar, nome, onClick }: {
  naMesa: boolean; salvando: boolean; podeEditar: boolean; nome: string; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      disabled={!podeEditar || salvando}
      aria-pressed={naMesa}
      aria-label={(naMesa ? 'Tirar da mesa: ' : 'Levar à mesa: ') + nome}
      title={podeEditar ? undefined : 'Só administradores e o proprietário alteram a mesa'}
      className={cn(
        'mr-2 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] leading-none whitespace-nowrap transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        naMesa
          ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
          : 'border-dashed border-muted-foreground/60 text-muted-foreground hover:border-solid hover:text-foreground',
      )}
    >
      {salvando ? 'salvando…' : naMesa ? 'Na mesa' : '+ Mesa'}
    </button>
  )
}

/** Uma célula numérica clicável (abre o detalhe). Vazia quando o valor é zero. */
export function CelulaValor({ valor, onClick, forte }: { valor: number; onClick?: () => void; forte?: boolean }) {
  if (!valor) return <td className="px-2 py-1.5 text-right" />
  const txt = numero.format(valor)
  return (
    <td className={cn('px-2 py-1.5 text-right tabular-nums', forte && 'font-medium')}>
      {onClick
        ? <button type="button" onClick={onClick} className="underline decoration-border underline-offset-2 hover:decoration-foreground">{txt}</button>
        : txt}
    </td>
  )
}

/** Caixa com rolagem própria e cabeçalho fixo — o padrão das tabelas do app. */
export function CaixaTabela({ children, alta }: { children: React.ReactNode; alta?: boolean }) {
  return (
    <div className={cn('overflow-auto rounded-lg border', alta ? 'max-h-[560px]' : 'max-h-[420px]')}>
      {children}
    </div>
  )
}

export const CLASSE_TABELA = 'w-full border-collapse text-xs tabular-nums [&_td]:border-b [&_td]:border-border/40 [&_td]:border-r [&_th]:border-r [&_td]:border-r-border/20 [&_th]:border-r-border/20 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0'
export const CLASSE_THEAD = 'sticky top-0 z-10 [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted-foreground [&_th]:whitespace-nowrap'
