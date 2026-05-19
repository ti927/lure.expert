'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Scale, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { BpData } from '@/server/balance-sheet'
import { type BpType, BP_TYPE_LABELS } from '@/lib/bp-types'

function fmt(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

const BP_GROUPS: { label: string; types: BpType[]; section: 'ativo' | 'passivo_pl' }[] = [
  { label: 'Ativo Circulante', types: ['ativo_circulante'], section: 'ativo' },
  { label: 'Ativo Não-Circulante', types: ['ativo_nao_circulante'], section: 'ativo' },
  { label: 'Passivo Circulante', types: ['passivo_circulante'], section: 'passivo_pl' },
  { label: 'Passivo Não-Circulante', types: ['passivo_nao_circulante'], section: 'passivo_pl' },
  { label: 'Patrimônio Líquido', types: ['patrimonio_liquido'], section: 'passivo_pl' },
]

interface Props {
  initialData: BpData | null
  initialDate: string
}

export function BalancoClient({ initialData, initialDate }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [date, setDate] = useState(initialDate)
  const [data, setData] = useState<BpData | null>(initialData)
  const [notFound, setNotFound] = useState(initialData === null && !!initialDate)

  function handleFilter() {
    startTransition(() => {
      const params = new URLSearchParams()
      if (date) params.set('date', date)
      router.push(`/balanco?${params.toString()}`)
    })
  }

  const totals = useMemo(() => {
    if (!data) return null
    const sum = (types: BpType[]) =>
      data.rows.filter(r => types.includes(r.parentType)).reduce((acc, r) => acc + r.total, 0)

    const ativoCirc = sum(['ativo_circulante'])
    const ativoNaoCirc = sum(['ativo_nao_circulante'])
    const passivoCirc = sum(['passivo_circulante'])
    const passivoNaoCirc = sum(['passivo_nao_circulante'])
    const pl = sum(['patrimonio_liquido'])

    const totalAtivo = ativoCirc + ativoNaoCirc
    const totalPassivo = passivoCirc + passivoNaoCirc
    const totalPassivoMaisPl = totalPassivo + pl

    return { ativoCirc, ativoNaoCirc, passivoCirc, passivoNaoCirc, pl, totalAtivo, totalPassivo, totalPassivoMaisPl }
  }, [data])

  return (
    <div className="space-y-6">
      {/* Filtro de data */}
      <div className="flex items-end gap-3">
        <div>
          <Label htmlFor="bp-date" className="text-xs mb-1 block">Data de referência</Label>
          <Input
            id="bp-date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-44"
          />
        </div>
        <Button size="sm" onClick={handleFilter} disabled={isPending || !date}>
          {isPending ? 'Carregando...' : 'Ver BP'}
        </Button>
      </div>

      {!date && (
        <div className="flex flex-col items-center py-16 px-6 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Scale className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h3 className="text-base font-semibold text-foreground">Selecione uma data de referência</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-xs">
            Escolha a data do snapshot de BP que deseja visualizar acima.
          </p>
        </div>
      )}

      {date && notFound && !isPending && (
        <div className="flex flex-col items-center py-16 px-6 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Scale className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h3 className="text-base font-semibold text-foreground">Nenhum BP encontrado</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-xs">
            Não há nenhum relatório de Balanço Patrimonial importado com data de referência até {fmtDate(date)}.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-4">
            <Link href="/upload">
              <UploadCloud className="h-4 w-4 mr-1.5" />
              Importar relatório de BP
            </Link>
          </Button>
        </div>
      )}

      {data && totals && (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Snapshot de <span className="font-medium text-foreground">{fmtDate(data.referenceDate)}</span></p>
        </div>
      )}

      {data && totals && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ATIVO */}
          <BpSection
            title="ATIVO"
            groups={BP_GROUPS.filter(g => g.section === 'ativo')}
            rows={data.rows}
            total={totals.totalAtivo}
            totalLabel="Total Ativo"
          />

          {/* PASSIVO + PL */}
          <BpSection
            title="PASSIVO E PATRIMÔNIO LÍQUIDO"
            groups={BP_GROUPS.filter(g => g.section === 'passivo_pl')}
            rows={data.rows}
            total={totals.totalPassivoMaisPl}
            totalLabel="Total Passivo + PL"
          />
        </div>
      )}

      {data && totals && (
        <BalanceCheck totalAtivo={totals.totalAtivo} totalPassivoMaisPl={totals.totalPassivoMaisPl} />
      )}
    </div>
  )
}

function BpSection({
  title,
  groups,
  rows,
  total,
  totalLabel,
}: {
  title: string
  groups: typeof BP_GROUPS
  rows: BpData['rows']
  total: number
  totalLabel: string
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-800 text-white">
        <span className="text-xs font-semibold tracking-wide uppercase">{title}</span>
      </div>
      <div className="divide-y">
        {groups.map(group => {
          const groupRows = rows.filter(r => group.types.includes(r.parentType))
          const groupTotal = groupRows.reduce((acc, r) => acc + r.total, 0)

          const byParent = groupRows.reduce<Record<string, { parentName: string; parentCode: string | null; rows: typeof rows }>>((acc, r) => {
            if (!acc[r.parentId]) acc[r.parentId] = { parentName: r.parentName, parentCode: r.parentCode, rows: [] }
            acc[r.parentId].rows.push(r)
            return acc
          }, {})

          return (
            <div key={group.label}>
              {/* Cabeçalho do grupo */}
              <div className="flex items-center justify-between px-4 py-2 bg-muted/40">
                <span className="text-xs font-semibold text-foreground">{BP_TYPE_LABELS[group.types[0]]}</span>
                <span className="text-xs font-semibold tabular-nums text-foreground">{fmt(groupTotal)}</span>
              </div>

              {Object.keys(byParent).length === 0 && (
                <div className="px-4 py-2 text-xs text-muted-foreground italic">Sem lançamentos</div>
              )}

              {/* Naturezas Pai */}
              {Object.entries(byParent).map(([parentId, { parentName, parentCode, rows: childRows }]) => {
                const parentTotal = childRows.reduce((acc, r) => acc + r.total, 0)
                return (
                  <div key={parentId}>
                    <div className="flex items-center justify-between px-4 py-1.5 bg-muted/20">
                      <span className="text-xs font-medium text-foreground">
                        {parentCode && <span className="text-muted-foreground mr-1.5">{parentCode}</span>}
                        {parentName}
                      </span>
                      <span className="text-xs font-medium tabular-nums">{fmt(parentTotal)}</span>
                    </div>
                    {/* Naturezas Filho */}
                    {childRows.map(r => (
                      <div key={r.childId} className="flex items-center justify-between px-6 py-1.5 hover:bg-muted/10">
                        <span className="text-xs text-muted-foreground">
                          {r.childCode && <span className="mr-1.5">{r.childCode}</span>}
                          {r.childName}
                        </span>
                        <span className="text-xs tabular-nums">{fmt(r.total)}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      {/* Total da seção */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800 text-white">
        <span className="text-xs font-semibold tracking-wide uppercase">{totalLabel}</span>
        <span className="text-sm font-bold tabular-nums">{fmt(total)}</span>
      </div>
    </div>
  )
}

function BalanceCheck({ totalAtivo, totalPassivoMaisPl }: { totalAtivo: number; totalPassivoMaisPl: number }) {
  const diff = Math.abs(totalAtivo - totalPassivoMaisPl)
  const balanced = diff < 0.01

  return (
    <div className={cn(
      'flex items-center justify-between rounded-lg border px-4 py-3 text-sm',
      balanced ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800',
    )}>
      <span className="font-medium">
        {balanced ? 'Balanço conferido — Ativo = Passivo + PL' : 'Atenção: Ativo ≠ Passivo + PL'}
      </span>
      {!balanced && (
        <span className="tabular-nums font-medium">Diferença: {fmt(diff)}</span>
      )}
    </div>
  )
}
