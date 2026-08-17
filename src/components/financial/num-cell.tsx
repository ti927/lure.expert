'use client'

import { cn } from '@/lib/utils'
import { fmtNum } from '@/lib/format'

// Célula de valor das matrizes de 12 meses (DRE, Fluxo, Orçado × Realizado).
// Renderiza o <td> inteiro — zero vira travessão, positivo é verde, negativo é
// vermelho, e a célula só é clicável quando tem valor.

interface NumCellProps {
  value: number
  bold?: boolean
  /** Zero ainda mais apagado — usado nas linhas de detalhe da DRE. */
  light?: boolean
  /** Linha de fundo escuro: inverte a paleta para tons claros. */
  inverted?: boolean
  /** Sobrescreve a cor do zero (o /fluxo usa um tom fixo). */
  zeroClassName?: string
  /** Formatação alternativa do número (ex.: percentual). */
  format?: (v: number) => string
  className?: string
  title?: string
  onClick?: () => void
}

export function Num({
  value, bold, light, inverted, zeroClassName, format, className, title, onClick,
}: NumCellProps) {
  const isZero = value === 0
  const clickable = !isZero && !!onClick

  let colorClass: string
  if (isZero) {
    colorClass = zeroClassName ?? (light ? 'text-muted-foreground/25' : 'text-muted-foreground/40')
  } else if (inverted) {
    colorClass = value > 0 ? 'text-emerald-300' : 'text-rose-300'
  } else {
    colorClass = value > 0 ? 'text-emerald-700' : 'text-rose-600'
  }

  return (
    <td
      title={title}
      className={cn(
        'px-3 py-[3px] text-right tabular-nums text-xs',
        bold && 'font-semibold',
        colorClass,
        clickable && 'cursor-pointer hover:underline underline-offset-2',
        className,
      )}
      onClick={clickable ? onClick : undefined}
    >
      {isZero ? '—' : (format ?? fmtNum)(value)}
    </td>
  )
}
