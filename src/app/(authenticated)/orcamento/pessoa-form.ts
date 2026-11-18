// O estado do formulário da pessoa e a conversão para a entrada do
// `pessoaSchema`. Puro (sem React, sem servidor) — exercitável por script.

import { parseAmount } from '@/lib/format'
import type {
  Componente, ParametrosUJ, PessoaInput, Regime, Vinculo,
} from '@/lib/payroll-types'
import type { PessoaDoQuadro } from '@/lib/payroll-write'
import type { LegalEntity } from '@/db/schema/legal-entities'
import { COMPONENTES_DO_VINCULO, numParaCampo } from './folha-format'

export type AlocacaoForm = { key: string; costCenterId: string | null; businessUnitId: string | null; percentual: string }
export type BeneficioForm = { key: string; nome: string; valor: string; categoryId: string | null }

let seq = 0
export const novaChave = () => `l${++seq}`

export type Form = {
  vinculo: Vinculo
  isVaga: boolean
  nome: string
  cargo: string
  legalEntityId: string | null
  contactId: string | null
  valorBase: string
  outrosProventos: string
  mesEntrada: string
  mesSaida: string
  mesesPj: number[]
  mesFerias: string
  diaPagamentoPj: string
  aplicaDissidio: boolean
  reajusteMes: string
  reajustePct: string
  naturezas: Partial<Record<Componente, string>>
  observacao: string
  alocacoes: AlocacaoForm[]
  beneficios: BeneficioForm[]
}

export const TODOS_OS_MESES = Array.from({ length: 12 }, (_, i) => i + 1)

export function formVazio(): Form {
  return {
    vinculo: 'clt', isVaga: false, nome: '', cargo: '', legalEntityId: null, contactId: null,
    valorBase: '', outrosProventos: '', mesEntrada: '', mesSaida: '12', mesesPj: TODOS_OS_MESES,
    mesFerias: '', diaPagamentoPj: '10', aplicaDissidio: true, reajusteMes: '', reajustePct: '',
    naturezas: {}, observacao: '', alocacoes: [], beneficios: [],
  }
}

export function formDaPessoa(p: PessoaDoQuadro): Form {
  const mesesPj = p.mesesPj ?? TODOS_OS_MESES.filter(m => m >= p.mesEntrada && m <= p.mesSaida)
  return {
    vinculo: p.vinculo,
    isVaga: p.isVaga,
    nome: p.nome ?? '',
    cargo: p.cargo ?? '',
    legalEntityId: p.legalEntityId,
    contactId: p.contactId,
    valorBase: numParaCampo(p.valorBase),
    outrosProventos: p.outrosProventos ? numParaCampo(p.outrosProventos) : '',
    // Janeiro é o padrão: mostrar vazio evita "cravar" janeiro numa pessoa que nunca o escolheu.
    mesEntrada: p.mesEntrada === 1 && !p.isVaga ? '' : String(p.mesEntrada),
    mesSaida: String(p.mesSaida),
    mesesPj,
    mesFerias: p.mesFerias ? String(p.mesFerias) : '',
    diaPagamentoPj: String(p.diaPagamentoPj),
    aplicaDissidio: p.aplicaDissidio,
    reajusteMes: p.reajusteMes ? String(p.reajusteMes) : '',
    reajustePct: numParaCampo(p.reajustePct),
    naturezas: { ...p.naturezas },
    observacao: p.observacao ?? '',
    alocacoes: p.alocacoes.map(a => ({ key: novaChave(), ...a, percentual: numParaCampo(a.percentual) })),
    beneficios: p.beneficios.map(b => ({
      key: novaChave(), nome: b.nome, valor: numParaCampo(b.valorMensal), categoryId: b.categoryId,
    })),
  }
}

const mesOuNull = (s: string) => (s === '' ? null : Number(s))

/** Texto do formulário → a entrada do `pessoaSchema` (pontos percentuais, reais). */
export function montarEntrada(f: Form): PessoaInput {
  const ehPj = f.vinculo === 'pj'
  const ehClt = f.vinculo === 'clt'
  const mesesPj = [...f.mesesPj].sort((a, b) => a - b)
  const componentes = new Set(COMPONENTES_DO_VINCULO[f.vinculo])
  return {
    vinculo: f.vinculo,
    isVaga: f.isVaga,
    nome: f.isVaga ? null : f.nome.trim() || null,
    cargo: f.cargo.trim() || null,
    legalEntityId: f.legalEntityId,
    contactId: f.contactId,
    valorBase: parseAmount(f.valorBase) ?? 0,
    outrosProventos: ehClt ? parseAmount(f.outrosProventos) ?? 0 : 0,
    // PJ: o período é a lista de meses; entrada e saída a cercam.
    mesEntrada: ehPj ? mesesPj[0] : f.mesEntrada === '' ? undefined : Number(f.mesEntrada),
    mesSaida: ehPj ? mesesPj[mesesPj.length - 1] ?? 12 : Number(f.mesSaida),
    mesesPj: ehPj ? (mesesPj.length === 12 ? null : mesesPj) : null,
    mesFerias: ehClt ? mesOuNull(f.mesFerias) : null,
    diaPagamentoPj: ehPj ? Number(f.diaPagamentoPj) || 0 : 10,
    aplicaDissidio: ehClt ? f.aplicaDissidio : true,
    reajusteMes: ehClt ? null : mesOuNull(f.reajusteMes),
    reajustePct: ehClt || f.reajusteMes === '' ? null : parseAmount(f.reajustePct),
    naturezas: Object.fromEntries(
      Object.entries(f.naturezas).filter(([c, id]) => id && componentes.has(c as Componente)),
    ),
    observacao: f.observacao.trim() || null,
    alocacoes: f.alocacoes.map(a => ({
      costCenterId: a.costCenterId, businessUnitId: a.businessUnitId, percentual: parseAmount(a.percentual) ?? 0,
    })),
    beneficios: f.beneficios.map(b => ({ nome: b.nome, valorMensal: parseAmount(b.valor) ?? 0, categoryId: b.categoryId })),
  }
}

/** A unidade jurídica como o cálculo a lê (frações). */
export function ujParaCalculo(le: LegalEntity | undefined): ParametrosUJ | null {
  if (!le) return null
  return {
    regime: (le.regimeTributario as Regime | null) ?? null,
    anexoIV: le.simplesAnexoIv,
    inss: Number(le.aliquotaInssPatronal),
    ratFap: Number(le.aliquotaRatFap),
    terceiros: Number(le.aliquotaTerceiros),
    fgts: Number(le.aliquotaFgts),
  }
}
