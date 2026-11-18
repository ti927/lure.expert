// O cálculo da folha de UMA pessoa num exercício — puro, sem banco, em centavos.
// Importável pelo cliente (a tela mostra o custo anual ao vivo). Referência:
// spec da folha no orçamento, seções 5.1–5.7.
//
// ─── A invariante que organiza o arquivo ─────────────────────────────────────
//
// O custo anual de uma pessoa é IDÊNTICO nos dois modos (provisão e
// pagamento), ao centavo. Só a distribuição por mês muda. Por isso o 13º, o
// terço e os quatro encargos sobre eles são calculados como um ALVO anual
// primeiro; no modo pagamento o alvo cai inteiro num mês, e no modo provisão
// cada mês leva o seu 1/12 (ou 1/36) arredondado e o ÚLTIMO mês ativo recebe
// `alvo − Σ anteriores` — o complemento do dissídio mais o resto do
// arredondamento. O complemento do terço vai no último mês ativo, e não no
// mês de férias, de propósito: com reajuste DEPOIS das férias, complementar no
// mês de férias daria um complemento negativo.
// ─────────────────────────────────────────────────────────────────────────────

import { splitEqually, toCents } from './allocation-math'
import type {
  Componente, LinhaCalculada, ParametrosUJ, ParametrosVersaoCalc, PessoaCalc, Vinculo,
} from './payroll-types'

/**
 * CLT ou pró-labore cuja unidade jurídica não informa o regime tributário (ou
 * que não tem unidade jurídica). O cálculo não assume regime: a Task 3
 * transforma isto em recusa nomeando a pessoa e a unidade.
 */
export class RegimeAusente extends Error {
  constructor(
    public readonly pessoa: Pick<PessoaCalc, 'nome' | 'isVaga' | 'cargo' | 'legalEntityId'> | null = null,
  ) {
    const quem = pessoa ? (pessoa.nome ?? (pessoa.isVaga ? `Vaga${pessoa.cargo ? ` · ${pessoa.cargo}` : ''}` : 'Pessoa')) : null
    super(
      quem
        ? `${quem}: a unidade jurídica não tem regime tributário`
        : 'A unidade jurídica não tem regime tributário',
    )
    this.name = 'RegimeAusente'
  }
}

/** Arredonda a soma de frações para não carregar 0.27800000000000002 adiante. */
const limpa = (x: number) => Math.round(x * 1e9) / 1e9

/**
 * As alíquotas que incidem sobre a remuneração do vínculo (spec 5.2).
 * `patronal` = INSS + RAT×FAP (+ terceiros só em Real/Presumido) onde incidem;
 * no Simples, só no Anexo IV, e sem terceiros. FGTS só CLT. Pró-labore: só o
 * INSS, onde incide. PJ e estágio: nada.
 */
export function aliquotas(uj: ParametrosUJ, vinculo: Vinculo): { patronal: number; fgts: number } {
  if (vinculo === 'pj' || vinculo === 'estagio') return { patronal: 0, fgts: 0 }
  if (!uj.regime) throw new RegimeAusente()
  const lucro = uj.regime === 'lucro_real' || uj.regime === 'lucro_presumido'
  const incide = lucro || (uj.regime === 'simples' && uj.anexoIV)
  if (vinculo === 'pro_labore') return { patronal: incide ? uj.inss : 0, fgts: 0 }
  return {
    patronal: incide ? limpa(uj.inss + uj.ratFap + (lucro ? uj.terceiros : 0)) : 0,
    fgts: uj.fgts,
  }
}

// ─── Datas ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')
const competencia = (ano: number, m: number) => `${ano}-${pad(m)}`

/** Data com o mês podendo transbordar (13 = janeiro do ano seguinte) e o dia aparado ao fim do mês. */
function data(ano: number, m: number, dia: number): string {
  const a = ano + Math.floor((m - 1) / 12)
  const mm = ((m - 1) % 12 + 12) % 12 + 1
  const ultimo = new Date(Date.UTC(a, mm, 0)).getUTCDate()
  return `${a}-${pad(mm)}-${pad(Math.min(dia, ultimo))}`
}

/** Dia 20 do mês seguinte ao de uma data YYYY-MM-DD. */
function dia20DoMesSeguinte(d: string): string {
  const [a, m] = d.split('-').map(Number)
  return data(a, m + 1, 20)
}

// ─── O cálculo ───────────────────────────────────────────────────────────────

/** Os meses ativos no exercício: entrada..saída; PJ = lista de meses ∩ esse intervalo. */
function mesesAtivos(p: PessoaCalc): number[] {
  const meses: number[] = []
  for (let m = p.mesEntrada; m <= p.mesSaida; m++) meses.push(m)
  if (p.vinculo === 'pj' && p.mesesPj) return meses.filter(m => p.mesesPj!.includes(m))
  return meses
}

/**
 * Distribui um alvo anual pelos meses: provisão = parcela própria de cada mês
 * com o último levando o fechamento; pagamento = alvo inteiro no mês dado.
 */
function distribuir(
  meses: number[], parcela: (m: number) => number, alvo: number, provisao: boolean, mesPagamento: number,
): Map<number, number> {
  const r = new Map<number, number>()
  if (meses.length === 0) return r
  if (!provisao) {
    r.set(mesPagamento, alvo)
    return r
  }
  const ultimo = meses[meses.length - 1]
  let acumulado = 0
  for (const m of meses) {
    if (m === ultimo) break
    const v = parcela(m)
    r.set(m, v)
    acumulado += v
  }
  r.set(ultimo, alvo - acumulado)
  return r
}

export function calcularPessoa(
  p: PessoaCalc, versao: ParametrosVersaoCalc, uj: ParametrosUJ | null, exercicio: number,
): LinhaCalculada[] {
  const ehClt = p.vinculo === 'clt'
  const temEncargo = ehClt || p.vinculo === 'pro_labore'
  if (temEncargo && (!uj || !uj.regime)) throw new RegimeAusente(p)
  const aliq = temEncargo ? aliquotas(uj!, p.vinculo) : { patronal: 0, fgts: 0 }

  const ativos = mesesAtivos(p)
  const linhas: LinhaCalculada[] = []
  if (ativos.length === 0) return linhas

  const push = (l: LinhaCalculada) => { if (l.centavos !== 0) linhas.push(l) }

  // Reajuste: CLT usa o dissídio da versão; os demais, o reajuste próprio.
  const [mesReajuste, pctReajuste] = ehClt
    ? (p.aplicaDissidio ? [versao.dissidioMes, versao.dissidioPct] : [null, null])
    : [p.reajusteMes, p.reajustePct]
  const fator = (m: number) => (mesReajuste !== null && pctReajuste !== null && m >= mesReajuste ? 1 + pctReajuste : 1)

  const baseC = toCents(p.valorBase)
  const outrosC = toCents(p.outrosProventos)
  const principal = (m: number) => Math.round(baseC * fator(m))
  const outros = (m: number) => Math.round(outrosC * fator(m))
  const rem = (m: number) => principal(m) + outros(m)

  // Férias (CLT arts. 130/134): só depois de 12 meses de período aquisitivo.
  // Quem é admitido no exercício (entrada > janeiro) não tira férias nele — elas
  // caem no ano seguinte, no mês informado ou no aniversário da admissão.
  const feriasNoAnoSeguinte = p.mesEntrada > 1
  const mesFerias = p.mesFerias ?? (feriasNoAnoSeguinte ? p.mesEntrada : 12)
  const feriasNoExercicio = (m: number) => !feriasNoAnoSeguinte && m === mesFerias
  const comp = (m: number) => competencia(exercicio, m)
  const m1 = (m: number, dia: number) => data(exercicio, m + 1, dia)

  const componentePrincipal: Componente =
    p.vinculo === 'clt' ? 'salario'
    : p.vinculo === 'pro_labore' ? 'pro_labore'
    : p.vinculo === 'estagio' ? 'bolsa_estagio'
    : 'honorario_pj'

  // ── Mês a mês: remuneração, encargos do mês, benefícios ──
  for (const m of ativos) {
    const caixaRem =
      p.vinculo === 'pj' ? m1(m, p.diaPagamentoPj)
      : ehClt && feriasNoExercicio(m) ? data(exercicio, m, 1)
      : m1(m, 5)
    push({ componente: componentePrincipal, competencia: comp(m), caixa: caixaRem, centavos: principal(m) })
    push({ componente: 'outros_proventos', competencia: comp(m), caixa: caixaRem, centavos: outros(m) })

    if (ehClt) {
      push({ componente: 'inss_patronal', competencia: comp(m), caixa: m1(m, 20), centavos: Math.round(rem(m) * aliq.patronal) })
      push({ componente: 'fgts', competencia: comp(m), caixa: m1(m, 20), centavos: Math.round(rem(m) * aliq.fgts) })
    } else if (p.vinculo === 'pro_labore') {
      push({ componente: 'inss_pro_labore', competencia: comp(m), caixa: m1(m, 20), centavos: Math.round(rem(m) * aliq.patronal) })
    }

    for (const b of p.beneficios) {
      push({
        componente: 'beneficios', beneficio: { nome: b.nome, categoryId: b.categoryId },
        competencia: comp(m), caixa: m1(m, 5), centavos: toCents(b.valorMensal),
      })
    }
  }

  if (!ehClt) return linhas

  // ── 13º e 1/3 de férias (CLT) ──
  const ultimo = ativos[ativos.length - 1]
  const avos = ativos.length
  const provisao = versao.modoProvisao === 'provisao'
  const alvo13 = Math.round(rem(ultimo) * avos / 12)
  const alvoTerco = Math.round(rem(ultimo) * avos / 36)
  const mesPagTerco = ativos.some(feriasNoExercicio) ? mesFerias : ultimo

  const d13 = distribuir(ativos, m => Math.round(rem(m) / 12), alvo13, provisao, ultimo)
  const dTerco = distribuir(ativos, m => Math.round(rem(m) / 36), alvoTerco, provisao, mesPagTerco)
  const d13p = distribuir(ativos, m => Math.round((d13.get(m) ?? 0) * aliq.patronal), Math.round(alvo13 * aliq.patronal), provisao, ultimo)
  const d13f = distribuir(ativos, m => Math.round((d13.get(m) ?? 0) * aliq.fgts), Math.round(alvo13 * aliq.fgts), provisao, ultimo)
  const dTp = distribuir(ativos, m => Math.round((dTerco.get(m) ?? 0) * aliq.patronal), Math.round(alvoTerco * aliq.patronal), provisao, mesPagTerco)
  const dTf = distribuir(ativos, m => Math.round((dTerco.get(m) ?? 0) * aliq.fgts), Math.round(alvoTerco * aliq.fgts), provisao, mesPagTerco)

  // Saída antes de dezembro: o que só seria pago DEPOIS da saída vai para o
  // prazo da rescisão (dia 10 do mês seguinte, CLT art. 477). O que já foi
  // pago antes — terço de férias gozadas antes da saída — fica na data dele.
  const saiAntes = p.mesSaida < 12
  const fimDaSaida = data(exercicio, p.mesSaida, 31)
  const rescisao = data(exercicio, p.mesSaida + 1, 10)
  const ajustaRescisao = (datas: string[]) =>
    saiAntes && datas.some(d => d > fimDaSaida) ? [rescisao] : datas

  /** Emite uma linha por data de caixa, partindo os centavos igualmente entre elas. */
  const emitir = (base: Omit<LinhaCalculada, 'caixa' | 'centavos'>, centavos: number, datas: string[]) => {
    const ds = ajustaRescisao(datas)
    const partes = splitEqually(centavos, ds.length)
    ds.forEach((caixa, i) => push({ ...base, caixa, centavos: partes[i] }))
  }

  for (const m of ativos) {
    const c = comp(m)

    // 13º: metade em 30/nov, metade em 20/dez.
    emitir({ componente: 'decimo_terceiro', competencia: c }, d13.get(m) ?? 0,
      [data(exercicio, 11, 30), data(exercicio, 12, 20)])
    emitir({ componente: 'encargos_13_ferias', encargo: { sobre: 'decimo_terceiro', parte: 'patronal' }, competencia: c },
      d13p.get(m) ?? 0, [data(exercicio, 12, 20)])
    emitir({ componente: 'encargos_13_ferias', encargo: { sobre: 'decimo_terceiro', parte: 'fgts' }, competencia: c },
      d13f.get(m) ?? 0, [data(exercicio, 12, 20), data(exercicio + 1, 1, 20)])

    // Terço: dia 01 do mês de férias; provisão posterior às férias do ano paga
    // nas férias do ano seguinte; admitido no exercício, tudo nas férias do ano
    // seguinte. Encargos: dia 20 do mês seguinte ao terço.
    const caixaTerco = feriasNoAnoSeguinte || m > mesFerias
      ? data(exercicio + 1, mesFerias, 1)
      : data(exercicio, mesFerias, 1)
    const caixaEncTerco = dia20DoMesSeguinte(caixaTerco)
    emitir({ componente: 'terco_ferias', competencia: c }, dTerco.get(m) ?? 0, [caixaTerco])
    emitir({ componente: 'encargos_13_ferias', encargo: { sobre: 'terco_ferias', parte: 'patronal' }, competencia: c },
      dTp.get(m) ?? 0, [caixaEncTerco])
    emitir({ componente: 'encargos_13_ferias', encargo: { sobre: 'terco_ferias', parte: 'fgts' }, competencia: c },
      dTf.get(m) ?? 0, [caixaEncTerco])
  }

  return linhas
}

/** Σ dos lançamentos, em centavos. */
export function custoAnual(linhas: LinhaCalculada[]): number {
  return linhas.reduce((s, l) => s + l.centavos, 0)
}
