'use client'

// /fornecedores — despesas por fornecedor em três abas:
//   Visão geral   curva ABC (70/20/10), naturezas e o que fica fora da curva
//   Lançamentos   três blocos encadeados: natureza × mês → fornecedor × mês → lançamentos
//   Mesa          os fornecedores marcados para negociar, com a redução e o antes/depois
//
// Barra fixa no topo (abas, período, filtros e comandos); abaixo dela só dados.
// Os números são calculados aqui sobre as saídas do período que o servidor já
// consolidou por fornecedor (lib/fornecedores.ts). Ver Decisão 33.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/states/empty-state'
import {
  curvaAbc, classeAbc, mesesBase, mediaMensal,
  type Classe, type ItemMesa, type LancamentoFornecedor, type LinhaAbc,
} from '@/lib/fornecedores-types'
import { saveItemMesa, removeItemMesa } from '@/server/fornecedores'
import { BotaoMesa, ClasseChip, CelulaValor, CaixaTabela, CLASSE_TABELA, CLASSE_THEAD, moeda, numero, inteiro, pct, rotuloMes, dataBR } from './pecas'
import { AbaMesa } from './aba-mesa'

type Aba = 'visao' | 'lancamentos' | 'mesa'

interface Filtro { grupo?: string; chave?: string; naturezaPai?: string; natureza?: string; mes?: string; classe?: Classe }
interface Selecao { titulo: string; f: Filtro; linha?: string }

const natKey = (l: LancamentoFornecedor) => `${l.naturezaPai} › ${l.natureza}`

function aplicar(rows: LancamentoFornecedor[], f: Filtro, classeDe: Map<string, Classe>): LancamentoFornecedor[] {
  return rows.filter((r) =>
    (!f.grupo || r.grupo === f.grupo) &&
    (!f.chave || r.chave === f.chave) &&
    (!f.naturezaPai || r.naturezaPai === f.naturezaPai) &&
    (!f.natureza || natKey(r) === f.natureza) &&
    (!f.mes || r.mes === f.mes) &&
    (!f.classe || classeDe.get(r.chave) === f.classe))
}
const soma = (rows: LancamentoFornecedor[]) => rows.reduce((s, r) => s + r.valor, 0)

export function FornecedoresClient({ periodo, hoje, lancamentos, mesaInicial, podeEditar }: {
  periodo: { de: string; ate: string }
  hoje: string
  lancamentos: LancamentoFornecedor[]
  mesaInicial: ItemMesa[]
  podeEditar: boolean
}) {
  const router = useRouter()
  const [carregando, startTransition] = useTransition()
  const [aba, setAba] = useState<Aba>('visao')
  const [de, setDe] = useState(periodo.de)
  const [ate, setAte] = useState(periodo.ate)

  // visão geral
  const [abcBusca, setAbcBusca] = useState('')
  const [abcClasses, setAbcClasses] = useState<'A' | 'AB' | 'ABC'>('A')

  // lançamentos (três níveis)
  const TODAS: Selecao = { titulo: 'Todas as despesas', f: { grupo: 'Despesas' } }
  const [sel, setSel] = useState<Selecao>(TODAS)
  const [n2, setN2] = useState<Selecao | null>(null)
  const [n3, setN3] = useState<Selecao | null>(null)
  const [busca, setBusca] = useState('')

  // mesa
  const [mesa, setMesa] = useState<ItemMesa[]>(mesaInicial)
  const [salvando, setSalvando] = useState<Set<string>>(new Set())

  const mesCorrente = hoje.slice(0, 7)
  const despesas = useMemo(() => lancamentos.filter((l) => l.grupo === 'Despesas'), [lancamentos])
  const total = useMemo(() => soma(despesas), [despesas])
  const abc = useMemo(() => curvaAbc(despesas), [despesas])
  const classeDe = useMemo(() => new Map(abc.map((r) => [r.chave, r.classe])), [abc])
  const abcPorChave = useMemo(() => new Map(abc.map((r) => [r.chave, r])), [abc])
  const meses = useMemo(() => Array.from(new Set(despesas.map((l) => l.mes))).sort(), [despesas])
  const base = useMemo(() => mesesBase(periodo.ate, hoje), [periodo.ate, hoje])
  const naMesa = useMemo(() => new Set(mesa.map((m) => m.chave)), [mesa])

  // ── ações ─────────────────────────────────────────────────────────────────
  function aplicarPeriodo() {
    if (!de || !ate || de > ate) { toast.error('A data inicial precisa ser anterior à final.'); return }
    startTransition(() => router.push(`/fornecedores?de=${de}&ate=${ate}`))
  }

  async function alternarMesa(chave: string, rotulo: string) {
    if (!podeEditar) return
    setSalvando((s) => new Set(s).add(chave))
    try {
      if (naMesa.has(chave)) {
        const r = await removeItemMesa(chave)
        if ('error' in r) toast.error(r.error)
        else setMesa((m) => m.filter((x) => x.chave !== chave))
      } else {
        const r = await saveItemMesa({ chave, rotulo, tipo: 'pct', reducao: 0, nota: '' })
        if ('error' in r) toast.error(r.error)
        else setMesa((m) => [...m.filter((x) => x.chave !== chave), r.item])
      }
    } catch {
      toast.error('Não foi possível alterar a mesa. Tente de novo.')
    } finally {
      setSalvando((s) => { const n = new Set(s); n.delete(chave); return n })
    }
  }
  const botao = (chave: string, nome: string) => (
    <BotaoMesa naMesa={naMesa.has(chave)} salvando={salvando.has(chave)} podeEditar={podeEditar} nome={nome} onClick={() => alternarMesa(chave, nome)} />
  )

  function abrirBase(s: Selecao) {
    setSel(s); setN2(null); setN3(null); setBusca(''); setAba('lancamentos')
    document.getElementById('fornecedores-conteudo')?.scrollTo({ top: 0 })
  }
  const rolar = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50)

  // ── conjuntos do detalhe ──────────────────────────────────────────────────
  const baseRows = useMemo(() => {
    const todos = aplicar(lancamentos, sel.f, classeDe)
    const q = busca.trim().toLowerCase()
    return q ? todos.filter((r) => [r.fornecedor, r.descricao, r.natureza, r.naturezaPai, r.conta].some((s) => s.toLowerCase().includes(q))) : todos
  }, [lancamentos, sel, busca, classeDe])
  const rowsN2 = useMemo(() => (n2 ? aplicar(baseRows, n2.f, classeDe) : []), [baseRows, n2, classeDe])
  const rowsN3 = useMemo(() => (n3 ? aplicar(rowsN2, n3.f, classeDe) : []), [rowsN2, n3, classeDe])

  const abcVisivel = useMemo(() => {
    const q = abcBusca.trim().toLowerCase()
    return abc.filter((r) => abcClasses.includes(r.classe) && (!q || r.fornecedor.toLowerCase().includes(q)))
  }, [abc, abcBusca, abcClasses])

  const classeA = abc.filter((r) => r.classe === 'A')
  const mediaGeral = useMemo(() => {
    const porMes: Record<string, number> = {}
    for (const l of despesas) porMes[l.mes] = (porMes[l.mes] ?? 0) + l.valor
    return mediaMensal(porMes, base)
  }, [despesas, base])

  // ── render ────────────────────────────────────────────────────────────────
  const semDados = lancamentos.length === 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* barra fixa: abas, período e comandos */}
      <div className="shrink-0 space-y-2 border-b bg-background px-6 pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <h1 className="text-lg font-semibold">Fornecedores</h1>
          <nav className="flex gap-1" role="tablist" aria-label="Seções da análise">
            {([['visao', 'Visão geral'], ['lancamentos', 'Lançamentos'], ['mesa', `Mesa de negociação (${mesa.length})`]] as const).map(([id, rotulo]) => (
              <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
                className={cn('rounded-md px-3 py-1.5 text-sm transition-colors', aba === id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {rotulo}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">De</span>
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="h-8 w-[9.5rem]" aria-label="Data inicial" />
            <span className="text-muted-foreground">até</span>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="h-8 w-[9.5rem]" aria-label="Data final" />
            <Button size="sm" variant="outline" onClick={aplicarPeriodo} disabled={carregando || (de === periodo.de && ate === periodo.ate)}>
              {carregando ? 'Carregando…' : 'Aplicar'}
            </Button>
          </div>
        </div>

        {aba === 'visao' && !semDados && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Curva ABC:</span>
            <Input value={abcBusca} onChange={(e) => setAbcBusca(e.target.value)} placeholder="Buscar fornecedor" className="h-8 max-w-xs" aria-label="Buscar fornecedor na curva ABC" />
            <select value={abcClasses} onChange={(e) => setAbcClasses(e.target.value as 'A' | 'AB' | 'ABC')} className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Classes exibidas">
              <option value="A">Só classe A</option>
              <option value="AB">Classes A e B</option>
              <option value="ABC">Todos</option>
            </select>
            <span className="text-xs text-muted-foreground">
              {inteiro.format(abcVisivel.length)} de {inteiro.format(abc.length)} fornecedores · {moeda.format(abcVisivel.reduce((s, r) => s + r.valor, 0))}
            </span>
          </div>
        )}

        {aba === 'lancamentos' && !semDados && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button size="sm" variant="outline" onClick={() => setAba('visao')}>Voltar</Button>
              <Button size="sm" variant="outline" disabled={!n2 && !busca} onClick={() => { setN2(null); setN3(null); setBusca(''); rolar('bloco-1') }}>Limpar filtros</Button>
              <Button size="sm" variant="outline" disabled={sel.titulo === TODAS.titulo && !n2 && !busca} onClick={() => abrirBase(TODAS)}>Todas as despesas</Button>
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar por fornecedor, descrição ou natureza" className="h-8 max-w-sm" aria-label="Filtrar lançamentos" />
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="flex flex-wrap items-baseline gap-1">
                {n2 ? <button type="button" className="underline underline-offset-2" onClick={() => { setN2(null); setN3(null); rolar('bloco-1') }}>{sel.titulo}</button> : <b className="font-medium">{sel.titulo}</b>}
                {n2 && <><span className="text-muted-foreground">›</span>{n3 ? <button type="button" className="underline underline-offset-2" onClick={() => { setN3(null); rolar('bloco-2') }}>{n2.titulo}</button> : <b className="font-medium">{n2.titulo}</b>}</>}
                {n3 && <><span className="text-muted-foreground">›</span><b className="font-medium">{n3.titulo}</b></>}
              </span>
              <span className="text-xs text-muted-foreground">{inteiro.format(baseRows.length)} lançamentos · {moeda.format(soma(baseRows))}</span>
            </div>
          </>
        )}

        {aba === 'mesa' && !podeEditar && (
          <p className="rounded-md border border-amber-500/60 bg-amber-500/5 px-3 py-1.5 text-xs">
            Você está vendo a mesa em modo leitura. Só administradores e o proprietário levam fornecedores à mesa e gravam reduções.
          </p>
        )}
      </div>

      {/* conteúdo: só dados */}
      <div id="fornecedores-conteudo" className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {semDados ? (
          <EmptyState title="Nenhuma saída neste período" description="Não há lançamentos de saída entre as datas escolhidas. Amplie o período no topo da tela." />
        ) : aba === 'visao' ? (
          <VisaoGeral
            despesas={despesas} lancamentos={lancamentos} total={total} abc={abc} abcVisivel={abcVisivel} meses={meses} mesCorrente={mesCorrente}
            classeA={classeA} mediaGeral={mediaGeral} base={base} botao={botao} abrir={abrirBase}
          />
        ) : aba === 'lancamentos' ? (
          <div className="space-y-8">
            <Bloco id="bloco-1" titulo="1. Por natureza, mês a mês" dica="Clique numa natureza ou num valor para abrir os fornecedores.">
              <Matriz rows={baseRows} por="natureza" mesCorrente={mesCorrente} ativo={n2?.linha}
                onAbrir={(s) => { setN2(s); setN3(null); rolar('bloco-2') }} />
            </Bloco>
            {n2 && (
              <Bloco id="bloco-2" titulo={`2. Por fornecedor: ${n2.titulo}`} dica="Clique num fornecedor ou num valor para abrir os lançamentos.">
                <Matriz rows={rowsN2} por="fornecedor" mesCorrente={mesCorrente} ativo={n3?.linha} botao={botao}
                  onAbrir={(s) => { setN3(s); rolar('bloco-3') }} />
              </Bloco>
            )}
            {n3 && (
              <Bloco id="bloco-3" titulo={`3. Lançamentos: ${n3.titulo}${n2 && n2.linha !== '*' ? ' em ' + n2.titulo : ''}`}>
                <TabelaLancamentos rows={rowsN3} botao={botao} />
              </Bloco>
            )}
          </div>
        ) : (
          <AbaMesa mesa={mesa} abcPorChave={abcPorChave} base={base} total={total} podeEditar={podeEditar} mesCorrente={mesCorrente}
            onSalvo={(item) => setMesa((m) => m.map((x) => (x.chave === item.chave ? item : x)))}
            onTirar={(chave, rotulo) => alternarMesa(chave, rotulo)} salvando={salvando}
            onAbrir={(chave, rotulo) => abrirBase({ titulo: rotulo, f: { grupo: 'Despesas', chave } })} />
        )}
      </div>
    </div>
  )
}

// ── visão geral ─────────────────────────────────────────────────────────────

function VisaoGeral({ despesas, lancamentos, total, abc, abcVisivel, meses, mesCorrente, classeA, mediaGeral, base, botao, abrir }: {
  despesas: LancamentoFornecedor[]; lancamentos: LancamentoFornecedor[]; total: number; abc: LinhaAbc[]; abcVisivel: LinhaAbc[]
  meses: string[]; mesCorrente: string; classeA: LinhaAbc[]; mediaGeral: number; base: string[]
  botao: (chave: string, nome: string) => React.ReactNode; abrir: (s: Selecao) => void
}) {
  const porPai = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of despesas) m.set(l.naturezaPai, (m.get(l.naturezaPai) ?? 0) + l.valor)
    return Array.from(m).sort((a, b) => b[1] - a[1])
  }, [despesas])
  const maxPai = porPai[0]?.[1] ?? 1

  const naturezas = useMemo(() => {
    const m = new Map<string, { pai: string; filho: string; valor: number; f: Map<string, { nome: string; v: number }> }>()
    for (const l of despesas) {
      const k = natKey(l)
      const e = m.get(k) ?? { pai: l.naturezaPai, filho: l.natureza, valor: 0, f: new Map() }
      e.valor += l.valor
      const x = e.f.get(l.chave) ?? { nome: l.fornecedor, v: 0 }; x.v += l.valor; e.f.set(l.chave, x)
      m.set(k, e)
    }
    let acc = 0
    return Array.from(m.entries()).sort((a, b) => b[1].valor - a[1].valor).map(([k, e], i) => {
      const antes = total ? acc / total : 0; acc += e.valor
      const [chaveMaior, maior] = Array.from(e.f).sort((a, b) => b[1].v - a[1].v)[0]
      return { k, rank: i + 1, classe: classeAbc(antes), ...e, pct: e.valor / total, acum: acc / total, nForn: e.f.size, chaveMaior, maior }
    })
  }, [despesas, total])

  const fora = useMemo(() => {
    const m = new Map<string, { v: number; n: number }>()
    for (const l of lancamentos) if (l.grupo !== 'Despesas') { const e = m.get(l.grupo) ?? { v: 0, n: 0 }; e.v += l.valor; e.n++; m.set(l.grupo, e) }
    return Array.from(m).sort((a, b) => b[1].v - a[1].v)
  }, [lancamentos])

  const baseTxt = base.map((m) => rotuloMes(m, '')).join(', ')

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao rotulo="Despesas no período" valor={moeda.format(total)} sub={`${inteiro.format(despesas.length)} lançamentos`} onClick={() => abrir({ titulo: 'Todas as despesas', f: { grupo: 'Despesas' } })} />
        <Cartao rotulo="Média mensal" valor={moeda.format(mediaGeral)} sub={`sobre ${baseTxt}`} />
        <Cartao rotulo="Fornecedores" valor={inteiro.format(abc.length)} sub="depois de consolidar" />
        <Cartao rotulo="Classe A (até 70%)" valor={inteiro.format(classeA.length)} sub={`${pct.format(classeA.reduce((s, r) => s + r.valor, 0) / (total || 1))} do total`}
          onClick={() => abrir({ titulo: 'Fornecedores da classe A', f: { grupo: 'Despesas', classe: 'A' } })} />
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-medium">Por natureza pai</h2>
        <div className="space-y-1">
          {porPai.map(([pai, v]) => (
            <button key={pai} type="button" onClick={() => abrir({ titulo: pai, f: { grupo: 'Despesas', naturezaPai: pai } })}
              className="grid w-full grid-cols-[minmax(8rem,16rem)_1fr_auto] items-center gap-3 rounded px-1 py-0.5 text-left text-sm hover:bg-muted/60">
              <span className="truncate">{pai}</span>
              <span className="h-3 rounded-sm bg-emerald-700/80" style={{ width: `${Math.max(1, (v / maxPai) * 100)}%` }} />
              <span className="tabular-nums text-xs">{moeda.format(v)} · {pct.format(v / (total || 1))}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-base font-medium">Curva ABC por fornecedor</h2>
          <span className="text-xs text-muted-foreground">Classe A leva até 70% do total, B até 90%, C o restante. A classe é do acumulado antes do fornecedor.</span>
        </div>
        <CaixaTabela alta>
          <table className={CLASSE_TABELA}>
            <thead className={CLASSE_THEAD}>
              <tr>
                <th className="text-right">#</th><th>Classe</th><th>Fornecedor</th>
                {meses.map((m) => <th key={m} className="!text-right">{rotuloMes(m, mesCorrente)}</th>)}
                <th className="!text-right">Total</th><th className="!text-right">% do total</th><th className="!text-right">% acumulado</th><th>Natureza principal</th>
              </tr>
            </thead>
            <tbody>
              {abcVisivel.length === 0 && <tr><td colSpan={meses.length + 7} className="px-2 py-3 text-muted-foreground">Nenhum fornecedor com esse filtro.</td></tr>}
              {abcVisivel.map((r) => {
                const abrirF = (mes?: string) => abrir({ titulo: mes ? `${r.fornecedor} · ${rotuloMes(mes, mesCorrente)}` : r.fornecedor, f: { grupo: 'Despesas', chave: r.chave, mes } })
                return (
                  <tr key={r.chave} className="hover:bg-muted/40">
                    <td className="px-2 py-1.5 text-right">{r.rank}</td>
                    <td className="px-2 py-1.5"><ClasseChip classe={r.classe} /></td>
                    <td className="px-2 py-1.5"><span className="flex items-center">{botao(r.chave, r.fornecedor)}<button type="button" className="text-left underline decoration-border underline-offset-2 hover:decoration-foreground" onClick={() => abrirF()}>{r.fornecedor}</button></span></td>
                    {meses.map((m) => <CelulaValor key={m} valor={r.porMes[m] ?? 0} onClick={() => abrirF(m)} />)}
                    <CelulaValor valor={r.valor} forte onClick={() => abrirF()} />
                    <td className="px-2 py-1.5 text-right">{pct.format(r.pct)}</td>
                    <td className="px-2 py-1.5 text-right">{pct.format(r.pctAcumulado)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.naturezaPrincipal}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CaixaTabela>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-medium">Por natureza</h2>
        <CaixaTabela>
          <table className={CLASSE_TABELA}>
            <thead className={CLASSE_THEAD}>
              <tr><th className="text-right">#</th><th>Classe</th><th>Natureza pai</th><th>Natureza</th><th className="!text-right">Total</th><th className="!text-right">% do total</th><th className="!text-right">% acumulado</th><th className="!text-right">Fornecedores</th><th>Maior fornecedor</th><th className="!text-right">% do maior</th></tr>
            </thead>
            <tbody>
              {naturezas.map((n) => {
                const abrirN = () => abrir({ titulo: n.k, f: { grupo: 'Despesas', natureza: n.k } })
                return (
                  <tr key={n.k} className="hover:bg-muted/40">
                    <td className="px-2 py-1.5 text-right">{n.rank}</td>
                    <td className="px-2 py-1.5"><ClasseChip classe={n.classe} /></td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{n.pai}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap"><button type="button" className="underline decoration-border underline-offset-2" onClick={abrirN}>{n.filho}</button></td>
                    <CelulaValor valor={n.valor} forte onClick={abrirN} />
                    <td className="px-2 py-1.5 text-right">{pct.format(n.pct)}</td>
                    <td className="px-2 py-1.5 text-right">{pct.format(n.acum)}</td>
                    <td className="px-2 py-1.5 text-right">{inteiro.format(n.nForn)}</td>
                    <td className="px-2 py-1.5"><span className="flex items-center">{botao(n.chaveMaior, n.maior.nome)}<button type="button" className="text-left underline decoration-border underline-offset-2" onClick={() => abrir({ titulo: `${n.maior.nome} em ${n.k}`, f: { grupo: 'Despesas', natureza: n.k, chave: n.chaveMaior } })}>{n.maior.nome}</button></span></td>
                    <td className="px-2 py-1.5 text-right">{pct.format(n.maior.v / n.valor)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CaixaTabela>
      </section>

      {fora.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-base font-medium">Fora da curva</h2>
            <span className="text-xs text-muted-foreground">Saídas que não são despesa: não entram na curva ABC.</span>
          </div>
          <CaixaTabela>
            <table className={CLASSE_TABELA}>
              <thead className={CLASSE_THEAD}><tr><th>Grupo</th><th className="!text-right">Total</th><th className="!text-right">Lançamentos</th></tr></thead>
              <tbody>
                {fora.map(([g, e]) => (
                  <tr key={g} className="hover:bg-muted/40">
                    <td className="px-2 py-1.5"><button type="button" className="underline decoration-border underline-offset-2" onClick={() => abrir({ titulo: g, f: { grupo: g } })}>{g}</button></td>
                    <CelulaValor valor={e.v} onClick={() => abrir({ titulo: g, f: { grupo: g } })} />
                    <td className="px-2 py-1.5 text-right">{inteiro.format(e.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CaixaTabela>
        </section>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Como o fornecedor é identificado</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Primeiro, os agrupamentos da organização (Configurações › Agrupamentos de fornecedor).</li>
          <li>Depois, o contato do lançamento, ou o das partes do rateio quando todas apontam para o mesmo.</li>
          <li>Sem contato, o nome que aparece no extrato é procurado no cadastro de contatos; fora do cadastro, agrupa pelo CNPJ do extrato ou, sem CNPJ, pela descrição (marcada com ~).</li>
          <li>Rateios desconsiderados: cada lançamento conta pelo valor inteiro, na natureza da parte de maior valor. Ficam de fora os lançamentos pendentes e duplicados.</li>
        </ul>
      </details>
    </div>
  )
}

function Cartao({ rotulo, valor, sub, onClick }: { rotulo: string; valor: string; sub: string; onClick?: () => void }) {
  const corpo = (
    <>
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <span className="text-xl font-semibold tabular-nums">{valor}</span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </>
  )
  const cls = 'flex flex-col gap-1 rounded-lg border bg-card p-4 text-left shadow-sm'
  return onClick
    ? <button type="button" onClick={onClick} className={cn(cls, 'transition-colors hover:border-foreground/40')}>{corpo}</button>
    : <div className={cls}>{corpo}</div>
}

// ── lançamentos ─────────────────────────────────────────────────────────────

function Bloco({ id, titulo, dica, children }: { id: string; titulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-base font-medium">{titulo}</h2>
        {dica && <span className="text-xs text-muted-foreground">{dica}</span>}
      </div>
      {children}
    </section>
  )
}

const LIMITE_MATRIZ = 300

function Matriz({ rows, por, mesCorrente, ativo, onAbrir, botao }: {
  rows: LancamentoFornecedor[]; por: 'natureza' | 'fornecedor'; mesCorrente: string; ativo?: string
  onAbrir: (s: Selecao) => void; botao?: (chave: string, nome: string) => React.ReactNode
}) {
  const { meses, linhas } = useMemo(() => {
    const meses = Array.from(new Set(rows.map((r) => r.mes))).sort()
    const m = new Map<string, { k: string; rotulo: string; f: Filtro; total: number; mes: Record<string, number> }>()
    for (const r of rows) {
      const k = por === 'natureza' ? natKey(r) : r.chave
      const e = m.get(k) ?? { k, rotulo: por === 'natureza' ? natKey(r) : r.fornecedor, f: por === 'natureza' ? { natureza: natKey(r) } : { chave: r.chave }, total: 0, mes: {} }
      e.total += r.valor; e.mes[r.mes] = (e.mes[r.mes] ?? 0) + r.valor
      m.set(k, e)
    }
    return { meses, linhas: Array.from(m.values()).sort((a, b) => b.total - a.total) }
  }, [rows, por])

  if (!linhas.length) return <p className="text-sm text-muted-foreground">Nenhum lançamento com esse filtro.</p>
  const todos = por === 'natureza' ? 'Todas as naturezas' : 'Todos os fornecedores'
  const visiveis = linhas.slice(0, LIMITE_MATRIZ)
  const resto = linhas.slice(LIMITE_MATRIZ)
  const totalMes = (mes: string) => rows.filter((r) => r.mes === mes).reduce((s, r) => s + r.valor, 0)

  return (
    <CaixaTabela alta>
      <table className={CLASSE_TABELA}>
        <thead className={CLASSE_THEAD}>
          <tr>
            <th className="sticky left-0 z-20 min-w-[220px]">{por === 'natureza' ? 'Natureza' : 'Fornecedor'}</th>
            {meses.map((m) => <th key={m} className="!text-right">{rotuloMes(m, mesCorrente)}</th>)}
            <th className="!text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((e) => (
            <tr key={e.k} className={cn('hover:bg-muted/40', ativo && ativo.split('|')[0] === e.k && 'bg-muted font-medium')}>
              <td className="sticky left-0 z-[1] bg-background px-2 py-1.5">
                <span className="flex items-center">
                  {botao && botao(e.k, e.rotulo)}
                  <button type="button" className="text-left underline decoration-border underline-offset-2 hover:decoration-foreground" onClick={() => onAbrir({ titulo: e.rotulo, f: e.f, linha: e.k })}>{e.rotulo}</button>
                </span>
              </td>
              {meses.map((m) => <CelulaValor key={m} valor={e.mes[m] ?? 0} onClick={() => onAbrir({ titulo: `${e.rotulo} · ${rotuloMes(m, mesCorrente)}`, f: { ...e.f, mes: m }, linha: `${e.k}|${m}` })} />)}
              <CelulaValor valor={e.total} forte onClick={() => onAbrir({ titulo: e.rotulo, f: e.f, linha: e.k })} />
            </tr>
          ))}
          {resto.length > 0 && (
            <tr className="text-muted-foreground">
              <td className="sticky left-0 bg-background px-2 py-1.5">Demais {inteiro.format(resto.length)} linhas</td>
              {meses.map((m) => <td key={m} className="px-2 py-1.5 text-right">{numero.format(resto.reduce((s, e) => s + (e.mes[m] ?? 0), 0))}</td>)}
              <td className="px-2 py-1.5 text-right">{numero.format(resto.reduce((s, e) => s + e.total, 0))}</td>
            </tr>
          )}
          <tr className="sticky bottom-0 bg-muted font-medium">
            <td className="sticky left-0 bg-muted px-2 py-1.5">Total</td>
            {meses.map((m) => <CelulaValor key={m} valor={totalMes(m)} onClick={() => onAbrir({ titulo: `${todos} · ${rotuloMes(m, mesCorrente)}`, f: { mes: m }, linha: `*|${m}` })} />)}
            <CelulaValor valor={rows.reduce((s, r) => s + r.valor, 0)} forte onClick={() => onAbrir({ titulo: todos, f: {}, linha: '*' })} />
          </tr>
        </tbody>
      </table>
    </CaixaTabela>
  )
}

const LIMITE_LANCAMENTOS = 1000

function TabelaLancamentos({ rows, botao }: { rows: LancamentoFornecedor[]; botao: (chave: string, nome: string) => React.ReactNode }) {
  const ordenados = useMemo(() => Array.from(rows).sort((a, b) => b.valor - a.valor), [rows])
  if (!ordenados.length) return <p className="text-sm text-muted-foreground">Nenhum lançamento com esse filtro.</p>
  return (
    <CaixaTabela alta>
      <table className={CLASSE_TABELA}>
        <thead className={CLASSE_THEAD}>
          <tr><th>Data</th><th>Fornecedor</th><th className="!text-right">Valor</th><th>Natureza</th><th>Conta</th><th>Rateado</th><th>Descrição do extrato</th><th>Natureza pai</th><th>Como o fornecedor foi identificado</th></tr>
        </thead>
        <tbody>
          {ordenados.slice(0, LIMITE_LANCAMENTOS).map((r) => (
            <tr key={r.id} className="align-top hover:bg-muted/40">
              <td className="px-2 py-1.5 whitespace-nowrap">{dataBR(r.data)}</td>
              <td className="px-2 py-1.5"><span className="flex items-center whitespace-nowrap">{botao(r.chave, r.fornecedor)}{r.fornecedor}</span></td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{numero.format(r.valor)}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{r.natureza}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{r.conta}</td>
              <td className="px-2 py-1.5">{r.rateado ? 'sim' : 'não'}</td>
              <td className="min-w-[340px] max-w-[520px] px-2 py-1.5">{r.descricao}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{r.naturezaPai}</td>
              <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{r.identificacao}</td>
            </tr>
          ))}
          <tr className="sticky bottom-0 bg-muted font-medium">
            <td className="px-2 py-1.5">Total</td>
            <td className="px-2 py-1.5">{inteiro.format(ordenados.length)} lançamentos{ordenados.length > LIMITE_LANCAMENTOS ? ` (mostrando os ${inteiro.format(LIMITE_LANCAMENTOS)} maiores)` : ''}</td>
            <td className="px-2 py-1.5 text-right">{numero.format(ordenados.reduce((s, r) => s + r.valor, 0))}</td>
            <td colSpan={6} />
          </tr>
        </tbody>
      </table>
    </CaixaTabela>
  )
}
