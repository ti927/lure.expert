'use client'

// Uma linha de indicador, com o popover de fórmula/interpretação — extraída de
// `dashboard-client.tsx` na 5.C, junto com o CATÁLOGO dos 7 indicadores
// (rótulo, ícone, formato, limiares e explicação). O catálogo estava espalhado
// em 7 blocos de JSX; como dado, o bloco `indicador` pode escolher quais
// mostrar, que é o que o `block-spec` promete.

import { HelpCircle, TrendingUp, Droplets, ShieldCheck, Activity, Scale, Clock, Wallet } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  indicatorStatus, indicatorStatusInverse, type IndicatorStatus,
} from '@/lib/dashboard/alerts'
import type { FinancialIndicators } from '@/lib/dashboard/indicators'

const statusColor: Record<IndicatorStatus, string> = {
  good:    'bg-emerald-500',
  warn:    'bg-amber-500',
  bad:     'bg-rose-600',
  neutral: 'bg-muted-foreground/40',
}

const statusText: Record<IndicatorStatus, string> = {
  good:    'text-emerald-700 dark:text-emerald-400',
  warn:    'text-amber-600 dark:text-amber-400',
  bad:     'text-rose-600',
  neutral: 'text-muted-foreground',
}

interface IndicatorExplanation {
  formula:        string
  description:    string
  interpretation: string
}

export function IndicatorItem({
  icon, label, value, format: fmt, status, hint, explanation,
}: {
  icon:         React.ReactNode
  label:        string
  value:        number | null
  format:       (v: number) => string
  status:       IndicatorStatus
  hint:         string
  explanation?: IndicatorExplanation
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          {explanation && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`Como é calculado: ${label}`}
                  className="text-muted-foreground/60 hover:text-muted-foreground transition-colors focus:outline-none focus-visible:text-muted-foreground"
                >
                  <HelpCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 text-sm">
                <p className="font-semibold text-foreground mb-2">{label}</p>
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1">Fórmula</p>
                    <p className="rounded bg-muted/40 px-2 py-1.5 font-mono text-xs text-foreground">{explanation.formula}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1">O que é</p>
                    <p className="text-xs text-foreground/80 leading-relaxed">{explanation.description}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1">Como interpretar</p>
                    <p className="text-xs text-foreground/80 leading-relaxed">{explanation.interpretation}</p>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <p className={`text-lg font-semibold tabular-nums leading-tight ${statusText[status]}`}>
          {value !== null ? fmt(value) : '—'}
        </p>
        <p className="text-xs text-muted-foreground/70 mt-0.5">{hint}</p>
      </div>
      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${statusColor[status]}`} />
    </div>
  )
}

// ─── O catálogo dos 7 ────────────────────────────────────────────────────────

const um = (v: number) => `${v.toFixed(1)}%`
const vezes = (v: number) => `${v.toFixed(2)}x`

export interface DescritorDeIndicador {
  icon: React.ReactNode
  label: string
  valor: (i: FinancialIndicators) => number | null
  format: (v: number) => string
  status: (i: FinancialIndicators) => IndicatorStatus
  hint: (i: FinancialIndicators) => string
  explanation: IndicatorExplanation
}

export const CATALOGO_DE_INDICADORES: Record<string, DescritorDeIndicador> = {
  margemEbitda: {
    icon: <TrendingUp className="h-4 w-4" strokeWidth={1.5} />,
    label: 'Margem EBITDA',
    valor: i => i.margemEbitda,
    format: um,
    status: i => indicatorStatus(i.margemEbitda, 15, 5),
    hint: () => 'Referência saudável: acima de 15%',
    explanation: {
      formula:        'EBITDA ÷ Receita Bruta × 100',
      description:    'Quanto da receita sobra após as despesas operacionais, antes de juros, impostos, depreciação e amortização.',
      interpretation: 'Acima de 15% é considerado saudável. Abaixo de 5% indica margem muito apertada.',
    },
  },
  liquidezCorrente: {
    icon: <Droplets className="h-4 w-4" strokeWidth={1.5} />,
    label: 'Liquidez Corrente',
    valor: i => i.liquidezCorrente,
    format: vezes,
    status: i => indicatorStatus(i.liquidezCorrente, 1.5, 1.0),
    hint: i => i.liquidezCorrente === null ? 'Requer lançamentos de Balanço Patrimonial' : 'Referência saudável: acima de 1,5x',
    explanation: {
      formula:        'Ativo Circulante ÷ Passivo Circulante',
      description:    'Quantas vezes os ativos de curto prazo cobrem as dívidas de curto prazo.',
      interpretation: 'Acima de 1,5x indica folga. Abaixo de 1,0x pode haver dificuldade para honrar compromissos imediatos.',
    },
  },
  liquidezSeca: {
    icon: <Activity className="h-4 w-4" strokeWidth={1.5} />,
    label: 'Liquidez Seca',
    valor: i => i.liquidezSeca,
    format: vezes,
    status: i => indicatorStatus(i.liquidezSeca, 1.0, 0.7),
    hint: i => i.liquidezSeca === null ? 'Requer Balanço Patrimonial' : 'Ativo Circulante menos estoque ÷ Passivo Circulante. Referência: acima de 1,0x',
    explanation: {
      formula:        '(Ativo Circulante − Estoque) ÷ Passivo Circulante',
      description:    "Versão conservadora da Liquidez Corrente — exclui estoque, que nem sempre vira caixa rapidamente. Estoque é identificado por categorias com 'estoque' no nome.",
      interpretation: 'Acima de 1,0x indica que, mesmo sem vender estoque, a empresa cobre o passivo de curto prazo.',
    },
  },
  endividamentoGeral: {
    icon: <Scale className="h-4 w-4" strokeWidth={1.5} />,
    label: 'Endividamento Geral',
    // O valor é proporção 0..1 e a tela mostra percentual.
    valor: i => i.endividamentoGeral !== null ? i.endividamentoGeral * 100 : null,
    format: um,
    status: i => indicatorStatusInverse(i.endividamentoGeral, 0.5, 0.7),
    hint: i => i.endividamentoGeral === null ? 'Requer Balanço Patrimonial' : 'Passivo total ÷ Ativo total. Referência: abaixo de 50%',
    explanation: {
      formula:        '(Passivo Circ. + Passivo Não-Circ.) ÷ (Ativo Circ. + Ativo Não-Circ.) × 100',
      description:    'Fatia da empresa financiada por capital de terceiros.',
      interpretation: 'Abaixo de 50% é conservador. Acima de 70% indica alavancagem alta.',
    },
  },
  coberturaServicoDivida: {
    icon: <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />,
    label: 'Cobertura do Serviço da Dívida',
    valor: i => i.coberturaServicoDivida,
    format: vezes,
    status: i => indicatorStatus(i.coberturaServicoDivida, 1.5, 1.0),
    hint: i => i.coberturaServicoDivida === null ? 'Sem amortizações no mês' : 'Referência saudável: acima de 1,5x',
    explanation: {
      formula:        'EBITDA do mês ÷ Pagamentos de Empréstimos no mês',
      description:    "Mede se o resultado operacional do mês cobre os pagamentos de principal e juros. Considera saídas classificadas em 'Empréstimos e Amortizações'.",
      interpretation: 'Acima de 1,5x é confortável. Abaixo de 1,0x o operacional não cobre o serviço da dívida.',
    },
  },
  roe: {
    icon: <Wallet className="h-4 w-4" strokeWidth={1.5} />,
    label: 'ROE — Retorno sobre Patrimônio',
    valor: i => i.roe,
    format: v => `${v.toFixed(1)}% a.a.`,
    status: i => indicatorStatus(i.roe, 15, 8),
    hint: i =>
      i.roe === null
        ? 'Requer Balanço Patrimonial com Patrimônio Líquido positivo'
        : i.meses12mDisponiveis < 12
          ? `Anualizado a partir de ${i.meses12mDisponiveis} ${i.meses12mDisponiveis === 1 ? 'mês' : 'meses'} de dados. Referência: acima de 15% a.a.`
          : 'Lucro 12m ÷ Patrimônio Líquido. Referência: acima de 15% a.a.',
    explanation: {
      formula:        'Lucro Líquido (12m anualizado) ÷ Patrimônio Líquido × 100',
      description:    'Rentabilidade do capital próprio. Lucro dos últimos 12 meses anualizado proporcionalmente quando há menos de 12 meses de dados. Patrimônio Líquido vem de lançamentos diretos ou, na ausência, da identidade Ativo − Passivo.',
      interpretation: 'Acima de 15% ao ano é bom. Abaixo de 8% sugere baixa rentabilidade do capital investido.',
    },
  },
  cicloFinanceiro: {
    icon: <Clock className="h-4 w-4" strokeWidth={1.5} />,
    label: 'Ciclo Financeiro',
    valor: i => i.cicloFinanceiro,
    format: v => `${v.toFixed(0)} dias`,
    status: () => 'neutral',
    hint: () => 'Requer estrutura de Contas a Receber e Contas a Pagar (Fase futura)',
    explanation: {
      formula:        'PMR + PME − PMP (em dias)',
      description:    'Soma dos prazos médios de recebimento (PMR) e estoque (PME), menos o prazo médio de pagamento (PMP). Mede quantos dias o caixa fica preso entre comprar e receber.',
      interpretation: 'Quanto menor, melhor. Indicador será habilitado quando o produto suportar Contas a Receber e a Pagar estruturados.',
    },
  },
}
