'use client'

// O painel: seletor de mês, seletor de painel, a grade de 12 colunas e a
// gestão de layout (mover, redimensionar, remover) para quem pode editar.
//
// O que a tela NÃO faz na v1, por decisão de 25/ago: criar bloco e editar a
// consulta de um bloco. Isso é do expert, pelo claude.ai — o formulário do
// QuerySpec inteiro é praticamente uma segunda tela de DRE, e fica para a v1.1.

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Loader2, Plus, MoreVertical, ChevronUp, ChevronDown, Trash2, Star,
  Pencil, Share2, Maximize2, Minimize2, LayoutGrid, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { DrillDownDialog } from '@/components/transacoes-shared/drill-down-dialog'
import { getDashboardCategoryDrillDown } from '@/server/dashboard'
import {
  materializarPainelPadraoAction, criarPainelAction, renomearPainelAction,
  apagarPainelAction, definirPainelPadraoAction, removerBlocoAction,
  reordenarBlocosAction, redimensionarBlocoAction,
  type EstadoDoPainel, type BlocoRenderizado,
} from '@/server/dashboards'
import { papelAtinge } from '@/lib/members-types'
import type { DrillDownTransaction, LeafCategory } from '@/lib/dre-types'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'
import type { SimpleDimensionItem } from '@/components/transacoes-shared/types'
import { BlockView } from './block-view'
import { SharePanelDialog } from './share-panel-dialog'
import { NomeDoPainelDialog } from './panel-name-dialog'

/** Largura em colunas de 12 → classe de grade. Literais para o JIT enxergar. */
const LARGURA: Record<number, string> = {
  1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-4',
  5: 'md:col-span-5', 6: 'md:col-span-6', 7: 'md:col-span-7', 8: 'md:col-span-8',
  9: 'md:col-span-9', 10: 'md:col-span-10', 11: 'md:col-span-11', 12: 'md:col-span-12',
}

interface DrillState {
  title: string
  subtitle: string
  categoryIds: string[]
  dateRange: { from: string; to: string }
}

export interface DashboardGridProps {
  estado: EstadoDoPainel
  selectedMonth: string          // 'YYYY-MM'
  monthRange: { from: string; to: string; label: string }
  leafCategories: LeafCategory[]
  costCenters: CostCenter[]
  businessUnits: BusinessUnit[]
  legalEntities: LegalEntity[]
  contactOptions: SimpleDimensionItem[]
}

export function DashboardGrid({
  estado, selectedMonth, monthRange,
  leafCategories, costCenters, businessUnits, legalEntities, contactOptions,
}: DashboardGridProps) {
  const router = useRouter()
  const { painel, disponiveis, papel } = estado
  const [pendente, iniciar] = useTransition()
  const [isNavPending, startNav] = useTransition()

  const [drill, setDrill] = useState<DrillState | null>(null)
  const [drillData, setDrillData] = useState<DrillDownTransaction[] | null>(null)
  const [isDrillLoading, startDrill] = useTransition()

  const [apagarAberto, setApagarAberto] = useState(false)
  const [nomeAberto, setNomeAberto] = useState<'criar' | 'renomear' | null>(null)
  const [shareAberto, setShareAberto] = useState(false)
  const [editandoLayout, setEditandoLayout] = useState(false)

  // Alertas dispensados: por MÊS, herança da Fase 6 — o que foi dispensado em
  // março tem de voltar quando o usuário olha abril.
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`lure:dashboard:dismissed-alerts:${selectedMonth}`)
      setDismissedIds(stored ? (JSON.parse(stored) as string[]) : [])
    } catch { setDismissedIds([]) }
  }, [selectedMonth])

  function dismissAlert(id: string) {
    setDismissedIds(prev => {
      const next = [...prev, id]
      try { localStorage.setItem(`lure:dashboard:dismissed-alerts:${selectedMonth}`, JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }

  function irPara(params: { month?: string; painel?: string }) {
    const sp = new URLSearchParams()
    sp.set('month', params.month ?? selectedMonth)
    const alvo = params.painel ?? painel.id
    if (alvo) sp.set('painel', alvo)
    startNav(() => router.push(`/dashboard?${sp.toString()}`))
  }

  function abrirDrill(categoriaId: string, rotulo: string) {
    setDrill({
      title: rotulo,
      subtitle: monthRange.label,
      categoryIds: [categoriaId],
      dateRange: { from: monthRange.from, to: monthRange.to },
    })
    setDrillData(null)
    startDrill(async () => {
      const r = await getDashboardCategoryDrillDown([categoriaId], { from: monthRange.from, to: monthRange.to })
      setDrillData(r.transactions)
    })
  }

  // As actions devolvem `{ erro }` OU o resultado — a recusa é descritiva, não
  // exceção (o padrão do projeto desde `resolverAcessoIa`).
  function acao(fn: () => Promise<unknown>, sucesso: string) {
    iniciar(async () => {
      const r = await fn()
      const erro = r && typeof r === 'object' && 'erro' in r ? String(r.erro) : null
      if (erro) toast.error(erro)
      else { toast.success(sucesso); router.refresh() }
    })
  }

  function mover(bloco: BlocoRenderizado, direcao: -1 | 1) {
    if (!painel.id) return
    const ordem = painel.blocos.map(b => b.id)
    const i = ordem.indexOf(bloco.id)
    const j = i + direcao
    if (j < 0 || j >= ordem.length) return
    ;[ordem[i], ordem[j]] = [ordem[j], ordem[i]]
    acao(() => reordenarBlocosAction(painel.id!, ordem), 'Ordem atualizada.')
  }

  function redimensionar(bloco: BlocoRenderizado, largura: number) {
    if (!painel.id) return
    acao(() => redimensionarBlocoAction(painel.id!, bloco.id, largura), 'Tamanho atualizado.')
  }

  const podeCriar = papelAtinge(papel, 'admin')
  const podeEditarEste = painel.podeEditar && podeCriar

  return (
    <div className="space-y-6">
      {/* Barra: painel, mês e ações */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {disponiveis.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <LayoutGrid className="h-3.5 w-3.5" />
                  {painel.nome}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {disponiveis.map(p => (
                  <DropdownMenuItem key={p.id} onClick={() => irPara({ painel: p.id })}>
                    <span className="flex-1 truncate">{p.nome}</span>
                    {p.padrao && <Star className="h-3 w-3 text-amber-500 fill-amber-500 ml-2 shrink-0" />}
                    {p.permissao !== 'dono' && (
                      <span className="text-[10px] text-muted-foreground ml-2 shrink-0">compartilhado</span>
                    )}
                  </DropdownMenuItem>
                ))}
                {podeCriar && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setNomeAberto('criar')}>
                      <Plus className="h-3.5 w-3.5 mr-2" /> Novo painel
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="text-sm text-muted-foreground">{painel.nome}</span>
          )}

          {painel.virtual && podeCriar && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pendente}
              onClick={() => acao(materializarPainelPadraoAction, 'Painel criado — agora dá para personalizar.')}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Personalizar
            </Button>
          )}

          {!painel.virtual && podeEditarEste && (
            <Button
              variant={editandoLayout ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setEditandoLayout(v => !v)}
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              {editandoLayout ? 'Concluir' : 'Organizar'}
            </Button>
          )}

          {!painel.virtual && painel.ehDono && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="px-2">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setNomeAberto('renomear')}>
                  <Pencil className="h-3.5 w-3.5 mr-2" /> Renomear
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShareAberto(true)}>
                  <Share2 className="h-3.5 w-3.5 mr-2" /> Compartilhar
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => acao(() => definirPainelPadraoAction(painel.id!), 'Este é seu painel padrão.')}
                >
                  <Star className="h-3.5 w-3.5 mr-2" /> Definir como padrão
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-rose-600" onClick={() => setApagarAberto(true)}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Apagar painel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="dashboard-month" className="text-xs text-muted-foreground">
            Mês de referência
          </label>
          <input
            id="dashboard-month"
            type="month"
            value={selectedMonth}
            onChange={e => {
              if (/^\d{4}-\d{2}$/.test(e.target.value)) irPara({ month: e.target.value })
            }}
            disabled={isNavPending}
            className="h-8 rounded-md border border-input px-2 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          {(isNavPending || pendente) && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {painel.virtual && podeCriar && (
        <p className="text-xs text-muted-foreground">
          Este é o painel padrão. Clique em Personalizar para torná-lo seu e reorganizá-lo — ou peça
          blocos novos ao expert, pelo claude.ai.
        </p>
      )}

      {/* A grade */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {painel.blocos.map(bloco => (
          <div key={bloco.id} className={`${LARGURA[bloco.largura] ?? 'md:col-span-12'} relative`}>
            {editandoLayout && !painel.virtual && (
              <div className="absolute -top-2 right-1 z-10 flex items-center gap-0.5 rounded-md border bg-background shadow-sm px-1 py-0.5">
                <button
                  type="button" title="Subir" disabled={pendente}
                  onClick={() => mover(bloco, -1)}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button" title="Descer" disabled={pendente}
                  onClick={() => mover(bloco, 1)}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button" title="Estreitar" disabled={pendente || bloco.largura <= 3}
                  onClick={() => redimensionar(bloco, Math.max(3, bloco.largura - 3))}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button" title="Alargar" disabled={pendente || bloco.largura >= 12}
                  onClick={() => redimensionar(bloco, Math.min(12, bloco.largura + 3))}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button" title="Remover bloco" disabled={pendente}
                  onClick={() => acao(() => removerBlocoAction(painel.id!, bloco.id), 'Bloco removido.')}
                  className="p-1 text-rose-500 hover:text-rose-600 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <BlockView
              bloco={bloco}
              dismissedIds={dismissedIds}
              onDismissAlert={dismissAlert}
              onDrill={abrirDrill}
            />
          </div>
        ))}
      </div>

      {painel.blocos.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Este painel está vazio. Peça um bloco ao expert pelo claude.ai — por exemplo,
            &quot;monte um ranking das 5 unidades de negócio com maior despesa&quot;.
          </p>
        </div>
      )}

      {drill && (
        <DrillDownDialog
          open
          onOpenChange={o => { if (!o) { setDrill(null); setDrillData(null) } }}
          title={drill.title}
          subtitle={drill.subtitle}
          data={drillData}
          loading={isDrillLoading}
          onDataChange={setDrillData}
          leafCategories={leafCategories}
          costCenters={costCenters}
          businessUnits={businessUnits}
          legalEntities={legalEntities}
          contacts={contactOptions}
        />
      )}

      <NomeDoPainelDialog
        modo={nomeAberto}
        nomeAtual={painel.nome}
        onFechar={() => setNomeAberto(null)}
        onConfirmar={(nome) => {
          const fn = nomeAberto === 'criar'
            ? () => criarPainelAction(nome)
            : () => renomearPainelAction(painel.id!, nome)
          setNomeAberto(null)
          acao(fn, nomeAberto === 'criar' ? 'Painel criado.' : 'Painel renomeado.')
        }}
      />

      {painel.id && (
        <SharePanelDialog
          open={shareAberto}
          onOpenChange={setShareAberto}
          painelId={painel.id}
          compartilhamentos={painel.compartilhamentos}
        />
      )}

      <AlertDialog open={apagarAberto} onOpenChange={setApagarAberto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar &quot;{painel.nome}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Os blocos e os compartilhamentos deste painel serão apagados junto. Os dados
              financeiros não são afetados — só a forma de visualizá-los.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => {
                setApagarAberto(false)
                acao(() => apagarPainelAction(painel.id!), 'Painel apagado.')
              }}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
