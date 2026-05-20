'use client'

import { useState, useTransition, useMemo, useEffect, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Scale, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BpAllData, BpPai } from '@/server/balance-sheet'

const LABEL_W = 260
const COL_W = 96

function fmtBRL(v: number): string {
  if (v === 0) return '—'
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function monthLabel(date: string): string {
  const [y, m] = date.split('-')
  const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${monthNames[parseInt(m, 10) - 1]}/${y.slice(2)}`
}

function getLeafIds(pai: BpPai): string[] {
  return pai.filhos.length > 0 ? pai.filhos.map(f => f.id) : [pai.id]
}

function sumLeaves(leafIds: string[], date: string, amounts: BpAllData['amounts']): number {
  const byDate = amounts[date] ?? {}
  return leafIds.reduce((acc, id) => acc + (byDate[id] ?? 0), 0)
}

interface Props {
  data: BpAllData
  defaultFrom: string
  defaultTo: string
  hasUrlParams: boolean
}

export function BalancoClient({ data, defaultFrom, defaultTo, hasUrlParams }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)

  useEffect(() => {
    if (hasUrlParams) return
    try {
      const saved = localStorage.getItem('lure:balanco:filters')
      if (!saved) return
      const { from: f, to: t } = JSON.parse(saved) as { from?: string; to?: string }
      if (!f || !t) return
      if (f === defaultFrom && t === defaultTo) return
      startTransition(() => {
        router.push(`/balanco?from=${f}&to=${t}`)
      })
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleFilter() {
    try {
      localStorage.setItem('lure:balanco:filters', JSON.stringify({ from, to }))
    } catch {}
    startTransition(() => {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      router.push(`/balanco?${params.toString()}`)
    })
  }

  // Totais das seções ATIVO e PASSIVO por data
  const sectionTotals = useMemo(() => {
    return data.sections.map(section => {
      const allLeafIds = section.groups.flatMap(g => g.pais.flatMap(p => getLeafIds(p)))
      return data.dates.map(date => sumLeaves(allLeafIds, date, data.amounts))
    })
  }, [data])

  // Patrimônio Líquido = ATIVO − PASSIVO (calculado; seções [0] e [1] respectivamente)
  const plByDate = useMemo(() => {
    const ativo   = sectionTotals[0] ?? []
    const passivo = sectionTotals[1] ?? []
    return data.dates.map((_, i) => (ativo[i] ?? 0) - (passivo[i] ?? 0))
  }, [sectionTotals, data.dates])

  if (data.dates.length === 0) {
    return (
      <div className="space-y-4">
        <FilterBar from={from} to={to} onFromChange={setFrom} onToChange={setTo} onFilter={handleFilter} isPending={isPending} />
        <div className="flex flex-col items-center py-16 px-6 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Scale className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h3 className="text-base font-semibold text-foreground">Nenhum Balanço Patrimonial importado</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-xs">
            Importe um relatório de BP com data de referência para visualizar o balanço aqui.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-4">
            <Link href="/upload">
              <UploadCloud className="h-4 w-4 mr-1.5" />
              Importar relatório de BP
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <FilterBar from={from} to={to} onFromChange={setFrom} onToChange={setTo} onFilter={handleFilter} isPending={isPending} />

      <div className="border rounded-lg overflow-x-auto">
        <table
          className="text-sm border-collapse"
          style={{ width: LABEL_W + COL_W * data.dates.length + 'px', minWidth: '100%' }}
        >
          <colgroup>
            <col style={{ width: LABEL_W }} />
            {data.dates.map(d => <col key={d} style={{ width: COL_W }} />)}
          </colgroup>

          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-800 text-white">
              <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ width: LABEL_W }}>
                Conta
              </th>
              {data.dates.map(d => (
                <th key={d} className="px-2 py-2.5 text-right text-xs font-semibold tabular-nums">
                  {monthLabel(d)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {data.sections.map((section, sIdx) => {
              const isPL = section.label === 'PATRIMÔNIO LÍQUIDO'
              // Seção PL: usa valores calculados; demais seções: soma das folhas
              const sectionValues = isPL ? plByDate : sectionTotals[sIdx]

              return (
                <Fragment key={section.label}>
                  {/* Separador entre seções */}
                  {sIdx > 0 && (
                    <tr>
                      <td colSpan={data.dates.length + 1} className="h-2 bg-muted/20" />
                    </tr>
                  )}

                  {/* Linha de seção */}
                  <tr className="bg-slate-800 text-white">
                    <td className="px-4 py-2 text-xs font-bold tracking-wide uppercase sticky left-0 bg-slate-800">
                      {section.label}
                    </td>
                    {sectionValues.map((val, dIdx) => (
                      <td
                        key={data.dates[dIdx]}
                        className={cn(
                          'px-2 py-2 text-right text-xs font-bold tabular-nums',
                          val === 0 && 'text-slate-400',
                          isPL && val < 0 && 'text-rose-400',
                        )}
                      >
                        {fmtBRL(val)}
                      </td>
                    ))}
                  </tr>

                  {/* ATIVO e PASSIVO: grupos, pais e filhos. PL exibe só o total calculado. */}
                  {!isPL && section.groups.map(group => {
                    const groupLeafIds = group.pais.flatMap(p => getLeafIds(p))
                    const groupTotals = data.dates.map(d => sumLeaves(groupLeafIds, d, data.amounts))

                    return (
                      <Fragment key={group.bpType}>
                        {/* Linha de grupo */}
                        <tr className="bg-slate-100/70 border-b border-slate-200">
                          <td className="px-4 py-1.5 text-xs font-semibold text-foreground sticky left-0 bg-slate-100/70">
                            {group.label}
                          </td>
                          {groupTotals.map((total, dIdx) => (
                            <td key={data.dates[dIdx]} className={cn('px-2 py-1.5 text-right text-xs font-semibold tabular-nums', total === 0 && 'text-muted-foreground/40')}>
                              {fmtBRL(total)}
                            </td>
                          ))}
                        </tr>

                        {group.pais.length === 0 && (
                          <tr>
                            <td colSpan={data.dates.length + 1} className="px-10 py-1.5 text-xs text-muted-foreground italic">
                              Sem categorias cadastradas
                            </td>
                          </tr>
                        )}

                        {group.pais.map(pai => {
                          const paiLeafIds = getLeafIds(pai)
                          const paiTotals = data.dates.map(d => sumLeaves(paiLeafIds, d, data.amounts))
                          const hasFilhos = pai.filhos.length > 0

                          return (
                            <Fragment key={pai.id}>
                              <tr className="border-b border-border/40 hover:bg-muted/10">
                                <td className="py-1.5 text-xs font-medium text-foreground sticky left-0 bg-background" style={{ paddingLeft: 40 }}>
                                  {pai.code && <span className="text-muted-foreground mr-1.5">{pai.code}</span>}
                                  {pai.name}
                                </td>
                                {paiTotals.map((total, dIdx) => (
                                  <td key={data.dates[dIdx]} className={cn('px-2 py-1.5 text-right text-xs font-medium tabular-nums', total === 0 && 'text-muted-foreground/40')}>
                                    {fmtBRL(total)}
                                  </td>
                                ))}
                              </tr>

                              {hasFilhos && pai.filhos.map(filho => {
                                const filhoTotals = data.dates.map(d => (data.amounts[d] ?? {})[filho.id] ?? 0)
                                return (
                                  <tr key={filho.id} className="border-b border-border/20 hover:bg-muted/10">
                                    <td className="py-1 text-xs text-muted-foreground sticky left-0 bg-background" style={{ paddingLeft: 56 }}>
                                      {filho.code && <span className="mr-1.5">{filho.code}</span>}
                                      {filho.name}
                                    </td>
                                    {filhoTotals.map((total, dIdx) => (
                                      <td key={data.dates[dIdx]} className={cn('px-2 py-1 text-right text-xs tabular-nums', total === 0 && 'text-muted-foreground/30')}>
                                        {fmtBRL(total)}
                                      </td>
                                    ))}
                                  </tr>
                                )
                              })}
                            </Fragment>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        * Patrimônio Líquido calculado como Ativo − Passivo.
      </p>
    </div>
  )
}

function FilterBar({
  from, to, onFromChange, onToChange, onFilter, isPending,
}: {
  from: string
  to: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
  onFilter: () => void
  isPending: boolean
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground">De</label>
        <input
          type="month"
          value={from}
          onChange={e => onFromChange(e.target.value)}
          className="h-8 rounded-md border border-input px-2 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground">Até</label>
        <input
          type="month"
          value={to}
          onChange={e => onToChange(e.target.value)}
          className="h-8 rounded-md border border-input px-2 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <Button size="sm" onClick={onFilter} disabled={isPending}>
        {isPending ? 'Carregando...' : 'Filtrar'}
      </Button>
    </div>
  )
}
