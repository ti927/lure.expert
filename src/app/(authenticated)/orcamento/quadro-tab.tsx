'use client'

// Aba "Quadro de pessoal" do /orcamento: as pessoas da versão, os parâmetros da
// folha (modo de 13º/férias e dissídio) e as três ações — naturezas, copiar e
// gerar. O quadro não é o orçamento: nada aqui entra na DRE até "Gerar folha".

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { AlertTriangle, Copy, ListTree, Pencil, Plus, Trash2, Users, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PartialDataBanner } from '@/components/states/partial-data-banner'
import { ColHeader } from '@/components/transacoes-shared/col-header'
import { DescFilter, MultiSelectFilter } from '@/components/transacoes-shared/filters'
import type { CategoryItem, DimensionOption, SimpleDimensionItem } from '@/components/transacoes-shared/types'
import { cn } from '@/lib/utils'
import { fmtMoney } from '@/lib/format'
import type { BudgetVersionListItem } from '@/lib/budget-types'
import { VINCULOS, VINCULO_LABELS } from '@/lib/payroll-types'
import type { PessoaDoQuadro, QuadroDaVersao } from '@/lib/payroll-write'
import type { LegalEntity } from '@/db/schema/legal-entities'
import { deletePessoa, getQuadro } from '@/server/payroll'
import { fmtCentavos, rotuloMeses } from './folha-format'
import { ParametrosFolhaBar } from './parametros-folha-bar'
import { PessoaDialog } from './pessoa-dialog'
import { NaturezasFolhaDialog } from './naturezas-folha-dialog'
import { GerarFolhaDialog } from './gerar-folha-dialog'
import { CopiarQuadroDialog } from './copiar-quadro-dialog'

const STORAGE_KEY = 'lure:orcamento:quadro:filters'
const PAGE_SIZE = 100

type SortKey = 'nome' | 'base' | 'custo' | ''

interface Filters {
  nome?: string
  vinculo?: string
  uj?: string
  cc?: string
  uen?: string
}

function multiMatch(values: (string | null)[], filter: string | undefined): boolean {
  if (!filter) return true
  const set = new Set(filter.split(',').filter(Boolean))
  return values.some(v => set.has(v ?? ''))
}

/** "Financeiro 60 · Operações 40" — a alocação da pessoa numa dimensão. */
function rotuloAlocacao(
  alocs: PessoaDoQuadro['alocacoes'], campo: 'costCenterId' | 'businessUnitId', nomes: Map<string, string>,
): string {
  if (alocs.length === 0) return '—'
  const porId = new Map<string, number>()
  for (const a of alocs) porId.set(a[campo] ?? '', (porId.get(a[campo] ?? '') ?? 0) + a.percentual)
  const partes = Array.from(porId.entries())
  const nome = (id: string) => (id ? nomes.get(id) ?? '?' : 'sem')
  if (partes.length === 1) return partes[0][0] ? nome(partes[0][0]) : '—'
  return partes
    .sort((a, b) => b[1] - a[1])
    .map(([id, pct]) => `${nome(id)} ${pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`)
    .join(' · ')
}

function quando(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '')
}

interface Props {
  version: BudgetVersionListItem
  versions: BudgetVersionListItem[]
  legalEntities: LegalEntity[]
  costCenters: SimpleDimensionItem[]
  businessUnits: SimpleDimensionItem[]
  contactOptions: SimpleDimensionItem[]
  leafCategories: CategoryItem[]
  /** A geração muda as séries do Planejamento — o shell recarrega. */
  onChanged: () => void
}

export function QuadroTab({
  version, versions, legalEntities, costCenters, businessUnits, contactOptions, leafCategories, onChanged,
}: Props) {
  const [quadro, setQuadro] = useState<QuadroDaVersao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [isLoading, startLoading] = useTransition()

  const [filters, setFilters] = useState<Filters>({})
  const [sort, setSort] = useState<SortKey>('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)

  const [editing, setEditing] = useState<PessoaDoQuadro | 'nova' | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PessoaDoQuadro | null>(null)
  const [naturezasOpen, setNaturezasOpen] = useState(false)
  const [gerarOpen, setGerarOpen] = useState(false)
  const [copiarOpen, setCopiarOpen] = useState(false)
  const [isMutating, startMutation] = useTransition()

  const carregar = useCallback(() => {
    startLoading(async () => {
      try {
        const r = await getQuadro(version.id)
        if ('error' in r) { setErro(r.error); return }
        setErro(null)
        setQuadro(r)
      } catch {
        setErro('Não foi possível carregar o quadro de pessoal.')
      }
    })
  }, [version.id])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setFilters(JSON.parse(raw) as Filters)
    } catch { /* ignora */ }
  }, [])

  const update = useCallback((patch: Partial<Filters>) => {
    setFilters(prev => {
      const next = { ...prev, ...patch }
      for (const k of Object.keys(next) as (keyof Filters)[]) if (!next[k]) delete next[k]
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignora */ }
      return next
    })
    setPage(1)
  }, [])

  function clearAll() {
    setFilters({})
    setPage(1)
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignora */ }
  }

  function toggleSort(key: SortKey) {
    if (sort !== key) { setSort(key); setSortDir(key === 'nome' ? 'asc' : 'desc'); return }
    if (sortDir === (key === 'nome' ? 'asc' : 'desc')) { setSortDir(key === 'nome' ? 'desc' : 'asc'); return }
    setSort(''); setSortDir('asc')
  }

  const nomeUJ = useMemo(() => new Map(legalEntities.map(l => [l.id, l.name])), [legalEntities])
  const nomeCC = useMemo(() => new Map(costCenters.map(c => [c.id, c.name])), [costCenters])
  const nomeUEN = useMemo(() => new Map(businessUnits.map(b => [b.id, b.name])), [businessUnits])
  const nomeContato = useMemo(() => new Map(contactOptions.map(c => [c.id, c.name])), [contactOptions])

  const pessoas = useMemo(() => quadro?.pessoas ?? [], [quadro])

  // Opções de filtro: só o que aparece no quadro.
  const opcoes = useMemo(() => {
    const uj = new Map<string, string>(), cc = new Map<string, string>(), uen = new Map<string, string>()
    for (const p of pessoas) {
      if (p.legalEntityId) uj.set(p.legalEntityId, nomeUJ.get(p.legalEntityId) ?? '?')
      for (const a of p.alocacoes) {
        if (a.costCenterId) cc.set(a.costCenterId, nomeCC.get(a.costCenterId) ?? '?')
        if (a.businessUnitId) uen.set(a.businessUnitId, nomeUEN.get(a.businessUnitId) ?? '?')
      }
    }
    const lista = (m: Map<string, string>): DimensionOption[] =>
      Array.from(m.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
    return {
      vinculo: VINCULOS.filter(v => pessoas.some(p => p.vinculo === v)).map(v => ({ id: v, label: VINCULO_LABELS[v] })),
      uj: lista(uj), cc: lista(cc), uen: lista(uen),
    }
  }, [pessoas, nomeUJ, nomeCC, nomeUEN])

  const filtradas = useMemo(() => {
    const nome = filters.nome?.toLowerCase()
    const rows = pessoas.filter(p => {
      if (nome && !`${p.nomeExibido} ${p.cargo ?? ''}`.toLowerCase().includes(nome)) return false
      if (!multiMatch([p.vinculo], filters.vinculo)) return false
      if (!multiMatch([p.legalEntityId], filters.uj)) return false
      if (!multiMatch(p.alocacoes.map(a => a.costCenterId), filters.cc)) return false
      if (!multiMatch(p.alocacoes.map(a => a.businessUnitId), filters.uen)) return false
      return true
    })
    if (sort) {
      const f = sortDir === 'asc' ? 1 : -1
      rows.sort((a, b) => {
        if (sort === 'nome') return f * a.nomeExibido.localeCompare(b.nomeExibido)
        if (sort === 'base') return f * (a.valorBase - b.valorBase)
        return f * ((a.custoAnualCentavos ?? -1) - (b.custoAnualCentavos ?? -1))
      })
    }
    return rows
  }, [pessoas, filters, sort, sortDir])

  const total = useMemo(() => filtradas.reduce((s, p) => s + (p.custoAnualCentavos ?? 0), 0), [filtradas])
  const semRegime = pessoas.filter(p => p.custoAnualCentavos === null)
  const pages = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE))
  const visiveis = filtradas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasFilters = Object.keys(filters).length > 0
  const currentSort = sort ? `${sort}_${sortDir}` : ''

  function aposMudar() {
    carregar()
  }

  function confirmarExclusao() {
    if (!pendingDelete) return
    const alvo = pendingDelete
    startMutation(async () => {
      const r = await deletePessoa(version.id, alvo.id)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(`${alvo.nomeExibido} saiu do quadro.`)
      setPendingDelete(null)
      aposMudar()
    })
  }

  // ── Estados ──
  if (!quadro && erro) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <ErrorState title="Não foi possível abrir o quadro" description={erro} onRetry={carregar} />
      </div>
    )
  }
  if (!quadro) {
    return <div className="px-6 py-4"><LoadingState variant="skeleton" rows={6} /></div>
  }

  const editavel = quadro.versao.editavel

  const dialogos = (
    <>
      {editing && (
        <PessoaDialog
          open={!!editing}
          onOpenChange={o => { if (!o) setEditing(null) }}
          versionId={version.id}
          exercicio={quadro.versao.exercicio}
          settings={quadro.settings}
          pessoa={editing === 'nova' ? undefined : editing}
          editavel={editavel}
          legalEntities={legalEntities}
          costCenters={costCenters}
          businessUnits={businessUnits}
          contactOptions={contactOptions}
          leafCategories={leafCategories}
          onSaved={aposMudar}
        />
      )}
      <NaturezasFolhaDialog open={naturezasOpen} onOpenChange={setNaturezasOpen}
        leafCategories={leafCategories} editavel={editavel} onSaved={aposMudar} />
      <GerarFolhaDialog open={gerarOpen} onOpenChange={setGerarOpen} versionId={version.id}
        exercicio={quadro.versao.exercicio} editavel={editavel}
        onGenerated={() => { aposMudar(); onChanged() }} />
      <CopiarQuadroDialog open={copiarOpen} onOpenChange={setCopiarOpen} destino={version} versions={versions}
        pessoasAtuais={pessoas.length} onCopied={aposMudar} />
    </>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Zona 1: parâmetros e ações ── */}
      <div className="shrink-0 px-6 pb-2 space-y-2">
        <div className="flex items-center gap-x-6 gap-y-2 flex-wrap">
          <ParametrosFolhaBar key={`${quadro.settings.modoProvisao}|${quadro.settings.dissidioMes}|${quadro.settings.dissidioPct}`}
            versionId={version.id} settings={quadro.settings} editavel={editavel} onSaved={aposMudar} />
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setNaturezasOpen(true)}>
              <ListTree className="h-3.5 w-3.5" /> Naturezas
            </Button>
            {editavel && (
              <>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setCopiarOpen(true)}>
                  <Copy className="h-3.5 w-3.5" /> Copiar de…
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setEditing('nova')}>
                  <Plus className="h-3.5 w-3.5" /> Adicionar pessoa
                </Button>
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setGerarOpen(true)}
                  disabled={pessoas.length === 0}>
                  <Wand2 className="h-3.5 w-3.5" /> Gerar folha
                </Button>
              </>
            )}
          </div>
        </div>

        {quadro.desatualizado && pessoas.length > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {quadro.geradoEm
              ? `O quadro mudou desde a última geração (${quando(quadro.geradoEm)}). O orçamento ainda mostra a folha antiga.`
              : 'A folha desta versão ainda não foi gerada. O orçamento não tem nada do quadro.'}
            {editavel && (
              <button className="ml-auto font-medium hover:underline" onClick={() => setGerarOpen(true)}>Gerar folha</button>
            )}
          </div>
        )}

        {erro && (
          <PartialDataBanner
            variant="warning"
            message={`Não foi possível atualizar o quadro (${erro}). Os dados abaixo podem estar desatualizados.`}
            action={{ label: 'Tentar de novo', onClick: carregar }}
          />
        )}

        {semRegime.length > 0 && (
          <PartialDataBanner
            variant="warning"
            message={`${semRegime.length} pessoa${semRegime.length > 1 ? 's' : ''} sem custo calculado: a unidade jurídica não tem regime tributário. Informe em Configurações › Entidades jurídicas.`}
          />
        )}
      </div>

      {pessoas.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <EmptyState
            icon={<Users className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
            title={`Nenhuma pessoa no quadro de ${version.name}`}
            description="Cadastre quem está na folha — CLT, PJ, pró-labore ou estágio — e as vagas previstas. Encargos, 13º e férias são calculados aqui e entram no orçamento quando você gerar a folha."
            action={editavel ? { label: 'Adicionar pessoa', onClick: () => setEditing('nova') } : undefined}
          />
          {dialogos}
        </div>
      ) : (
        <>
          {/* ── Zona 2: totalizador ── */}
          <div className="shrink-0 px-6 pb-3 flex items-center gap-6 flex-wrap text-xs">
            <span className="text-muted-foreground">
              <span className="tabular-nums font-medium text-foreground">{filtradas.length}</span>
              {filtradas.length === 1 ? ' pessoa' : ' pessoas'}
              {hasFilters && <span> de {pessoas.length}</span>}
            </span>
            <span className="text-muted-foreground">
              Custo do ano <span className="tabular-nums font-semibold text-foreground">{fmtCentavos(total)}</span>
            </span>
            {hasFilters && <button onClick={clearAll} className="text-primary hover:underline">Limpar tudo</button>}
            {!editavel && <span className="ml-auto text-amber-600">Versão arquivada — somente leitura.</span>}
          </div>

          {/* ── Zona 4: tabela ── */}
          <div className="flex-1 min-h-0 overflow-hidden px-6">
            <div className={cn('h-full overflow-auto border rounded-lg', (isLoading || isMutating) && 'opacity-60')}>
              <table className="w-full text-xs border-collapse [&_td]:border-r [&_th]:border-r [&_td]:border-border/20 [&_th]:border-border/20 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted border-b">
                    <th className="text-left px-1 min-w-[180px]">
                      <ColHeader hasValue={!!filters.nome} onClear={() => update({ nome: undefined })}
                        sortKey="nome" currentSort={currentSort} onSort={() => toggleSort('nome')}>
                        <DescFilter value={filters.nome} onUpdate={v => update({ nome: v })} />
                      </ColHeader>
                    </th>
                    <th className="text-left px-1 w-28">
                      <ColHeader hasValue={!!filters.vinculo} onClear={() => update({ vinculo: undefined })}>
                        <MultiSelectFilter placeholder="Vínculo" value={filters.vinculo} options={opcoes.vinculo}
                          width="w-44" onUpdate={v => update({ vinculo: v })} />
                      </ColHeader>
                    </th>
                    <th className="text-left px-2 font-medium text-muted-foreground w-36">Cargo</th>
                    <th className="text-left px-1 w-36">
                      <ColHeader hasValue={!!filters.uj} onClear={() => update({ uj: undefined })}>
                        <MultiSelectFilter placeholder="Und. jurídica" value={filters.uj} options={opcoes.uj}
                          onUpdate={v => update({ uj: v })} />
                      </ColHeader>
                    </th>
                    <th className="text-left px-1 min-w-[150px]">
                      <ColHeader hasValue={!!filters.cc} onClear={() => update({ cc: undefined })}>
                        <MultiSelectFilter placeholder="Centro de custo" value={filters.cc} options={opcoes.cc}
                          onUpdate={v => update({ cc: v })} />
                      </ColHeader>
                    </th>
                    <th className="text-left px-1 min-w-[130px]">
                      <ColHeader hasValue={!!filters.uen} onClear={() => update({ uen: undefined })}>
                        <MultiSelectFilter placeholder="Unid. negócio" value={filters.uen} options={opcoes.uen}
                          onUpdate={v => update({ uen: v })} />
                      </ColHeader>
                    </th>
                    <th className="text-left px-2 font-medium text-muted-foreground w-32">Contato</th>
                    <th className="text-right px-1 w-28">
                      <ColHeader sortKey="base" currentSort={currentSort} onSort={() => toggleSort('base')}
                        hasValue={false} onClear={() => {}}>
                        <span className="w-full text-right font-medium text-muted-foreground">Base/mês</span>
                      </ColHeader>
                    </th>
                    <th className="text-left px-2 font-medium text-muted-foreground w-28">Meses</th>
                    <th className="text-right px-1 w-32">
                      <ColHeader sortKey="custo" currentSort={currentSort} onSort={() => toggleSort('custo')}
                        hasValue={false} onClear={() => {}}>
                        <span className="w-full text-right font-medium text-muted-foreground">Custo ano</span>
                      </ColHeader>
                    </th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {visiveis.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                        Ninguém no quadro com esses filtros.
                      </td>
                    </tr>
                  )}
                  {visiveis.map(p => (
                    <tr key={p.id} className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => setEditing(p)}>
                      <td className="px-2 py-1.5">
                        <span className={cn('font-medium', p.isVaga && 'italic')}>{p.nomeExibido}</span>
                        {p.isVaga && (
                          <span className="ml-2 text-[10px] rounded px-1.5 py-0.5 bg-sky-500/15 text-sky-700">vaga</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">{VINCULO_LABELS[p.vinculo]}</td>
                      <td className="px-2 py-1.5 truncate max-w-[160px]">{p.cargo ?? '—'}</td>
                      <td className="px-2 py-1.5 truncate max-w-[160px]">
                        {p.legalEntityId ? nomeUJ.get(p.legalEntityId) ?? '?' : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{rotuloAlocacao(p.alocacoes, 'costCenterId', nomeCC)}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{rotuloAlocacao(p.alocacoes, 'businessUnitId', nomeUEN)}</td>
                      <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[140px]">
                        {p.contactId ? nomeContato.get(p.contactId) ?? '?' : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(p.valorBase)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{rotuloMeses(p)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                        {p.custoAnualCentavos === null
                          ? <span className="text-amber-600 font-normal" title="A unidade jurídica não tem regime tributário.">sem regime</span>
                          : fmtCentavos(p.custoAnualCentavos)}
                      </td>
                      <td className="px-1 py-1.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5">
                          <button onClick={() => setEditing(p)} title={editavel ? 'Editar' : 'Ver'}
                            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted">
                            <Pencil className="h-3 w-3" />
                          </button>
                          {editavel && (
                            <button onClick={() => setPendingDelete(p)} title="Tirar do quadro"
                              className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0">
                  <tr className="bg-muted border-t font-semibold">
                    <td className="px-2 py-1.5" colSpan={9}>
                      Total{hasFilters ? ' (filtrado)' : ''}
                      {semRegime.length > 0 && <span className="font-normal text-muted-foreground"> — sem as pessoas sem regime</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtCentavos(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ── Zona 5: paginação ── */}
          {pages > 1 && (
            <div className="shrink-0 px-6 py-2 flex items-center justify-end gap-2 text-xs">
              <Button variant="outline" size="sm" className="h-7 text-xs"
                disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
              <span className="text-muted-foreground tabular-nums">Página {page} de {pages}</span>
              <Button variant="outline" size="sm" className="h-7 text-xs"
                disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Próxima</Button>
            </div>
          )}

          {dialogos}
        </>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={o => { if (!o) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tirar {pendingDelete?.nomeExibido} do quadro?</AlertDialogTitle>
            <AlertDialogDescription>
              Saem a pessoa, as alocações e os benefícios. Os lançamentos já gerados continuam no orçamento até a próxima geração da folha.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarExclusao} disabled={isMutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isMutating ? 'Tirando…' : 'Tirar do quadro'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
