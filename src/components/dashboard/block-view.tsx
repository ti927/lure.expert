'use client'

// Desenha UM bloco a partir do resultado que o servidor executou.
//
// A regra que organiza o arquivo: cada `tipo` do `block-spec` tem exatamente um
// ramo aqui, e nenhum ramo consulta nada — o dado chega pronto. É o que permite
// o mesmo componente servir o painel virtual, o gravado e a prévia do MCP.

import { KPICard } from '@/components/financial/kpi-card'
import { EmptyState } from '@/components/states/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart } from '@/components/charts/bar-chart'
import { LineChart } from '@/components/charts/line-chart'
import { AreaChart } from '@/components/charts/area-chart'
import { PieChart } from '@/components/charts/pie-chart'
import { HorizontalBarChart } from '@/components/charts/horizontal-bar'
import { COR_ENTRADA, COR_SAIDA, corCategorica } from '@/components/charts/chart-theme'
import { BarChart2, PieChart as PieIcon, AlertTriangle } from 'lucide-react'
import type { QueryResult } from '@/lib/query/spec'
import type { BlocoRenderizado } from '@/server/dashboards'
import { AlertsSection } from './alerts-section'
import { CATALOGO_DE_INDICADORES, IndicatorItem } from './indicator-item'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Rótulo curto para o eixo: 'YYYY-MM-DD' vira 'd/MM', 'YYYY-MM' vira 'mmm/yy'. */
function rotuloDoEixo(chave: string, rotulo: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(chave)) {
    const [, m, d] = chave.split('-')
    return `${Number(d)}/${m}`
  }
  if (/^\d{4}-\d{2}$/.test(chave)) {
    const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
    const [a, m] = chave.split('-')
    return `${meses[Number(m) - 1]}/${a.slice(2)}`
  }
  return rotulo
}

/**
 * Resultado do motor → linhas de gráfico.
 *
 * Com UM agrupamento, cada medida vira uma série. Com DOIS, o primeiro vira o
 * eixo e o segundo abre uma série por valor distinto — que é como "receita por
 * mês, por unidade de negócio" fica legível.
 */
function paraGrafico(r: QueryResult) {
  const [medida] = r.medidas
  if (r.agruparPor.length <= 1) {
    const data = r.linhas.map(l => ({
      x: l.chaves[0] ? rotuloDoEixo(l.chaves[0].id ?? '', l.chaves[0].rotulo) : '',
      ...Object.fromEntries(r.medidas.map(m => [m, l.medidas[m]])),
    }))
    return {
      data,
      series: r.medidas.map(m => ({
        key: m,
        label: m === 'entradas' ? 'Entradas' : m === 'saidas' ? 'Saídas' : rotuloDeMedida(m),
        cor: m === 'entradas' ? COR_ENTRADA : m === 'saidas' ? COR_SAIDA : undefined,
      })),
    }
  }

  const eixos: string[] = []
  const series = new Map<string, string>()
  const porEixo = new Map<string, Record<string, number>>()
  for (const l of r.linhas) {
    const x = rotuloDoEixo(l.chaves[0].id ?? '', l.chaves[0].rotulo)
    const s = l.chaves[1].rotulo
    if (!porEixo.has(x)) { porEixo.set(x, {}); eixos.push(x) }
    series.set(s, s)
    porEixo.get(x)![s] = (porEixo.get(x)![s] ?? 0) + l.medidas[medida]
  }
  return {
    data: eixos.map(x => ({ x, ...porEixo.get(x) })),
    series: Array.from(series.keys()).map((s, i) => ({ key: s, label: s, cor: corCategorica(i) })),
  }
}

function rotuloDeMedida(m: string): string {
  const mapa: Record<string, string> = {
    valor_liquido: 'Valor líquido', entradas: 'Entradas', saidas: 'Saídas',
    valor_absoluto: 'Movimentação', contagem: 'Lançamentos', ticket_medio: 'Ticket médio',
  }
  return mapa[m] ?? m
}

function Moldura({ titulo, children }: { titulo: string | null; children: React.ReactNode }) {
  return (
    <Card>
      {titulo && (
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">{titulo}</CardTitle>
        </CardHeader>
      )}
      <CardContent className={titulo ? undefined : 'pt-6'}>{children}</CardContent>
    </Card>
  )
}

export interface BlockViewProps {
  bloco: BlocoRenderizado
  /** Alertas: dismiss por mês, herança da Fase 6. */
  dismissedIds?: string[]
  onDismissAlert?: (id: string) => void
  /** Ranking agrupado por natureza: clicar abre o drill-down. */
  onDrill?: (categoriaId: string, rotulo: string) => void
}

export function BlockView({ bloco, dismissedIds = [], onDismissAlert, onDrill }: BlockViewProps) {
  if (bloco.erro || !bloco.dados) {
    return (
      <Card className="border-amber-200 dark:border-amber-900/50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 flex-shrink-0" strokeWidth={1.75} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {bloco.titulo ?? 'Bloco com problema'}
              </p>
              <p className="text-xs text-muted-foreground mt-1 break-words">{bloco.erro}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const d = bloco.dados

  switch (d.tipo) {
    case 'kpi':
      return (
        <KPICard
          label={bloco.titulo ?? ''}
          value={d.valor}
          valueType={d.formato === 'moeda' ? 'currency' : d.formato === 'inteiro' ? 'number' : 'percentage'}
          colorizeValue={d.formato === 'moeda' && !d.menorEhMelhor}
          // Em KPI onde subir é ruim (Despesas), a seta inverte: crescer 20%
          // aparece em vermelho. É a herança do `delta={-delta}` da tela antiga.
          delta={d.deltaPct !== null ? (d.menorEhMelhor ? -d.deltaPct : d.deltaPct) : undefined}
        />
      )

    case 'texto':
      return (
        <Moldura titulo={bloco.titulo}>
          <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{d.markdown}</p>
        </Moldura>
      )

    case 'alertas':
      return (
        <AlertsSection
          alerts={d.alertas}
          dismissedIds={dismissedIds}
          onDismiss={onDismissAlert ?? (() => {})}
        />
      )

    case 'indicador': {
      const escolhidos = d.selecionados
        .map(id => ({ id, desc: CATALOGO_DE_INDICADORES[id] }))
        .filter(x => !!x.desc)
      const todosNulos = escolhidos.every(x => x.desc.valor(d.indicadores) === null)
      return (
        <Moldura titulo={bloco.titulo ?? 'Indicadores Financeiros'}>
          {todosNulos ? (
            <p className="text-sm text-muted-foreground py-2">
              Sem dados suficientes para calcular indicadores. Classifique as transações do mês.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {escolhidos.map(({ id, desc }) => (
                <IndicatorItem
                  key={id}
                  icon={desc.icon}
                  label={desc.label}
                  value={desc.valor(d.indicadores)}
                  format={desc.format}
                  status={desc.status(d.indicadores)}
                  hint={desc.hint(d.indicadores)}
                  explanation={desc.explanation}
                />
              ))}
            </div>
          )}
        </Moldura>
      )
    }

    case 'serie': {
      const { data, series } = paraGrafico(d.resultado)
      return (
        <Moldura titulo={bloco.titulo}>
          {data.length === 0 ? (
            <EmptyState
              icon={<BarChart2 className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
              title="Sem movimentações no período"
              description="Os valores aparecerão aqui assim que houver lançamentos confirmados."
            />
          ) : d.visual === 'linha' ? (
            <LineChart data={data} x="x" series={series} legenda />
          ) : d.visual === 'area' ? (
            <AreaChart data={data} x="x" series={series} legenda />
          ) : (
            <BarChart
              data={data}
              x="x"
              series={series}
              legenda
              empilhado={d.visual === 'barra_empilhada'}
            />
          )}
        </Moldura>
      )
    }

    case 'composicao': {
      const [medida] = d.resultado.medidas
      const fatias = d.resultado.linhas.map(l => ({ nome: l.chaves[0]?.rotulo ?? '—', valor: Math.abs(l.medidas[medida]) }))
      return (
        <Moldura titulo={bloco.titulo}>
          {fatias.length === 0 ? (
            <EmptyState
              icon={<PieIcon className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
              title="Sem dados no período"
              description="Classifique as transações para ver a composição aqui."
            />
          ) : d.visual === 'barra_horizontal' ? (
            <HorizontalBarChart data={fatias} coresCategoricas />
          ) : (
            <PieChart data={fatias} rosca={d.visual === 'rosca'} />
          )}
        </Moldura>
      )
    }

    case 'ranking': {
      const [medida] = d.resultado.medidas
      const itens = d.resultado.linhas.map(l => ({
        id: l.chaves[0]?.id ?? null,
        nome: l.chaves[0]?.rotulo ?? '—',
        valor: Math.abs(l.medidas[medida]),
      }))
      const total = itens.reduce((s, i) => s + i.valor, 0)
      const maior = itens.length > 0 ? Math.max(...itens.map(i => i.valor)) : 0
      // Drill-down só quando o ranking é por natureza — a leitura de detalhe
      // filtra por categoria. Por outra dimensão, ele chega na v1.1.
      const porCategoria = d.resultado.agruparPor[0] === 'categoria'

      return (
        <Moldura titulo={bloco.titulo}>
          {itens.length === 0 ? (
            <EmptyState
              icon={<PieIcon className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
              title="Sem dados no período"
              description="Classifique as transações para ver o ranking aqui."
            />
          ) : d.visual === 'barra_horizontal' ? (
            <HorizontalBarChart data={itens} coresCategoricas />
          ) : (
            <div className="space-y-2">
              {itens.map(item => {
                const pctTotal = total > 0 ? (item.valor / total) * 100 : 0
                const barra = maior > 0 ? (item.valor / maior) * 100 : 0
                const clicavel = porCategoria && !!item.id && !!onDrill
                const conteudo = (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground/90 truncate">{item.nome}</div>
                    </div>
                    <div className="flex-1 max-w-[40%] h-2 rounded-full bg-muted overflow-hidden shrink-0">
                      <div
                        className="h-full bg-rose-500 group-hover:bg-rose-600 transition-colors rounded-full"
                        style={{ width: `${barra}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-foreground w-28 text-right shrink-0">
                      {brl.format(item.valor)}
                    </span>
                    {d.mostrarPercentual && (
                      <span className="text-xs tabular-nums text-muted-foreground w-12 text-right shrink-0">
                        {pctTotal.toFixed(0)}%
                      </span>
                    )}
                  </>
                )
                return clicavel ? (
                  <button
                    key={item.id ?? item.nome}
                    onClick={() => onDrill!(item.id!, item.nome)}
                    className="w-full group flex items-center gap-3 py-1.5 px-2 -mx-2 rounded hover:bg-muted/40 transition-colors text-left"
                  >
                    {conteudo}
                  </button>
                ) : (
                  <div key={item.id ?? item.nome} className="w-full group flex items-center gap-3 py-1.5 px-2 -mx-2">
                    {conteudo}
                  </div>
                )
              })}
              {d.mostrarPercentual && (
                <p className="text-xs text-muted-foreground/70 pt-2 border-t border-border/40">
                  Percentual relativo ao total das {itens.length} linhas listadas.
                  {porCategoria && onDrill ? ' Clique numa linha para ver os lançamentos.' : ''}
                </p>
              )}
            </div>
          )}
        </Moldura>
      )
    }
  }
}
