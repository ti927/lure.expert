'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Loader2, Plus, Target } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/states/empty-state'
import { CellCombobox } from '@/components/transacoes-shared/cell-combobox'
import type { SimpleDimensionItem } from '@/components/transacoes-shared/types'
import { listBudgetSeries, listBudgetVersions } from '@/server/budget'
import type { BudgetSeriesListItem, BudgetVersionListItem } from '@/lib/budget-types'
import { BUDGET_STATUS_LABELS } from '@/lib/budget-types'
import type { LeafCategory } from '@/lib/dre-types'
import type { CostCenter } from '@/db/schema/cost-centers'
import type { BusinessUnit } from '@/db/schema/business-units'
import type { LegalEntity } from '@/db/schema/legal-entities'
import { PlanejamentoTab } from './planejamento-tab'
import { ComparacaoTab } from './comparacao-tab'
import { VersoesTab } from './versoes-tab'
import { SeriesDialog } from './series-dialog'

const STORAGE_KEY = 'lure:orcamento:filters'

type TabKey = 'planejamento' | 'comparacao' | 'versoes'

interface Props {
  initialVersions: BudgetVersionListItem[]
  initialSelectedId: string | null
  initialSeries: BudgetSeriesListItem[]
  costCenters: CostCenter[]
  businessUnits: BusinessUnit[]
  legalEntities: LegalEntity[]
  leafCategories: LeafCategory[]
  contactOptions: SimpleDimensionItem[]
}

export function OrcamentoClient({
  initialVersions,
  initialSelectedId,
  initialSeries,
  costCenters,
  businessUnits,
  legalEntities,
  leafCategories,
  contactOptions,
}: Props) {
  const [versions, setVersions] = useState(initialVersions)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [series, setSeries] = useState(initialSeries)
  const [tab, setTab] = useState<TabKey>('planejamento')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const selectedVersion = versions.find(v => v.id === selectedId) ?? null
  const isArchived = selectedVersion?.status === 'arquivado'

  // Restaura a versão e a aba escolhidas na sessão anterior, se ainda existirem.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as { versionId?: string; tab?: TabKey }
      if (saved.tab) setTab(saved.tab)
      if (saved.versionId && saved.versionId !== initialSelectedId
          && initialVersions.some(v => v.id === saved.versionId)) {
        selectVersion(saved.versionId)
      }
    } catch { /* storage indisponível — segue com o default do servidor */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = useCallback((next: { versionId?: string | null; tab?: TabKey }) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        versionId: next.versionId !== undefined ? next.versionId : selectedId,
        tab: next.tab ?? tab,
      }))
    } catch { /* ignora */ }
  }, [selectedId, tab])

  function selectVersion(id: string | null) {
    setSelectedId(id)
    persist({ versionId: id })
    if (!id) { setSeries([]); return }
    startTransition(async () => {
      setSeries(await listBudgetSeries(id))
    })
  }

  /** Recarrega versões e séries — chamado após qualquer mutação. */
  const refresh = useCallback((nextVersionId?: string) => {
    startTransition(async () => {
      const fresh = await listBudgetVersions()
      setVersions(fresh)

      const target = nextVersionId
        ?? (fresh.some(v => v.id === selectedId) ? selectedId : null)
        ?? fresh.find(v => v.isActive)?.id
        ?? fresh[0]?.id
        ?? null

      setSelectedId(target)
      persist({ versionId: target })
      setSeries(target ? await listBudgetSeries(target) : [])
    })
  }, [selectedId, persist])

  function changeTab(next: string) {
    setTab(next as TabKey)
    persist({ tab: next as TabKey })
  }

  function openNewSeries() {
    if (!selectedVersion) {
      toast.error('Crie uma versão de orçamento antes de lançar previsões.')
      setTab('versoes')
      return
    }
    if (isArchived) {
      toast.error('Esta versão está arquivada. Duplique-a para trabalhar em cima dela.')
      return
    }
    setDialogOpen(true)
  }

  const versionOptions: SimpleDimensionItem[] = versions.map(v => ({
    id: v.id,
    name: `${v.name}${v.isActive ? ' · vigente' : ''}${v.status !== 'rascunho' ? ` · ${BUDGET_STATUS_LABELS[v.status]}` : ''}`,
    code: String(v.fiscalYear),
  }))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Zona 1: cabeçalho ── */}
      <div className="shrink-0 px-6 pt-6 pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold tracking-tight">Orçamento</h1>
          {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}

          <div className="ml-auto flex items-center gap-2">
            {versions.length > 0 && (
              <div className="w-72">
                <CellCombobox
                  value={selectedId}
                  options={versionOptions}
                  placeholder="Escolha a versão"
                  onValueChange={selectVersion}
                />
              </div>
            )}
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openNewSeries}>
              <Plus className="h-3.5 w-3.5" />
              Novo lançamento
            </Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={changeTab} className="mt-3">
          <TabsList className="h-8">
            <TabsTrigger value="planejamento" className="text-xs h-6">Planejamento</TabsTrigger>
            <TabsTrigger value="comparacao" className="text-xs h-6">Orçado × Realizado</TabsTrigger>
            <TabsTrigger value="versoes" className="text-xs h-6">
              Versões
              {versions.length > 0 && (
                <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">{versions.length}</span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* ── Conteúdo elástico ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'planejamento' && (
          selectedVersion ? (
            <PlanejamentoTab
              key={selectedVersion.id}
              version={selectedVersion}
              series={series}
              isPending={isPending}
              costCenters={costCenters}
              businessUnits={businessUnits}
              legalEntities={legalEntities}
              leafCategories={leafCategories}
              contactOptions={contactOptions}
              onChanged={() => refresh()}
            />
          ) : (
            <div className="h-full flex items-center justify-center px-6">
              <EmptyState
                icon={<Target className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
                title="Nenhuma versão de orçamento"
                description="Crie a versão do exercício para começar a lançar previsões de recebimento e pagamento."
                action={{ label: 'Criar versão', onClick: () => changeTab('versoes') }}
              />
            </div>
          )
        )}

        {tab === 'comparacao' && (
          selectedVersion ? (
            <ComparacaoTab
              key={`${selectedVersion.id}`}
              version={selectedVersion}
              costCenters={costCenters}
              businessUnits={businessUnits}
              legalEntities={legalEntities}
              leafCategories={leafCategories}
            />
          ) : (
            <div className="h-full flex items-center justify-center px-6">
              <EmptyState
                icon={<Target className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
                title="Nenhuma versão de orçamento"
                description="Crie a versão do exercício para comparar o orçado com o realizado."
                action={{ label: 'Criar versão', onClick: () => changeTab('versoes') }}
              />
            </div>
          )
        )}

        {tab === 'versoes' && (
          <VersoesTab
            versions={versions}
            selectedId={selectedId}
            isPending={isPending}
            onSelect={selectVersion}
            onChanged={(nextId) => refresh(nextId)}
          />
        )}
      </div>

      {selectedVersion && (
        <SeriesDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          mode="create"
          versionId={selectedVersion.id}
          fiscalYear={selectedVersion.fiscalYear}
          leafCategories={leafCategories}
          costCenters={costCenters}
          businessUnits={businessUnits}
          legalEntities={legalEntities}
          contactOptions={contactOptions}
          onSaved={() => refresh()}
        />
      )}
    </div>
  )
}
