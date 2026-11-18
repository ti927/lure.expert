// A montagem dos lançamentos da folha: pega o cálculo puro de cada pessoa
// (`calcularPessoa`) e lhe dá natureza, alocação e descrição. Puro, sem banco —
// o cliente usa o mesmo código para a prévia, e a Task 4 para gravar.
//
// Recusa tudo-ou-nada: havendo QUALQUER recusa, a geração inteira é recusada
// (quem grava, a Task 4, respeita); os lançamentos ainda vêm, para a prévia
// mostrar o resto do quadro.

import { applyProportion } from './allocation-math'
import { calcularPessoa, RegimeAusente } from './payroll-calc'
import {
  ROTULO_COMPONENTE,
  type Componente, type LinhaCalculada, type ParametrosUJ, type ParametrosVersaoCalc, type PessoaCalc,
} from './payroll-types'

export type QuadroParaMontar = {
  exercicio: number
  versao: ParametrosVersaoCalc
  pessoas: Array<PessoaCalc & {
    id: string
    nome: string | null
    isVaga: boolean
    cargo: string | null
    legalEntityId: string | null
    contactId: string | null
    alocacoes: { costCenterId: string | null; businessUnitId: string | null; percentual: number }[]
    naturezas: Partial<Record<Componente, string>>
  }>
  unidades: Map<string, ParametrosUJ & { nome: string }>
  mapa: Partial<Record<Componente, string>>
  /** Só Natureza Filho ativa da organização. */
  naturezasValidas: Map<string, { nome: string }>
}

export type LancamentoFolha = {
  personId: string
  componente: Componente
  /** Só em `encargos_13_ferias`: quais das quatro séries é. */
  encargo?: LinhaCalculada['encargo']
  /** Só em `beneficios`: o nome do benefício (uma série por benefício). */
  beneficio?: string
  /** Índice da alocação da pessoa de onde nasceu a parte (0 se não há alocação). */
  alocacao: number
  descricao: string
  categoryId: string
  costCenterId: string | null
  businessUnitId: string | null
  legalEntityId: string | null
  contactId: string | null
  /** YYYY-MM */
  competencia: string
  /** YYYY-MM-DD */
  caixa: string
  centavos: number
}

export type RecusaFolha = { personId: string | null; pessoa: string; motivo: string }

export function nomeDaPessoa(p: { nome: string | null; isVaga: boolean; cargo: string | null }): string {
  if (p.nome) return p.nome
  if (p.isVaga) return p.cargo ? `Vaga · ${p.cargo}` : 'Vaga'
  return 'Pessoa'
}

const SERIE_ENCARGO: Record<'decimo_terceiro' | 'terco_ferias', Record<'patronal' | 'fgts', string>> = {
  decimo_terceiro: { patronal: 'Encargos s/ 13º — INSS/RAT/terceiros', fgts: 'Encargos s/ 13º — FGTS' },
  terco_ferias: { patronal: 'Encargos s/ férias — INSS/RAT/terceiros', fgts: 'Encargos s/ férias — FGTS' },
}

function rotuloDaLinha(l: LinhaCalculada): string {
  if (l.beneficio) return l.beneficio.nome
  if (l.encargo) return SERIE_ENCARGO[l.encargo.sobre][l.encargo.parte]
  return ROTULO_COMPONENTE[l.componente]
}

export function montarFolha(q: QuadroParaMontar): {
  lancamentos: LancamentoFolha[]; recusas: RecusaFolha[]; avisos: string[]
} {
  const lancamentos: LancamentoFolha[] = []
  const recusas: RecusaFolha[] = []
  const avisos: string[] = []

  for (const p of q.pessoas) {
    const quem = nomeDaPessoa(p)
    const uj = p.legalEntityId ? q.unidades.get(p.legalEntityId) ?? null : null

    let linhas: LinhaCalculada[]
    try {
      linhas = calcularPessoa(p, q.versao, uj, q.exercicio)
    } catch (e) {
      if (!(e instanceof RegimeAusente)) throw e
      const motivo = uj
        ? `${quem}: a unidade jurídica ${uj.nome} não tem regime tributário`
        : `${quem}: sem unidade jurídica para obter o regime tributário`
      recusas.push({ personId: p.id, pessoa: quem, motivo })
      continue
    }
    if (linhas.length === 0) continue

    // Natureza: do benefício, depois a exceção da pessoa, depois o mapa.
    const recusadas = new Set<string>()
    const naturezaDe = (l: LinhaCalculada): string | null => {
      const id = l.beneficio?.categoryId ?? p.naturezas[l.componente] ?? q.mapa[l.componente] ?? null
      if (id && q.naturezasValidas.has(id)) return id
      const chave = `${l.componente}|${l.beneficio?.nome ?? ''}`
      if (!recusadas.has(chave)) {
        recusadas.add(chave)
        const rotulo = l.beneficio ? `${ROTULO_COMPONENTE[l.componente]} (${l.beneficio.nome})` : ROTULO_COMPONENTE[l.componente]
        recusas.push({ personId: p.id, pessoa: quem, motivo: `${quem}: ${rotulo} sem natureza válida` })
      }
      return null
    }

    const alocacoes = p.alocacoes.length > 0
      ? p.alocacoes
      : [{ costCenterId: null, businessUnitId: null, percentual: 100 }]
    if (p.alocacoes.length === 0) avisos.push(`${quem} sem centro de custo e unidade de negócio`)
    const pesos = alocacoes.map(a => a.percentual)

    for (const l of linhas) {
      const categoryId = naturezaDe(l)
      if (!categoryId) continue
      const partes = alocacoes.length === 1 ? [l.centavos] : applyProportion(l.centavos, pesos)
      partes.forEach((centavos, i) => {
        if (centavos <= 0) return
        lancamentos.push({
          personId: p.id,
          componente: l.componente,
          ...(l.encargo ? { encargo: l.encargo } : {}),
          ...(l.beneficio ? { beneficio: l.beneficio.nome } : {}),
          alocacao: i,
          descricao: `Folha · ${quem} · ${rotuloDaLinha(l)}`,
          categoryId,
          costCenterId: alocacoes[i].costCenterId,
          businessUnitId: alocacoes[i].businessUnitId,
          legalEntityId: p.legalEntityId,
          contactId: p.contactId,
          competencia: l.competencia,
          caixa: l.caixa,
          centavos,
        })
      })
    }
  }

  return { lancamentos, recusas, avisos }
}
