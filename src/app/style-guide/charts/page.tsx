// Vitrine da biblioteca de gráficos (Fase 5.A) — a paleta categórica e os
// sete componentes de `src/components/charts/`, com dados de amostra.
//
// É aqui que a paleta é conferida a olho antes de o renderizador de blocos
// (5.C) existir. Dados fictícios, nenhuma consulta ao banco.

import Link from 'next/link'
import { BarChart } from '@/components/charts/bar-chart'
import { LineChart } from '@/components/charts/line-chart'
import { AreaChart } from '@/components/charts/area-chart'
import { ComposedChart } from '@/components/charts/composed-chart'
import { PieChart } from '@/components/charts/pie-chart'
import { HorizontalBarChart } from '@/components/charts/horizontal-bar'
import {
  COR_ENTRADA, COR_SAIDA, COR_ENTRADA_PROJETADA, COR_SAIDA_PROJETADA,
} from '@/components/charts/chart-theme'

// ─── Dados de amostra ────────────────────────────────────────────────────────

const SEMANAS = [
  { label: '5/01',  inflow: 48200, outflow: 31500 },
  { label: '12/01', inflow: 39800, outflow: 42100 },
  { label: '19/01', inflow: 55400, outflow: 28900 },
  { label: '26/01', inflow: 42600, outflow: 35700 },
  { label: '2/02',  inflow: 61300, outflow: 44200 },
  { label: '9/02',  inflow: 47100, outflow: 38600 },
]

const SEMANAS_PROJETADAS = [
  { label: '2/02',  inflowReal: 61300, inflowProjetado: 0,     outflowReal: 44200, outflowProjetado: 0 },
  { label: '9/02',  inflowReal: 47100, inflowProjetado: 0,     outflowReal: 38600, outflowProjetado: 0 },
  { label: '16/02', inflowReal: 0,     inflowProjetado: 45000, outflowReal: 0,     outflowProjetado: 36200 },
  { label: '23/02', inflowReal: 0,     inflowProjetado: 52000, outflowReal: 0,     outflowProjetado: 33800 },
]

const MESES = [
  { mes: 'jan', receita: 182000, despesas: 148000, orcado: 175000 },
  { mes: 'fev', receita: 168500, despesas: 152300, orcado: 175000 },
  { mes: 'mar', receita: 201200, despesas: 159800, orcado: 185000 },
  { mes: 'abr', receita: 189400, despesas: 171200, orcado: 185000 },
  { mes: 'mai', receita: 214800, despesas: 165400, orcado: 195000 },
  { mes: 'jun', receita: 198100, despesas: 173900, orcado: 195000 },
]

const COMPOSICAO = [
  { nome: 'Comercial',       valor: 84200 },
  { nome: 'Administrativo',  valor: 52800 },
  { nome: 'Operações',       valor: 41500 },
  { nome: 'Tecnologia',      valor: 28300 },
  { nome: 'Marketing',       valor: 19600 },
]

const RANKING = [
  { nome: 'Restaurante',  valor: 96400 },
  { nome: 'Hotel',        valor: 71200 },
  { nome: 'Eventos',      valor: 45800 },
  { nome: 'Delivery',     valor: 28900 },
  { nome: 'Loja virtual', valor: 12300 },
]

// As classes precisam estar literais para o JIT do Tailwind enxergá-las.
const PALETA = [
  { token: '--chart-1', classe: 'bg-chart-1', nome: 'emerald' },
  { token: '--chart-2', classe: 'bg-chart-2', nome: 'sky' },
  { token: '--chart-3', classe: 'bg-chart-3', nome: 'amber' },
  { token: '--chart-4', classe: 'bg-chart-4', nome: 'violet' },
  { token: '--chart-5', classe: 'bg-chart-5', nome: 'lime' },
  { token: '--chart-6', classe: 'bg-chart-6', nome: 'blue' },
  { token: '--chart-7', classe: 'bg-chart-7', nome: 'fuchsia' },
  { token: '--chart-8', classe: 'bg-chart-8', nome: 'slate ("outros")' },
]

export default function ChartsStyleGuidePage() {
  return (
    <div className="min-h-screen bg-background p-8 space-y-16">
      <header className="border-b border-border pb-6">
        <h1 className="text-3xl font-semibold text-foreground">
          lure.expert — Gráficos
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Paleta categórica e os 7 componentes de <code>components/charts/</code> · Fase 5.A
        </p>
        <nav className="flex gap-4 mt-3 text-sm">
          <Link href="/style-guide" className="text-primary underline underline-offset-2">Tokens</Link>
          <Link href="/style-guide/components" className="text-primary underline underline-offset-2">Componentes</Link>
        </nav>
      </header>

      {/* PALETA */}
      <section className="space-y-4">
        <SectionTitle>Paleta categórica — séries e fatias sem juízo de valor</SectionTitle>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Para composição e ranking: a ordem intercala famílias de matiz para vizinhos contrastarem,
          e o rose fica fora de propósito — fatia de pizza não pode parecer prejuízo. Entradas e
          saídas continuam nas semânticas de sempre.
        </p>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
          {PALETA.map(({ token, classe, nome }, i) => (
            <div key={token} className="space-y-1">
              <div className={`h-14 rounded-md ${classe} flex items-end p-1.5`}>
                <span className="text-[10px] font-medium text-white/90">{i + 1}</span>
              </div>
              <p className="text-[10px] text-muted-foreground text-center font-mono">{token}</p>
              <p className="text-[10px] text-muted-foreground/70 text-center">{nome}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-w-2xl">
          {[
            { rotulo: 'Entrada',        cor: COR_ENTRADA },
            { rotulo: 'Saída',          cor: COR_SAIDA },
            { rotulo: 'Entrada (proj.)', cor: COR_ENTRADA_PROJETADA },
            { rotulo: 'Saída (proj.)',   cor: COR_SAIDA_PROJETADA },
          ].map(({ rotulo, cor }) => (
            <div key={rotulo} className="space-y-1">
              <div className="h-10 rounded-md" style={{ background: cor }} />
              <p className="text-[10px] text-muted-foreground text-center">{rotulo}</p>
            </div>
          ))}
        </div>
      </section>

      {/* BARRAS */}
      <section className="space-y-4">
        <SectionTitle>BarChart — agrupado (o gráfico do dashboard)</SectionTitle>
        <ChartCard>
          <BarChart
            data={SEMANAS}
            x="label"
            legenda
            series={[
              { key: 'inflow',  label: 'Entradas', cor: COR_ENTRADA },
              { key: 'outflow', label: 'Saídas',   cor: COR_SAIDA },
            ]}
          />
        </ChartCard>
      </section>

      <section className="space-y-4">
        <SectionTitle>BarChart — empilhado por stackId (o gráfico de /fluxo)</SectionTitle>
        <ChartCard>
          <BarChart
            data={SEMANAS_PROJETADAS}
            x="label"
            ocultarZerosNoTooltip
            series={[
              { key: 'inflowReal',       label: 'Entradas',         cor: COR_ENTRADA,           stackId: 'in' },
              { key: 'inflowProjetado',  label: 'Entradas (proj.)', cor: COR_ENTRADA_PROJETADA, stackId: 'in' },
              { key: 'outflowReal',      label: 'Saídas',           cor: COR_SAIDA,             stackId: 'out' },
              { key: 'outflowProjetado', label: 'Saídas (proj.)',   cor: COR_SAIDA_PROJETADA,   stackId: 'out' },
            ]}
          />
          <p className="text-xs text-muted-foreground/70 mt-2 text-center">
            Cores escuras = histórico real · cores claras = projeção
          </p>
        </ChartCard>
      </section>

      {/* LINHA */}
      <section className="space-y-4">
        <SectionTitle>LineChart — evolução no tempo</SectionTitle>
        <ChartCard>
          <LineChart
            data={MESES}
            x="mes"
            legenda
            series={[
              { key: 'receita',  label: 'Receita' },
              { key: 'despesas', label: 'Despesas' },
            ]}
          />
        </ChartCard>
      </section>

      {/* ÁREA */}
      <section className="space-y-4">
        <SectionTitle>AreaChart — volume no tempo</SectionTitle>
        <ChartCard>
          <AreaChart
            data={MESES}
            x="mes"
            legenda
            series={[
              { key: 'receita',  label: 'Receita' },
              { key: 'despesas', label: 'Despesas' },
            ]}
          />
        </ChartCard>
      </section>

      {/* COMBINADO */}
      <section className="space-y-4">
        <SectionTitle>ComposedChart — realizado em barra + orçado em linha</SectionTitle>
        <ChartCard>
          <ComposedChart
            data={MESES}
            x="mes"
            legenda
            series={[
              { key: 'receita', label: 'Realizado', visual: 'barra', cor: COR_ENTRADA },
              { key: 'orcado',  label: 'Orçado',    visual: 'linha' },
            ]}
          />
        </ChartCard>
      </section>

      {/* PIZZA E ROSCA */}
      <section className="space-y-4">
        <SectionTitle>PieChart — composição (pizza e rosca)</SectionTitle>
        <div className="grid md:grid-cols-2 gap-4">
          <ChartCard titulo="Pizza">
            <PieChart data={COMPOSICAO} />
          </ChartCard>
          <ChartCard titulo="Rosca (padrão do bloco composição)">
            <PieChart data={COMPOSICAO} rosca />
          </ChartCard>
        </div>
      </section>

      {/* RANKING */}
      <section className="space-y-4">
        <SectionTitle>HorizontalBarChart — ranking (o &quot;top 5 UENs&quot;)</SectionTitle>
        <div className="grid md:grid-cols-2 gap-4">
          <ChartCard titulo="Uma medida, uma cor">
            <HorizontalBarChart data={RANKING} />
          </ChartCard>
          <ChartCard titulo="Barra = categoria, cores da paleta">
            <HorizontalBarChart data={RANKING} coresCategoricas />
          </ChartCard>
        </div>
      </section>

      <footer className="border-t border-border pt-6 text-xs text-muted-foreground">
        Fase 5.A · Biblioteca de gráficos · Paleta documentada em <code>docs/DESIGN_TOKENS.md</code>.
      </footer>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold text-foreground border-b border-border pb-2">
      {children}
    </h2>
  )
}

function ChartCard({ titulo, children }: { titulo?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      {titulo && <p className="text-sm font-medium text-foreground mb-3">{titulo}</p>}
      {children}
    </div>
  )
}
