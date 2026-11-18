// Constantes, tipos e schemas Zod da folha de pagamento no orçamento —
// importáveis por client e server components (sem 'use server', sem `@/db`).
//
// ─── Duas unidades de percentual, e a fronteira entre elas ───────────────────
//
// ENTRADA (Zod, tela, MCP): PONTOS percentuais — 5 = 5%, 60 = 60% de alocação.
//         Ninguém digita "0,05 por cento".
// CÁLCULO e BANCO:          FRAÇÃO — 0.05 = 5% (alíquotas, dissídio, reajuste).
//         A exceção é `alocacoes[].percentual`, que é 0–100 nos dois lados,
//         como `budget_people_allocations.percentual`.
//
// A conversão mora em `paraPessoaCalc`, `paraParametrosVersaoCalc` e
// `paraParametrosUJ` — um lugar só, para nenhuma tarefa reinventá-la.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod'

// ─── Vocabulário ─────────────────────────────────────────────────────────────

export const VINCULOS = ['clt', 'pj', 'pro_labore', 'estagio'] as const
export type Vinculo = (typeof VINCULOS)[number]

export const VINCULO_LABELS: Record<Vinculo, string> = {
  clt: 'CLT',
  pj: 'PJ',
  pro_labore: 'Pró-labore',
  estagio: 'Estágio',
}

export const REGIMES = ['lucro_real', 'lucro_presumido', 'simples'] as const
export type Regime = (typeof REGIMES)[number]

export const REGIME_LABELS: Record<Regime, string> = {
  lucro_real: 'Lucro Real',
  lucro_presumido: 'Lucro Presumido',
  simples: 'Simples Nacional',
}

export const MODOS_PROVISAO = ['provisao', 'pagamento'] as const
export type ModoProvisao = (typeof MODOS_PROVISAO)[number]

export const COMPONENTES = [
  'salario', 'outros_proventos', 'inss_patronal', 'fgts', 'decimo_terceiro',
  'terco_ferias', 'encargos_13_ferias', 'pro_labore', 'inss_pro_labore', 'bolsa_estagio',
  'honorario_pj', 'beneficios',
] as const
export type Componente = (typeof COMPONENTES)[number]

export const ROTULO_COMPONENTE: Record<Componente, string> = {
  salario: 'Salário',
  outros_proventos: 'Outros proventos',
  inss_patronal: 'INSS patronal + RAT + terceiros',
  fgts: 'FGTS',
  decimo_terceiro: '13º salário',
  terco_ferias: '1/3 de férias',
  encargos_13_ferias: 'Encargos sobre 13º e férias',
  pro_labore: 'Pró-labore',
  inss_pro_labore: 'INSS sobre pró-labore',
  bolsa_estagio: 'Bolsa de estágio',
  honorario_pj: 'Honorário PJ',
  beneficios: 'Benefícios',
}

/**
 * Código da Natureza Filho do plano padrão que o mapa SUGERE para cada
 * componente (Task 4). Sugestão não vale até ser gravada. `honorario_pj` não
 * tem sugestão: o plano padrão não tem natureza de serviço de terceiro de folha.
 */
export const CODIGO_PADRAO: Partial<Record<Componente, string>> = {
  salario: '5.1.1',
  outros_proventos: '5.1.1',
  bolsa_estagio: '5.1.1',
  inss_patronal: '5.1.2',
  fgts: '5.1.2',
  encargos_13_ferias: '5.1.2',
  inss_pro_labore: '5.1.2',
  beneficios: '5.1.3',
  decimo_terceiro: '5.1.4',
  terco_ferias: '5.1.4',
  pro_labore: '5.1.5',
}

// ─── Tipos do cálculo (frações) ──────────────────────────────────────────────

/** Alíquotas da unidade jurídica, em FRAÇÃO (0.20 = 20%). */
export type ParametrosUJ = {
  regime: Regime | null
  anexoIV: boolean
  inss: number
  ratFap: number
  terceiros: number
  fgts: number
}

/** Parâmetros da versão de orçamento, em FRAÇÃO. */
export type ParametrosVersaoCalc = {
  modoProvisao: ModoProvisao
  dissidioMes: number | null
  dissidioPct: number | null
}

export type AlocacaoCalc = {
  costCenterId: string | null
  businessUnitId: string | null
  /** 0–100, como no banco. */
  percentual: number
}

export type BeneficioCalc = {
  nome: string
  /** Reais por mês, custo líquido para a empresa. */
  valorMensal: number
  categoryId: string | null
}

/** Os campos de `budget_people` em camelCase; percentuais em FRAÇÃO. Valores em reais. */
export type PessoaCalc = {
  nome: string | null
  isVaga: boolean
  cargo: string | null
  vinculo: Vinculo
  legalEntityId: string | null
  contactId: string | null
  valorBase: number
  outrosProventos: number
  mesEntrada: number
  mesSaida: number
  /** Só PJ: meses com pagamento; nulo = todos entre entrada e saída. */
  mesesPj: number[] | null
  mesFerias: number | null
  diaPagamentoPj: number
  aplicaDissidio: boolean
  reajusteMes: number | null
  /** Fração: 0.05 = 5%. */
  reajustePct: number | null
  naturezas: Partial<Record<Componente, string>>
  alocacoes: AlocacaoCalc[]
  beneficios: BeneficioCalc[]
}

/** Um lançamento calculado da pessoa, antes de natureza e alocação (Task 3). */
export type LinhaCalculada = {
  componente: Componente
  beneficio?: { nome: string; categoryId: string | null }
  /**
   * Só em `encargos_13_ferias`: sobre qual provento o encargo incide e qual
   * parte ele é. São quatro séries com datas de caixa diferentes, e é este
   * campo que as distingue.
   */
  encargo?: { sobre: 'decimo_terceiro' | 'terco_ferias'; parte: 'patronal' | 'fgts' }
  /** YYYY-MM */
  competencia: string
  /** YYYY-MM-DD */
  caixa: string
  centavos: number
}

// ─── Schemas de entrada (pontos percentuais) ─────────────────────────────────

const mes = z.number().int().min(1, 'Mês entre 1 e 12').max(12, 'Mês entre 1 e 12')
// Os limites espelham os CHECKs da migration 0036 — o que o Zod aceita tem de
// caber na coluna. Reajuste negativo, além disso, daria complemento negativo
// em dezembro.
const pontos = z.number().min(0, 'Percentual não pode ser negativo').max(1000)
const aliquotaPontos = z.number().min(0, 'Alíquota não pode ser negativa').max(100, 'Alíquota acima de 100%')

/** "99,99" — o número como a pessoa leria. */
function pctBR(centesimos: number): string {
  return (centesimos / 100).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')
}

export const alocacaoSchema = z.object({
  costCenterId: z.uuid().nullable().default(null),
  businessUnitId: z.uuid().nullable().default(null),
  percentual: z.number().gt(0, 'Percentual da alocação deve ser maior que zero').max(100),
})

export const beneficioSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do benefício'),
  valorMensal: z.number().gt(0, 'Valor do benefício deve ser maior que zero'),
  categoryId: z.uuid().nullable().default(null),
})

export const pessoaSchema = z
  .object({
    nome: z.string().trim().min(1).nullable().default(null),
    isVaga: z.boolean().default(false),
    vinculo: z.enum(VINCULOS),
    cargo: z.string().trim().nullable().default(null),
    legalEntityId: z.uuid().nullable().default(null),
    contactId: z.uuid().nullable().default(null),
    valorBase: z.number().gt(0, 'Valor deve ser maior que zero'),
    outrosProventos: z.number().min(0).default(0),
    /** Sem valor = janeiro. Vaga precisa informar (é o mês previsto de entrada). */
    mesEntrada: mes.optional(),
    mesSaida: mes.default(12),
    mesesPj: z.array(mes).nullable().default(null),
    mesFerias: mes.nullable().default(null),
    diaPagamentoPj: z.number().int().min(1, 'Dia entre 1 e 28').max(28, 'Dia entre 1 e 28').default(10),
    aplicaDissidio: z.boolean().default(true),
    reajusteMes: mes.nullable().default(null),
    /** Pontos percentuais: 5 = 5%. */
    reajustePct: pontos.nullable().default(null),
    naturezas: z.partialRecord(z.enum(COMPONENTES), z.uuid()).default({}),
    observacao: z.string().nullable().default(null),
    alocacoes: z.array(alocacaoSchema).default([]),
    beneficios: z.array(beneficioSchema).default([]),
  })
  .superRefine((p, ctx) => {
    const erro = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })

    if (!p.isVaga && !p.nome) erro('nome', 'Informe o nome da pessoa (ou marque como vaga)')
    if (p.isVaga && p.mesEntrada === undefined) erro('mesEntrada', 'Vaga precisa do mês previsto de entrada')

    const entrada = p.mesEntrada ?? 1
    if (p.mesSaida < entrada) erro('mesSaida', 'O mês de saída não pode ser anterior ao de entrada')

    if ((p.vinculo === 'clt' || p.vinculo === 'pro_labore') && !p.legalEntityId) {
      erro('legalEntityId', `${p.vinculo === 'clt' ? 'CLT' : 'Pró-labore'} precisa de unidade jurídica (de onde vêm as alíquotas)`)
    }

    if (p.vinculo === 'pj' && p.mesesPj) {
      if (p.mesesPj.length === 0) erro('mesesPj', 'Escolha ao menos um mês de pagamento')
      if (new Set(p.mesesPj).size !== p.mesesPj.length) erro('mesesPj', 'Mês repetido na lista de pagamentos')
    }

    if ((p.reajusteMes === null) !== (p.reajustePct === null)) {
      erro('reajustePct', 'Reajuste precisa de mês e percentual juntos')
    }

    if (p.alocacoes.length > 0) {
      const centesimos = p.alocacoes.reduce((s, a) => s + Math.round(a.percentual * 100), 0)
      if (centesimos !== 10000) {
        erro('alocacoes', `As alocações somam ${pctBR(centesimos)}%; precisam somar 100%`)
      }
    }
  })

export type PessoaInput = z.input<typeof pessoaSchema>
export type PessoaValidada = z.output<typeof pessoaSchema>

export const parametrosVersaoSchema = z
  .object({
    modoProvisao: z.enum(MODOS_PROVISAO).default('provisao'),
    dissidioMes: mes.nullable().default(null),
    /** Pontos percentuais: 5 = 5%. */
    dissidioPct: pontos.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if ((v.dissidioMes === null) !== (v.dissidioPct === null)) {
      ctx.addIssue({ code: 'custom', path: ['dissidioPct'], message: 'Dissídio precisa de mês e percentual juntos' })
    }
  })

export type ParametrosVersaoInput = z.input<typeof parametrosVersaoSchema>

export const unidadeJuridicaFolhaSchema = z.object({
  regime: z.enum(REGIMES).nullable(),
  anexoIV: z.boolean().default(false),
  /** Pontos percentuais: 20 = 20%. */
  inss: aliquotaPontos.default(20),
  ratFap: aliquotaPontos.default(2),
  terceiros: aliquotaPontos.default(5.8),
  fgts: aliquotaPontos.default(8),
})

export type UnidadeJuridicaFolhaInput = z.input<typeof unidadeJuridicaFolhaSchema>

// ─── Conversão entrada → cálculo ─────────────────────────────────────────────

const fracao = (pts: number | null) => (pts === null ? null : pts / 100)

export function paraPessoaCalc(p: PessoaValidada): PessoaCalc {
  return {
    nome: p.nome,
    isVaga: p.isVaga,
    cargo: p.cargo,
    vinculo: p.vinculo,
    legalEntityId: p.legalEntityId,
    contactId: p.contactId,
    valorBase: p.valorBase,
    outrosProventos: p.outrosProventos,
    mesEntrada: p.mesEntrada ?? 1,
    mesSaida: p.mesSaida,
    mesesPj: p.vinculo === 'pj' ? p.mesesPj : null,
    mesFerias: p.mesFerias,
    diaPagamentoPj: p.diaPagamentoPj,
    aplicaDissidio: p.aplicaDissidio,
    reajusteMes: p.reajusteMes,
    reajustePct: fracao(p.reajustePct),
    naturezas: p.naturezas,
    alocacoes: p.alocacoes.map(a => ({ ...a })),
    beneficios: p.beneficios.map(b => ({ ...b })),
  }
}

export function paraParametrosVersaoCalc(v: z.output<typeof parametrosVersaoSchema>): ParametrosVersaoCalc {
  return { modoProvisao: v.modoProvisao, dissidioMes: v.dissidioMes, dissidioPct: fracao(v.dissidioPct) }
}

export function paraParametrosUJ(u: z.output<typeof unidadeJuridicaFolhaSchema>): ParametrosUJ {
  return {
    regime: u.regime,
    anexoIV: u.anexoIV,
    inss: u.inss / 100,
    ratFap: u.ratFap / 100,
    terceiros: u.terceiros / 100,
    fgts: u.fgts / 100,
  }
}

/** A recusa de editar/apagar um lançamento da folha fora do quadro (e a dica na tela). */
export const RECUSA_FOLHA = 'Este lançamento vem da folha. Edite no Quadro de pessoal e gere a folha de novo.'
