// Análise de fornecedores — o que é puro e vai ao navegador: tipos, a curva ABC,
// o cálculo da mesa de negociação e os Zod de entrada. Sem `@/db` (o miolo que lê
// o banco mora em `fornecedores.ts`), pelo mesmo motivo de `budget-types.ts`.
// Ver Decisão 33.

import { z } from 'zod'
import { normalizarDescricao } from '@/lib/descricao-normalizada'

/** Uma saída do período, já com o fornecedor consolidado. Rateio desconsiderado: valor inteiro. */
export interface LancamentoFornecedor {
  id: string
  data: string          // YYYY-MM-DD (competência)
  mes: string           // YYYY-MM
  /** 'Despesas' entra na curva; os outros grupos ficam "fora da curva". */
  grupo: string
  chave: string         // 'C:<contato>' | 'G:<agrupamento>' | 'J:<cnpj>' | 'D:<descrição normalizada>'
  fornecedor: string
  identificacao: string
  valor: number
  naturezaPai: string
  natureza: string
  rateado: boolean
  conta: string
  descricao: string
}

/** Os cortes da curva ABC, decididos por Julio em 24/nov: 70 / 20 / 10. */
export const CORTE_A = 0.7
export const CORTE_B = 0.9
export type Classe = 'A' | 'B' | 'C'

/**
 * A classe é decidida pelo acumulado ANTES do item: o fornecedor que atravessa os
 * 70% ainda é A. Assim a classe A nunca fica vazia e o primeiro item é sempre A.
 */
export function classeAbc(acumuladoAntes: number): Classe {
  return acumuladoAntes < CORTE_A ? 'A' : acumuladoAntes < CORTE_B ? 'B' : 'C'
}

export interface LinhaAbc {
  rank: number
  chave: string
  fornecedor: string
  classe: Classe
  valor: number
  pct: number
  pctAcumulado: number
  lancamentos: number
  porMes: Record<string, number>
  naturezaPrincipal: string
}

/** A curva por fornecedor sobre as linhas de Despesas recebidas. */
export function curvaAbc(lancs: LancamentoFornecedor[]): LinhaAbc[] {
  const m = new Map<string, { chave: string; fornecedor: string; valor: number; n: number; porMes: Record<string, number>; nat: Map<string, number> }>()
  let total = 0
  for (const l of lancs) {
    const e = m.get(l.chave) ?? { chave: l.chave, fornecedor: l.fornecedor, valor: 0, n: 0, porMes: {} as Record<string, number>, nat: new Map<string, number>() }
    e.valor += l.valor; e.n++; total += l.valor
    e.porMes[l.mes] = (e.porMes[l.mes] ?? 0) + l.valor
    const nk = `${l.naturezaPai} › ${l.natureza}`
    e.nat.set(nk, (e.nat.get(nk) ?? 0) + l.valor)
    m.set(l.chave, e)
  }
  let acc = 0
  return Array.from(m.values()).sort((a, b) => b.valor - a.valor || a.fornecedor.localeCompare(b.fornecedor)).map((e, i) => {
    const antes = total ? acc / total : 0
    acc += e.valor
    return {
      rank: i + 1, chave: e.chave, fornecedor: e.fornecedor, classe: classeAbc(antes),
      valor: e.valor, pct: total ? e.valor / total : 0, pctAcumulado: total ? acc / total : 0,
      lancamentos: e.n, porMes: e.porMes,
      naturezaPrincipal: Array.from(e.nat).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
    }
  })
}

// ── a mesa ────────────────────────────────────────────────────────────────────

export interface ItemMesa {
  chave: string
  rotulo: string
  tipo: 'pct' | 'valor'
  reducao: number
  nota: string
  updatedAt: string
}

/**
 * Os meses-base do "antes": os 3 últimos meses COMPLETOS até o fim do período. O
 * mês de `ate` só conta se `ate` for o último dia dele E ele já tiver acabado
 * (`hoje` depois dele). Comparar um mês pela metade com meses inteiros é o falso
 * positivo que o relatório de 26/ago (R5) achou no dashboard.
 */
export function mesesBase(ate: string, hoje: string, n = 3): string[] {
  const [a, m, d] = ate.split('-').map(Number)
  const ultimoDia = new Date(Date.UTC(a, m, 0)).getUTCDate()
  const completo = d === ultimoDia && hoje.slice(0, 7) > ate.slice(0, 7)
  let ano = a, mes = completo ? m : m - 1
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    if (mes < 1) { mes += 12; ano-- }
    out.unshift(`${ano}-${String(mes).padStart(2, '0')}`)
    mes--
  }
  return out
}

/** A média mensal de um fornecedor sobre os meses-base (mês sem gasto conta como zero). */
export function mediaMensal(porMes: Record<string, number>, base: string[]): number {
  if (!base.length) return 0
  return base.reduce((s, m) => s + (porMes[m] ?? 0), 0) / base.length
}

/** O "depois" de uma negociação. Em R$, a redução não passa do próprio gasto. */
export function aplicarReducao(antes: number, tipo: 'pct' | 'valor', reducao: number) {
  const r = Math.max(0, Number(reducao) || 0)
  const economia = tipo === 'valor' ? Math.min(r, antes) : antes * Math.min(r, 100) / 100
  return { depois: antes - economia, economiaMensal: economia, economiaAnual: economia * 12 }
}

// ── entradas ──────────────────────────────────────────────────────────────────

export const itemMesaSchema = z.object({
  chave: z.string().trim().min(3).max(300),
  rotulo: z.string().trim().min(1).max(300),
  tipo: z.enum(['pct', 'valor']).default('pct'),
  reducao: z.number().min(0).max(1e12).default(0),
  nota: z.string().max(1000).default(''),
}).refine((v) => v.tipo !== 'pct' || v.reducao <= 100, { message: 'Redução em % vai de 0 a 100.', path: ['reducao'] })
export type ItemMesaInput = z.input<typeof itemMesaSchema>

export const agrupamentoSchema = z.object({
  nome: z.string().trim().min(1, 'Dê um nome ao agrupamento.').max(120),
  padrao: z.string().max(200).transform((s) => normalizarDescricao(s) ?? '')
    .refine((s) => s.length >= 3, 'O trecho precisa ter ao menos 3 letras.'),
  naturezaPaiId: z.string().uuid().nullable().default(null),
  contactId: z.string().uuid().nullable().default(null),
  sobrepoeContato: z.boolean().default(false),
  isActive: z.boolean().default(true),
})
export type AgrupamentoInput = z.input<typeof agrupamentoSchema>

export interface Agrupamento {
  id: string
  nome: string
  padrao: string
  naturezaPaiId: string | null
  contactId: string | null
  /** Casa mesmo quando o lançamento já tem contato. */
  sobrepoeContato: boolean
  ordem: number
  isActive: boolean
}
