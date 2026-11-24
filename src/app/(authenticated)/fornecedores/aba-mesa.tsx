'use client'

// A mesa de negociação: cada fornecedor marcado numa linha, com a redução e a
// observação editadas NA PRÓPRIA LINHA e gravadas sozinhas (700 ms depois de parar
// de digitar, ou ao sair do campo). "Antes" é a média mensal do fornecedor nos
// meses-base (os 3 últimos meses completos do período).

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/states/empty-state'
import { aplicarReducao, mediaMensal, type ItemMesa, type LinhaAbc } from '@/lib/fornecedores-types'
import { saveItemMesa } from '@/server/fornecedores'
import { ClasseChip, CaixaTabela, CLASSE_TABELA, CLASSE_THEAD, moeda, numero, inteiro, pct, rotuloMes } from './pecas'

export function AbaMesa({ mesa, abcPorChave, base, total, podeEditar, salvando, onSalvo, onTirar, onAbrir }: {
  mesa: ItemMesa[]; abcPorChave: Map<string, LinhaAbc>; base: string[]; total: number; podeEditar: boolean; mesCorrente: string
  salvando: Set<string>
  onSalvo: (item: ItemMesa) => void
  onTirar: (chave: string, rotulo: string) => void
  onAbrir: (chave: string, rotulo: string) => void
}) {
  const linhas = useMemo(() => mesa.map((item) => {
    const a = abcPorChave.get(item.chave)
    const antes = a ? mediaMensal(a.porMes, base) : 0
    return { item, a, antes, ...aplicarReducao(antes, item.tipo, item.reducao) }
  }).sort((x, y) => y.antes - x.antes || x.item.rotulo.localeCompare(y.item.rotulo)), [mesa, abcPorChave, base])

  const s = linhas.reduce((acc, l) => ({
    periodo: acc.periodo + (l.a?.valor ?? 0), antes: acc.antes + l.antes, depois: acc.depois + l.depois,
    mes: acc.mes + l.economiaMensal, ano: acc.ano + l.economiaAnual,
  }), { periodo: 0, antes: 0, depois: 0, mes: 0, ano: 0 })
  const baseTxt = base.map((m) => rotuloMes(m, '')).join(', ')

  if (!mesa.length) {
    return (
      <EmptyState
        title="Nenhum fornecedor na mesa ainda"
        description={podeEditar
          ? 'Use "+ Mesa" ao lado de um fornecedor na visão geral ou nos lançamentos para trazê-lo para cá.'
          : 'Quando um administrador levar fornecedores à mesa, eles aparecem aqui.'}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao rotulo="Fornecedores na mesa" valor={inteiro.format(mesa.length)} sub={`${pct.format(s.periodo / (total || 1))} das despesas do período`} />
        <Cartao rotulo="Gasto mensal antes" valor={moeda.format(s.antes)} sub={`média de ${baseTxt}`} />
        <Cartao rotulo="Gasto mensal depois" valor={moeda.format(s.depois)} sub="com as reduções negociadas" />
        <Cartao rotulo="Economia em 12 meses" valor={moeda.format(s.ano)} sub={`${moeda.format(s.mes)} por mês`} destaque />
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          A redução em % vale sobre o gasto mensal antes; em R$, é quanto se tira por mês. Digite na linha: salva sozinho.
        </p>
        <CaixaTabela alta>
          <table className={CLASSE_TABELA}>
            <thead className={CLASSE_THEAD}>
              <tr>
                <th className="sticky left-0 z-20 min-w-[220px]">Fornecedor</th><th>Classe</th>
                <th className="!text-right">Total no período</th><th className="!text-right">Mensal antes</th>
                <th className="!text-right">Redução</th><th className="!text-right">Mensal depois</th>
                <th className="!text-right">Economia por mês</th><th className="!text-right">Economia em 12 meses</th>
                <th>Observação</th><th />
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <LinhaMesa key={l.item.chave} item={l.item} classe={l.a?.classe} periodo={l.a?.valor ?? 0} antes={l.antes}
                  depois={l.depois} economiaMensal={l.economiaMensal} economiaAnual={l.economiaAnual}
                  podeEditar={podeEditar} tirando={salvando.has(l.item.chave)} onSalvo={onSalvo}
                  onTirar={() => onTirar(l.item.chave, l.item.rotulo)} onAbrir={() => onAbrir(l.item.chave, l.item.rotulo)} />
              ))}
              <tr className="sticky bottom-0 bg-muted font-medium">
                <td className="sticky left-0 bg-muted px-2 py-1.5">Total</td><td />
                <td className="px-2 py-1.5 text-right">{numero.format(s.periodo)}</td>
                <td className="px-2 py-1.5 text-right">{numero.format(s.antes)}</td><td />
                <td className="px-2 py-1.5 text-right">{numero.format(s.depois)}</td>
                <td className="px-2 py-1.5 text-right">{numero.format(s.mes)}</td>
                <td className="px-2 py-1.5 text-right">{numero.format(s.ano)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </CaixaTabela>
      </div>
    </div>
  )
}

function LinhaMesa({ item, classe, periodo, antes, depois, economiaMensal, economiaAnual, podeEditar, tirando, onSalvo, onTirar, onAbrir }: {
  item: ItemMesa; classe?: 'A' | 'B' | 'C'; periodo: number; antes: number; depois: number; economiaMensal: number; economiaAnual: number
  podeEditar: boolean; tirando: boolean; onSalvo: (item: ItemMesa) => void; onTirar: () => void; onAbrir: () => void
}) {
  // Estado LOCAL dos campos: a linha não é recriada quando a mesa muda, então o
  // cursor fica onde a pessoa está digitando.
  const [reducao, setReducao] = useState(item.reducao ? String(item.reducao) : '')
  const [tipo, setTipo] = useState<'pct' | 'valor'>(item.tipo)
  const [nota, setNota] = useState(item.nota)
  const [status, setStatus] = useState<'' | 'salvando' | 'salvo' | 'erro'>('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ultimo = useRef({ reducao: item.reducao, tipo: item.tipo, nota: item.nota })

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function salvar(campos: { reducao: string; tipo: 'pct' | 'valor'; nota: string }) {
    const n = Number(campos.reducao.replace(',', '.'))
    const red = Number.isFinite(n) && n > 0 ? (campos.tipo === 'pct' ? Math.min(n, 100) : n) : 0
    const u = ultimo.current
    if (red === u.reducao && campos.tipo === u.tipo && campos.nota === u.nota) return
    setStatus('salvando')
    try {
      const r = await saveItemMesa({ chave: item.chave, rotulo: item.rotulo, tipo: campos.tipo, reducao: red, nota: campos.nota })
      if ('error' in r) { setStatus('erro'); toast.error(r.error); return }
      ultimo.current = { reducao: red, tipo: campos.tipo, nota: campos.nota }
      onSalvo(r.item)
      setStatus('salvo')
      setTimeout(() => setStatus((s) => (s === 'salvo' ? '' : s)), 1500)
    } catch {
      setStatus('erro')
      toast.error('Não foi possível salvar a negociação. Tente de novo.')
    }
  }
  function agendar(campos: { reducao: string; tipo: 'pct' | 'valor'; nota: string }) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => salvar(campos), 700)
  }
  function agora() {
    if (timer.current) clearTimeout(timer.current)
    salvar({ reducao, tipo, nota })
  }

  const campo = 'rounded-md border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'
  return (
    <tr className="hover:bg-muted/40">
      <td className="sticky left-0 z-[1] bg-background px-2 py-1.5">
        <button type="button" className="text-left underline decoration-border underline-offset-2 hover:decoration-foreground" onClick={onAbrir}>{item.rotulo}</button>
      </td>
      <td className="px-2 py-1.5">{classe ? <ClasseChip classe={classe} /> : <span className="text-muted-foreground">sem gasto</span>}</td>
      <td className="px-2 py-1.5 text-right">{numero.format(periodo)}</td>
      <td className="px-2 py-1.5 text-right">{numero.format(antes)}</td>
      <td className="px-2 py-1.5">
        <div className="flex items-center justify-end gap-1.5">
          <input type="number" min={0} step="0.01" inputMode="decimal" value={reducao} disabled={!podeEditar} placeholder="0"
            onChange={(e) => { setReducao(e.target.value); agendar({ reducao: e.target.value, tipo, nota }) }} onBlur={agora}
            className={cn(campo, 'w-24 text-right tabular-nums')} aria-label={`Redução negociada com ${item.rotulo}`} />
          <select value={tipo} disabled={!podeEditar}
            onChange={(e) => { const t = e.target.value === 'valor' ? 'valor' : 'pct'; setTipo(t); if (timer.current) clearTimeout(timer.current); salvar({ reducao, tipo: t, nota }) }}
            className={cn(campo, 'w-[5.5rem]')} aria-label={`Tipo de redução de ${item.rotulo}`}>
            <option value="pct">%</option>
            <option value="valor">R$/mês</option>
          </select>
        </div>
      </td>
      <td className="px-2 py-1.5 text-right">{numero.format(depois)}</td>
      <td className="px-2 py-1.5 text-right">{numero.format(economiaMensal)}</td>
      <td className="px-2 py-1.5 text-right">{numero.format(economiaAnual)}</td>
      <td className="px-2 py-1.5">
        <input type="text" maxLength={1000} value={nota} disabled={!podeEditar} placeholder="Observação"
          onChange={(e) => { setNota(e.target.value); agendar({ reducao, tipo, nota: e.target.value }) }} onBlur={agora}
          className={cn(campo, 'w-full min-w-[220px]')} aria-label={`Observação da negociação com ${item.rotulo}`} />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <span className={cn('mr-2 inline-block min-w-[4.5rem] text-[11px]', status === 'erro' ? 'text-rose-600' : 'text-muted-foreground')}>
          {status === 'salvando' ? 'salvando…' : status === 'salvo' ? 'salvo' : status === 'erro' ? 'não salvo' : ''}
        </span>
        {podeEditar && (
          <button type="button" onClick={onTirar} disabled={tirando} className="rounded-md border px-2 py-1 text-xs hover:border-foreground/40 disabled:opacity-50">
            {tirando ? 'tirando…' : 'Tirar da mesa'}
          </button>
        )}
      </td>
    </tr>
  )
}

function Cartao({ rotulo, valor, sub, destaque }: { rotulo: string; valor: string; sub: string; destaque?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <span className={cn('text-xl font-semibold tabular-nums', destaque && 'text-emerald-700 dark:text-emerald-500')}>{valor}</span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  )
}
