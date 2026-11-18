/**
 * O cálculo puro da folha de uma pessoa (spec da folha no orçamento, 5.1–5.7).
 *
 *   npx tsx scripts/verify-payroll-calc.ts
 *
 * Não toca o banco. Os números esperados saem do exemplo conferível do spec
 * (5.6) e do brief da Task 2 — escritos aqui por extenso, nunca recalculados
 * pela mesma fórmula do código, senão o teste provaria a fórmula contra si mesma.
 */
import {
  aliquotas, calcularPessoa, custoAnual, RegimeAusente,
} from '@/lib/payroll-calc'
import { montarFolha, nomeDaPessoa, type QuadroParaMontar, type LancamentoFolha } from '@/lib/payroll-build'
import {
  pessoaSchema, parametrosVersaoSchema, unidadeJuridicaFolhaSchema, paraPessoaCalc,
  type PessoaCalc, type ParametrosUJ, type ParametrosVersaoCalc, type LinhaCalculada, type Componente,
} from '@/lib/payroll-types'
import { CAMPOS_FOLHA_UJ, lerFolhaDaUnidade, valoresDeFolhaParaForm } from '@/lib/payroll-uj'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { if (bom) ok++; else falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

const EX = 2027
const UJ_LP: ParametrosUJ = { regime: 'lucro_presumido', anexoIV: false, inss: 0.20, ratFap: 0.02, terceiros: 0.058, fgts: 0.08 }
const UJ_SN: ParametrosUJ = { ...UJ_LP, regime: 'simples' }
const UJ_SN4: ParametrosUJ = { ...UJ_LP, regime: 'simples', anexoIV: true }
const PROVISAO: ParametrosVersaoCalc = { modoProvisao: 'provisao', dissidioMes: null, dissidioPct: null }
const PAGAMENTO: ParametrosVersaoCalc = { modoProvisao: 'pagamento', dissidioMes: null, dissidioPct: null }
const DISS_PROV: ParametrosVersaoCalc = { modoProvisao: 'provisao', dissidioMes: 5, dissidioPct: 0.05 }
const DISS_PAG: ParametrosVersaoCalc = { modoProvisao: 'pagamento', dissidioMes: 5, dissidioPct: 0.05 }

function pessoa(o: Partial<PessoaCalc> = {}): PessoaCalc {
  return {
    nome: 'Ana', isVaga: false, cargo: null, vinculo: 'clt', legalEntityId: 'uj-1', contactId: null,
    valorBase: 5000, outrosProventos: 0, mesEntrada: 1, mesSaida: 12, mesesPj: null, mesFerias: null,
    diaPagamentoPj: 10, aplicaDissidio: true, reajusteMes: null, reajustePct: null,
    naturezas: {}, alocacoes: [], beneficios: [],
    ...o,
  }
}

/** Todo lançamento calculado em qualquer caso — conferido no fim: nenhum pode ser ≤ 0. */
const TODAS: LinhaCalculada[] = []
const calc: typeof calcularPessoa = (...args) => {
  const ls = calcularPessoa(...args)
  TODAS.push(...ls)
  return ls
}

const doMes = (ls: LinhaCalculada[], m: number) => ls.filter(l => l.competencia === `${EX}-${String(m).padStart(2, '0')}`)
const de = (ls: LinhaCalculada[], c: Componente) => ls.filter(l => l.componente === c)
const soma = (ls: LinhaCalculada[]) => ls.reduce((s, l) => s + l.centavos, 0)
const enc = (ls: LinhaCalculada[], sobre: 'decimo_terceiro' | 'terco_ferias', parte?: 'patronal' | 'fgts') =>
  de(ls, 'encargos_13_ferias').filter(l => l.encargo?.sobre === sobre && (!parte || l.encargo.parte === parte))

// ═══ clt_lp_jan ══════════════════════════════════════════════════════════════
console.log('\n── clt_lp_jan ──')
const cltProv = calc(pessoa(), PROVISAO, UJ_LP, EX)
{
  const jan = doMes(cltProv, 1)
  t(soma(de(jan, 'salario')) === 500000, `salário jan = ${soma(de(jan, 'salario'))}`)
  t(soma(de(jan, 'inss_patronal')) === 139000, `inss_patronal jan = ${soma(de(jan, 'inss_patronal'))}`)
  t(soma(de(jan, 'fgts')) === 40000, `fgts jan = ${soma(de(jan, 'fgts'))}`)
  t(soma(de(jan, 'decimo_terceiro')) === 41667, `13º jan = ${soma(de(jan, 'decimo_terceiro'))}`)
  t(soma(enc(jan, 'decimo_terceiro', 'patronal')) === 11583, `encargo patronal do 13º jan = ${soma(enc(jan, 'decimo_terceiro', 'patronal'))}`)
  t(soma(enc(jan, 'decimo_terceiro', 'fgts')) === 3333, `FGTS do 13º jan = ${soma(enc(jan, 'decimo_terceiro', 'fgts'))}`)
  t(soma(enc(jan, 'decimo_terceiro')) === 14916, 'encargos do 13º jan = 14916')
  t(soma(de(jan, 'terco_ferias')) === 13889, `terço jan = ${soma(de(jan, 'terco_ferias'))}`)
  t(soma(enc(jan, 'terco_ferias', 'patronal')) === 3861, 'encargo patronal do terço jan = 3861')
  t(soma(enc(jan, 'terco_ferias', 'fgts')) === 1111, 'FGTS do terço jan = 1111')
  t(soma(enc(jan, 'terco_ferias')) === 4972, 'encargos do terço jan = 4972')
}

// ═══ clt_lp_ano ══════════════════════════════════════════════════════════════
console.log('\n── clt_lp_ano ──')
{
  t(custoAnual(cltProv) === 9053333, `custoAnual = ${custoAnual(cltProv)} (esperado 9053333 = R$ 90.533,33)`)
  t(soma(de(cltProv, 'decimo_terceiro')) === 500000, 'Σ 13º = 500000')
  t(soma(de(cltProv, 'terco_ferias')) === 166667, `Σ terço = ${soma(de(cltProv, 'terco_ferias'))}`)
  t(soma(enc(cltProv, 'decimo_terceiro')) === 179000, `Σ encargos do 13º = ${soma(enc(cltProv, 'decimo_terceiro'))}`)
  t(soma(enc(cltProv, 'terco_ferias')) === 59666, `Σ encargos do terço = ${soma(enc(cltProv, 'terco_ferias'))}`)
  t(de(cltProv, 'outros_proventos').length === 0, 'sem outros proventos, nenhuma linha outros_proventos')
  t(cltProv.every(l => Number.isInteger(l.centavos)), 'todo lançamento em centavos inteiros')
}

// ═══ modos_iguais ════════════════════════════════════════════════════════════
console.log('\n── modos_iguais ──')
{
  const pag = calc(pessoa(), PAGAMENTO, UJ_LP, EX)
  t(custoAnual(pag) === custoAnual(cltProv), `pagamento = provisão: ${custoAnual(pag)} × ${custoAnual(cltProv)}`)
  t(de(pag, 'decimo_terceiro').every(l => l.competencia === `${EX}-12`), 'pagamento: 13º inteiro na competência de dezembro')
  t(de(pag, 'terco_ferias').every(l => l.competencia === `${EX}-12`), 'pagamento: terço no mês de férias padrão (12)')

  const dProv = calc(pessoa(), DISS_PROV, UJ_LP, EX)
  const dPag = calc(pessoa(), DISS_PAG, UJ_LP, EX)
  t(custoAnual(dProv) === custoAnual(dPag), `com dissídio 5% em maio: provisão ${custoAnual(dProv)} = pagamento ${custoAnual(dPag)}`)
  t(soma(de(dProv, 'decimo_terceiro')) === 525000, `dissídio: Σ 13º provisão = ${soma(de(dProv, 'decimo_terceiro'))}`)
  t(soma(de(dPag, 'decimo_terceiro')) === 525000, 'dissídio: Σ 13º pagamento = 525000')
  t(soma(de(doMes(dProv, 4), 'salario')) === 500000 && soma(de(doMes(dProv, 5), 'salario')) === 525000,
    'dissídio vale a partir de maio (abr 500000, mai 525000)')
  const dez13 = soma(de(doMes(dProv, 12), 'decimo_terceiro'))
  t(dez13 > 43750, `dezembro carrega o complemento do 13º (${dez13} > 43750)`)
  const semDiss = calc(pessoa({ aplicaDissidio: false }), DISS_PROV, UJ_LP, EX)
  t(custoAnual(semDiss) === 9053333, '"não aplicar dissídio" ignora o dissídio da versão')
}

// ═══ clt_sn / clt_sn4 ════════════════════════════════════════════════════════
console.log('\n── clt_sn / clt_sn4 ──')
{
  const sn = calc(pessoa(), PROVISAO, UJ_SN, EX)
  const jan = doMes(sn, 1)
  t(de(sn, 'inss_patronal').length === 0, 'Simples III: nenhuma linha inss_patronal')
  t(soma(de(jan, 'fgts')) === 40000, 'Simples III: fgts jan = 40000')
  t(soma(enc(jan, 'decimo_terceiro')) === 3333 && enc(jan, 'decimo_terceiro', 'patronal').length === 0,
    'Simples III: encargos do 13º jan só FGTS 3333')
  t(soma(enc(jan, 'terco_ferias')) === 1111 && enc(jan, 'terco_ferias', 'patronal').length === 0,
    'Simples III: encargos do terço jan só FGTS 1111')

  const sn4 = calc(pessoa(), PROVISAO, UJ_SN4, EX)
  t(soma(de(doMes(sn4, 1), 'inss_patronal')) === 110000, `Anexo IV: inss_patronal jan = ${soma(de(doMes(sn4, 1), 'inss_patronal'))} (22%, sem terceiros)`)

  const a = aliquotas(UJ_LP, 'clt')
  t(Math.abs(a.patronal - 0.278) < 1e-9 && a.fgts === 0.08, `aliquotas LP/CLT = ${a.patronal} + ${a.fgts}`)
  t(aliquotas(UJ_LP, 'pj').patronal === 0 && aliquotas(UJ_LP, 'estagio').fgts === 0, 'PJ e estágio: sem alíquota')
  const pl = aliquotas(UJ_LP, 'pro_labore')
  t(pl.patronal === 0.20 && pl.fgts === 0, 'pró-labore: só INSS, sem FGTS')
  const real = aliquotas({ ...UJ_LP, regime: 'lucro_real' }, 'clt')
  t(Math.abs(real.patronal - 0.278) < 1e-9, 'lucro real incide como presumido')
}

// ═══ pró-labore ══════════════════════════════════════════════════════════════
console.log('\n── pro_labore ──')
{
  const pl = calc(pessoa({ vinculo: 'pro_labore', valorBase: 10000 }), PROVISAO, UJ_LP, EX)
  t(de(pl, 'pro_labore').length === 12 && de(pl, 'pro_labore').every(l => l.centavos === 1000000), 'pro_labore 1000000/mês × 12')
  t(de(pl, 'inss_pro_labore').length === 12 && de(pl, 'inss_pro_labore').every(l => l.centavos === 200000), 'inss_pro_labore 200000/mês')
  t(de(pl, 'fgts').length === 0 && de(pl, 'decimo_terceiro').length === 0 && de(pl, 'terco_ferias').length === 0,
    'pró-labore: nenhum fgts, 13º ou terço')
  t(de(pl, 'salario').length === 0 && de(pl, 'inss_patronal').length === 0, 'pró-labore não vira salário nem inss_patronal')

  const plSn = calc(pessoa({ vinculo: 'pro_labore', valorBase: 10000 }), PROVISAO, UJ_SN, EX)
  t(de(plSn, 'inss_pro_labore').length === 0, 'pró-labore no Simples III: nenhuma linha inss_pro_labore')
  const plSn4 = calc(pessoa({ vinculo: 'pro_labore', valorBase: 10000 }), PROVISAO, UJ_SN4, EX)
  t(soma(de(doMes(plSn4, 1), 'inss_pro_labore')) === 200000, 'pró-labore no Anexo IV: INSS incide')
}

// ═══ pj_meses ════════════════════════════════════════════════════════════════
console.log('\n── pj_meses ──')
{
  const pj = calc(pessoa({ vinculo: 'pj', legalEntityId: null, valorBase: 12000, mesesPj: [1, 2, 3, 10], diaPagamentoPj: 10 }), PROVISAO, null, EX)
  const hon = de(pj, 'honorario_pj')
  t(hon.length === 4, `4 linhas honorario_pj (${hon.length})`)
  t(hon.every(l => l.centavos === 1200000), 'cada uma 1200000')
  t(hon.find(l => l.competencia === `${EX}-03`)?.caixa === '2027-04-10', 'março com caixa 2027-04-10')
  t(pj.length === 4, 'PJ: sem encargos, sem nada além do honorário')
  const pjSemLista = calc(pessoa({ vinculo: 'pj', legalEntityId: null, valorBase: 100, mesEntrada: 3, mesSaida: 5 }), PROVISAO, null, EX)
  t(de(pjSemLista, 'honorario_pj').length === 3, 'PJ com mesesPj nulo: todos os meses entre entrada e saída')
  const pjFora = calc(pessoa({ vinculo: 'pj', legalEntityId: null, valorBase: 100, mesEntrada: 2, mesSaida: 9, mesesPj: [1, 2, 10] }), PROVISAO, null, EX)
  t(de(pjFora, 'honorario_pj').length === 1, 'PJ: mesesPj ∩ [entrada..saída]')
  const pj28 = calc(pessoa({ vinculo: 'pj', legalEntityId: null, valorBase: 100, mesesPj: [1], diaPagamentoPj: 28 }), PROVISAO, null, EX)
  t(pj28[0]?.caixa === '2027-02-28', `dia 28 (o teto do banco) em fevereiro: ${pj28[0]?.caixa}`)
}

// ═══ estágio ═════════════════════════════════════════════════════════════════
console.log('\n── estagio ──')
{
  const est = calc(pessoa({
    vinculo: 'estagio', legalEntityId: null, valorBase: 1500,
    beneficios: [{ nome: 'Seguro', valorMensal: 30, categoryId: 'cat-seguro' }],
  }), PROVISAO, null, EX)
  t(de(est, 'bolsa_estagio').length === 12 && de(est, 'bolsa_estagio').every(l => l.centavos === 150000), '12 bolsas de 150000')
  const ben = de(est, 'beneficios')
  t(ben.length === 12 && ben.every(l => l.centavos === 3000 && l.beneficio?.nome === 'Seguro' && l.beneficio.categoryId === 'cat-seguro'),
    '12 benefícios "Seguro" de 3000 com a natureza própria')
  t(est.length === 24, `nada mais (${est.length} linhas)`)
}

// ═══ admissao_marco ══════════════════════════════════════════════════════════
console.log('\n── admissao_marco ──')
{
  const p = pessoa({ mesEntrada: 3 })
  const ad = calc(p, PROVISAO, UJ_LP, EX)
  t(doMes(ad, 1).length === 0 && doMes(ad, 2).length === 0, 'nenhuma linha em jan/fev')
  t(soma(de(ad, 'decimo_terceiro')) === 416667, `avos 10: Σ 13º = ${soma(de(ad, 'decimo_terceiro'))}`)
  // CLT arts. 130/134: admitido no exercício não tem período aquisitivo completo
  // — as férias caem em março do ano seguinte.
  t(de(ad, 'salario').find(l => l.competencia === `${EX}-03`)?.caixa === '2027-04-05', 'salário de março no dia 05 de abril (sem férias no ano da admissão)')
  t(de(ad, 'salario').every(l => l.caixa.endsWith('-05')), 'nenhum salário do ano da admissão com a data de férias')
  t(de(ad, 'terco_ferias').length === 10 && de(ad, 'terco_ferias').every(l => l.caixa === '2028-03-01'), 'provisões do terço: caixa 2028-03-01')
  t(enc(ad, 'terco_ferias').every(l => l.caixa === '2028-04-20'), 'encargos do terço: 2028-04-20')
  t(custoAnual(ad) === 7544444, `custoAnual = ${custoAnual(ad)} (o mesmo de antes da regra de férias)`)
  const adPag = calc(p, PAGAMENTO, UJ_LP, EX)
  t(custoAnual(adPag) === custoAnual(ad), `custoAnual igual nos dois modos (${custoAnual(ad)})`)
  t(de(adPag, 'terco_ferias').every(l => l.competencia === `${EX}-12` && l.caixa === '2028-03-01'),
    'pagamento: terço na competência de dezembro, caixa 2028-03-01')
  const adF = calc(pessoa({ mesEntrada: 3, mesFerias: 8 }), PROVISAO, UJ_LP, EX)
  t(de(adF, 'terco_ferias').every(l => l.caixa === '2028-08-01'), 'mês de férias informado: agosto do ano seguinte')
  t(de(doMes(adF, 8), 'salario')[0]?.caixa === '2027-09-05', 'e o salário de agosto do ano da admissão segue o dia 05')
  const adS = calc(pessoa({ mesEntrada: 3, mesSaida: 9 }), PROVISAO, UJ_LP, EX)
  t(de(adS, 'terco_ferias').every(l => l.caixa === '2027-10-10'), 'admitido e demitido no ano: o terço vai para a rescisão')
}

// ═══ saida_junho ═════════════════════════════════════════════════════════════
console.log('\n── saida_junho ──')
{
  const p = pessoa({ mesSaida: 6 })
  const sd = calc(p, PROVISAO, UJ_LP, EX)
  const rescisao = [...de(sd, 'decimo_terceiro'), ...de(sd, 'terco_ferias'), ...de(sd, 'encargos_13_ferias')]
  t(rescisao.length > 0 && rescisao.every(l => l.caixa === '2027-07-10'), '13º, terço e encargos com caixa 2027-07-10')
  t(sd.every(l => l.competencia <= `${EX}-06`), 'nenhuma linha depois de junho')
  t(soma(de(sd, 'decimo_terceiro')) === 250000, `avos 6: Σ 13º = ${soma(de(sd, 'decimo_terceiro'))}`)
  const sdPag = calc(p, PAGAMENTO, UJ_LP, EX)
  t(custoAnual(sdPag) === custoAnual(sd), `custoAnual igual nos dois modos (${custoAnual(sd)})`)
  const sdD = calc(p, DISS_PROV, UJ_LP, EX)
  const sdDPag = calc(p, DISS_PAG, UJ_LP, EX)
  t(custoAnual(sdD) === custoAnual(sdDPag), 'com dissídio, saída em junho: igual nos dois modos')
}

// ═══ caixa_datas ═════════════════════════════════════════════════════════════
console.log('\n── caixa_datas ──')
{
  t(de(doMes(cltProv, 1), 'salario')[0]?.caixa === '2027-02-05', 'salário de janeiro: 2027-02-05')
  t(de(doMes(cltProv, 12), 'inss_patronal')[0]?.caixa === '2028-01-20', 'inss de dezembro: 2028-01-20')
  t(de(doMes(cltProv, 1), 'fgts')[0]?.caixa === '2027-02-20', 'fgts de janeiro: 2027-02-20')
  const mar13 = de(doMes(cltProv, 3), 'decimo_terceiro')
  t(mar13.length === 2 && mar13.map(l => l.caixa).sort().join(',') === '2027-11-30,2027-12-20',
    `13º de março: duas linhas (${mar13.map(l => l.caixa).join(', ')})`)
  t(soma(mar13) === 41667 && Math.abs(mar13[0].centavos - mar13[1].centavos) <= 1, 'as duas metades somam a provisão do mês')
  const fgts13 = enc(doMes(cltProv, 3), 'decimo_terceiro', 'fgts')
  t(fgts13.some(l => l.caixa === '2028-01-20') && fgts13.some(l => l.caixa === '2027-12-20'), 'FGTS do 13º: metade em 2027-12-20, metade em 2028-01-20')
  t(enc(doMes(cltProv, 3), 'decimo_terceiro', 'patronal').every(l => l.caixa === '2027-12-20'), 'patronal do 13º: 2027-12-20')

  const f7 = calc(pessoa({ mesFerias: 7 }), PROVISAO, UJ_LP, EX)
  t(de(doMes(f7, 7), 'salario')[0]?.caixa === '2027-07-01', 'mês de férias 7: salário de julho em 2027-07-01')
  t(de(doMes(f7, 8), 'salario')[0]?.caixa === '2027-09-05', 'agosto volta ao dia 05')
  t(de(doMes(f7, 9), 'terco_ferias')[0]?.caixa === '2028-07-01', 'terço de setembro: 2028-07-01')
  t(de(doMes(f7, 7), 'terco_ferias')[0]?.caixa === '2027-07-01', 'terço de julho: 2027-07-01')
  t(enc(doMes(f7, 9), 'terco_ferias').every(l => l.caixa === '2028-08-20'), 'encargo do terço de setembro: 2028-08-20')
  const ben = calc(pessoa({ mesFerias: 7, beneficios: [{ nome: 'VR', valorMensal: 800, categoryId: null }] }), PROVISAO, UJ_LP, EX)
  t(de(doMes(ben, 7), 'beneficios')[0]?.caixa === '2027-08-05', 'benefício não muda de data no mês de férias')
}

// ═══ outros proventos e reajuste próprio ═════════════════════════════════════
console.log('\n── outros_proventos / reajuste ──')
{
  const op = calc(pessoa({ valorBase: 4000, outrosProventos: 1000 }), PROVISAO, UJ_LP, EX)
  t(soma(de(doMes(op, 1), 'salario')) === 400000 && soma(de(doMes(op, 1), 'outros_proventos')) === 100000, 'outros proventos em linha própria')
  t(custoAnual(op) === 9053333, 'outros proventos entram na base de encargos, 13º e terço (custo = 5.000 de salário)')
  const pl = calc(pessoa({ vinculo: 'pro_labore', valorBase: 10000, reajusteMes: 7, reajustePct: 0.10 }), DISS_PROV, UJ_LP, EX)
  t(soma(de(doMes(pl, 6), 'pro_labore')) === 1000000 && soma(de(doMes(pl, 7), 'pro_labore')) === 1100000,
    'pró-labore usa o reajuste próprio (jul +10%), não o dissídio')
}

// ═══ sem_regime ══════════════════════════════════════════════════════════════
console.log('\n── sem_regime ──')
{
  const lanca = (fn: () => unknown) => { try { fn(); return null } catch (e) { return e } }
  const e1 = lanca(() => calc(pessoa(), PROVISAO, null, EX))
  t(e1 instanceof RegimeAusente, 'CLT com uj=null → RegimeAusente')
  t(e1 instanceof RegimeAusente && e1.pessoa?.nome === 'Ana', 'o erro carrega a pessoa')
  const e2 = lanca(() => calc(pessoa({ vinculo: 'pro_labore' }), PROVISAO, { ...UJ_LP, regime: null }, EX))
  t(e2 instanceof RegimeAusente, 'pró-labore com regime nulo → RegimeAusente')
  t(lanca(() => calc(pessoa({ vinculo: 'pj', legalEntityId: null }), PROVISAO, null, EX)) === null, 'PJ sem unidade jurídica não lança')
}

// ═══ zod ═════════════════════════════════════════════════════════════════════
console.log('\n── zod ──')
{
  const base = {
    nome: 'Ana', isVaga: false, vinculo: 'clt', legalEntityId: '11111111-1111-4111-8111-111111111111',
    valorBase: 5000, mesEntrada: 1, mesSaida: 12,
    alocacoes: [], beneficios: [],
  }
  const r0 = pessoaSchema.safeParse(base)
  t(r0.success, `a pessoa base passa${r0.success ? '' : ': ' + r0.error.issues.map(i => i.message).join('; ')}`)
  const erro = (v: unknown) => { const r = pessoaSchema.safeParse(v); return r.success ? null : r.error.issues.map(i => i.message).join(' | ') }

  t(erro({ ...base, mesEntrada: 6, mesSaida: 5 }) !== null, `recusa saída < entrada (${erro({ ...base, mesEntrada: 6, mesSaida: 5 })})`)
  t(erro({ ...base, vinculo: 'pj', legalEntityId: null, mesesPj: [] }) !== null, 'recusa PJ com mesesPj=[]')
  t(erro({ ...base, vinculo: 'pj', legalEntityId: null, mesesPj: [1, 13] }) !== null, 'recusa mesesPj com 13')
  t(erro({ ...base, vinculo: 'pj', legalEntityId: null, mesesPj: [2, 2] }) !== null, 'recusa mesesPj repetido')
  t(erro({ ...base, vinculo: 'pj', legalEntityId: null, mesesPj: [1, 2] }) === null, 'aceita PJ com mesesPj válido e sem unidade jurídica')
  t(erro({ ...base, mesFerias: 13 }) !== null, 'recusa mesFerias=13')
  const { mesEntrada: _me, ...semEntrada } = base
  t(erro({ ...semEntrada, isVaga: true, nome: null }) !== null, 'recusa vaga sem mesEntrada explícito')
  t(erro(semEntrada) === null, 'pessoa (não vaga) sem mesEntrada usa janeiro')
  const cc = (n: string) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n.repeat(12)}`
  const e9999 = erro({ ...base, alocacoes: [{ costCenterId: cc('2'), businessUnitId: null, percentual: 60 }, { costCenterId: cc('3'), businessUnitId: null, percentual: 39.99 }] })
  t(e9999 !== null && e9999.includes('99,99%'), `alocações somando 99,99 → "${e9999}"`)
  t(erro({ ...base, alocacoes: [{ costCenterId: cc('2'), businessUnitId: null, percentual: 60 }, { costCenterId: cc('3'), businessUnitId: null, percentual: 40 }] }) === null, 'alocações 60/40 passam')
  t(erro({ ...base, legalEntityId: null }) !== null, `recusa CLT sem unidade jurídica (${erro({ ...base, legalEntityId: null })})`)
  t(erro({ ...base, vinculo: 'pro_labore', legalEntityId: null }) !== null, 'recusa pró-labore sem unidade jurídica')
  // Os limites do banco (0036): o que o Zod aceita tem de caber na coluna.
  t(erro({ ...base, valorBase: 0 }) !== null, 'recusa valorBase 0 (valor_base > 0)')
  t(erro({ ...base, vinculo: 'pj', legalEntityId: null, diaPagamentoPj: 29 }) !== null, 'recusa diaPagamentoPj 29 (BETWEEN 1 AND 28)')
  t(erro({ ...base, vinculo: 'pj', legalEntityId: null, diaPagamentoPj: 28 }) === null, 'aceita diaPagamentoPj 28')
  t(erro({ ...base, vinculo: 'pro_labore', reajusteMes: 7, reajustePct: -5 }) !== null, 'recusa reajuste negativo')
  t(erro({ ...base, beneficios: [{ nome: 'VR', valorMensal: 0 }] }) !== null, 'recusa benefício de valor 0 (valor_mensal > 0)')
  t(erro({ ...base, beneficios: [{ nome: 'VR', valorMensal: 800 }] }) === null, 'aceita benefício de 800')
  const eDup = erro({ ...base, beneficios: [{ nome: 'VR', valorMensal: 800 }, { nome: ' vr ', valorMensal: 200 }] })
  t(eDup !== null && /Benefício repetido/.test(eDup), `recusa "VR" e " vr " na mesma pessoa (${eDup})`)
  const eDupEsp = erro({ ...base, beneficios: [{ nome: 'Vale  Refeição', valorMensal: 800 }, { nome: 'vale refeição', valorMensal: 200 }] })
  t(eDupEsp !== null && /Benefício repetido/.test(eDupEsp), 'recusa nomes que só diferem em espaços internos e caixa')
  t(erro({ ...base, beneficios: [{ nome: 'VR', valorMensal: 800 }, { nome: 'VA', valorMensal: 300 }] }) === null, 'aceita VR e VA na mesma pessoa')

  const r = pessoaSchema.safeParse({ ...base, vinculo: 'pro_labore', reajusteMes: 7, reajustePct: 10 })
  if (r.success) {
    const pc = paraPessoaCalc(r.data)
    t(Math.abs((pc.reajustePct ?? 0) - 0.10) < 1e-12, `paraPessoaCalc: 10 pontos → ${pc.reajustePct}`)
    t(pc.mesEntrada === 1 && pc.mesSaida === 12 && pc.diaPagamentoPj === 10 && pc.aplicaDissidio === true, 'paraPessoaCalc: padrões preenchidos')
  } else t(false, 'pró-labore com reajuste deveria passar')

  const v = parametrosVersaoSchema.safeParse({ modoProvisao: 'provisao', dissidioMes: 5, dissidioPct: 5 })
  t(v.success && v.data.dissidioPct === 5, 'parametrosVersaoSchema aceita dissídio em pontos')
  t(!parametrosVersaoSchema.safeParse({ modoProvisao: 'provisao', dissidioMes: 5, dissidioPct: null }).success, 'dissídio com mês e sem percentual é recusado')
  t(!parametrosVersaoSchema.safeParse({ modoProvisao: 'provisao', dissidioMes: 5, dissidioPct: -3 }).success, 'dissídio negativo é recusado')
  const u = unidadeJuridicaFolhaSchema.safeParse({ regime: 'simples', anexoIV: true, inss: 20, ratFap: 2, terceiros: 5.8, fgts: 8 })
  t(u.success, 'unidadeJuridicaFolhaSchema aceita alíquotas em pontos')
  t(unidadeJuridicaFolhaSchema.safeParse({ regime: 'lucro_real', anexoIV: false, inss: 20, ratFap: 3.7035, terceiros: 5.8, fgts: 8 }).success,
    'aceita RAT×FAP 3,7035 (4 casas em pontos)')
  t(!unidadeJuridicaFolhaSchema.safeParse({ regime: 'lucro_real', anexoIV: false, inss: 20, ratFap: 3.70351, terceiros: 5.8, fgts: 8 }).success,
    'recusa 5 casas em pontos (truncaria ao gravar em numeric(8,6))')
  {
    const fd = new Map<string, string>([['folha_regime', 'lucro_real'], ['folha_inss', '20'], ['folha_rat_fap', '3,7035'], ['folha_terceiros', '5,8'], ['folha_fgts', '8']])
    const lido = lerFolhaDaUnidade({ get: k => fd.get(k) ?? null, has: k => fd.has(k) })
    const col = lido && !('error' in lido) ? lido.colunas : null
    t(col?.aliquotaRatFap === '0.037035', `formulário "3,7035" → coluna "0.037035" (${col?.aliquotaRatFap})`)
    const volta = col ? valoresDeFolhaParaForm(col)[CAMPOS_FOLHA_UJ.ratFap] : null
    t(volta === '3.7035', `coluna "0.037035" → formulário "3.7035" (${volta})`)
    t(col?.aliquotaTerceiros === '0.058000' && valoresDeFolhaParaForm(col!)[CAMPOS_FOLHA_UJ.terceiros] === '5.8', 'terceiros 5,8 → "0.058000" → "5.8"')
  }
  t(!unidadeJuridicaFolhaSchema.safeParse({ regime: 'mei', anexoIV: false, inss: 20, ratFap: 2, terceiros: 5.8, fgts: 8 }).success, 'regime desconhecido é recusado')
}

// ═══ montagem ════════════════════════════════════════════════════════════════
console.log('\n── montagem ──')
{
  const UJ = { ...UJ_LP, nome: 'Matriz' }
  const CAT = { sal: 'cat-sal', cpv: 'cat-cpv', ben: 'cat-ben', ben2: 'cat-ben2', out: 'cat-out' }
  const validas = new Map(Object.values(CAT).map(id => [id, { nome: id }]))
  const mapaCheio: QuadroParaMontar['mapa'] = {}
  for (const c of ['salario', 'outros_proventos', 'inss_patronal', 'fgts', 'decimo_terceiro', 'terco_ferias',
    'encargos_13_ferias', 'pro_labore', 'inss_pro_labore', 'bolsa_estagio', 'honorario_pj', 'beneficios'] as Componente[]) {
    mapaCheio[c] = c === 'salario' ? CAT.sal : CAT.out
  }
  const quadro = (ps: Partial<QuadroParaMontar['pessoas'][number]>[], o: Partial<QuadroParaMontar> = {}): QuadroParaMontar => ({
    exercicio: EX, versao: PROVISAO,
    pessoas: ps.map((p, i) => ({ ...pessoa(), id: `p${i}`, ...p }) as QuadroParaMontar['pessoas'][number]),
    unidades: new Map([['uj-1', UJ]]), mapa: mapaCheio, naturezasValidas: validas, ...o,
  })
  const somaL = (ls: LancamentoFolha[]) => ls.reduce((s, l) => s + l.centavos, 0)
  const guarda = (ls: LancamentoFolha[]) => TODAS.push(...ls.map(l => ({ componente: l.componente, competencia: l.competencia, caixa: l.caixa, centavos: l.centavos })))
  const al6040 = [{ costCenterId: 'cc-1', businessUnitId: 'uen-1', percentual: 60 }, { costCenterId: 'cc-2', businessUnitId: null, percentual: 40 }]

  // (a) 60/40
  const a = montarFolha(quadro([{ alocacoes: al6040 }]))
  guarda(a.lancamentos)
  const base = calcularPessoa(pessoa(), PROVISAO, UJ_LP, EX)
  t(a.recusas.length === 0 && a.avisos.length === 0, 'CLT 60/40: sem recusas nem avisos')
  t(somaL(a.lancamentos) === custoAnual(base), `Σ lançamentos = custoAnual (${somaL(a.lancamentos)} × ${custoAnual(base)})`)
  const salJan = a.lancamentos.filter(l => l.componente === 'salario' && l.competencia === `${EX}-01`)
  t(salJan.length === 2 && salJan[0].centavos === 300000 && salJan[1].centavos === 200000, `salário jan partido ${salJan.map(l => l.centavos)}`)
  t(salJan[0].costCenterId === 'cc-1' && salJan[0].businessUnitId === 'uen-1' && salJan[1].costCenterId === 'cc-2' && salJan[1].businessUnitId === null && salJan[0].alocacao === 0 && salJan[1].alocacao === 1, 'partes carregam CC/UEN e índice da alocação')
  t(salJan[0].categoryId === CAT.sal && salJan[0].legalEntityId === 'uj-1' && salJan[0].personId === 'p0', 'natureza, UJ e pessoa nos lançamentos')
  const porLinha = base.every(l => {
    const ps = a.lancamentos.filter(x => x.componente === l.componente && x.competencia === l.competencia && x.caixa === l.caixa
      && x.encargo?.sobre === l.encargo?.sobre && x.encargo?.parte === l.encargo?.parte)
    return somaL(ps) === l.centavos
  })
  t(porLinha, 'cada linha calculada fecha ao centavo nas suas partes')

  // (b) 33,33 / 33,33 / 33,34 de 100,01
  const b = montarFolha(quadro([{ vinculo: 'pj', legalEntityId: null, valorBase: 100.01, mesEntrada: 1, mesSaida: 1,
    alocacoes: [{ costCenterId: 'a', businessUnitId: null, percentual: 33.33 }, { costCenterId: 'b', businessUnitId: null, percentual: 33.33 }, { costCenterId: 'c', businessUnitId: null, percentual: 33.34 }] }]))
  guarda(b.lancamentos)
  t(b.lancamentos.length === 3 && somaL(b.lancamentos) === 10001, `100,01 em três partes fecha: ${b.lancamentos.map(l => l.centavos)}`)

  // (c) exceção da pessoa e benefício
  const c = montarFolha(quadro([{ naturezas: { salario: CAT.cpv }, beneficios: [{ nome: 'VR', valorMensal: 800, categoryId: CAT.ben }] }]))
  guarda(c.lancamentos)
  t(c.lancamentos.filter(l => l.componente === 'salario').every(l => l.categoryId === CAT.cpv), 'exceção da pessoa em salário vence o mapa')
  t(c.lancamentos.filter(l => l.componente === 'fgts').every(l => l.categoryId === CAT.out), 'sem exceção, vale o mapa')
  const c2 = montarFolha(quadro([{ naturezas: { beneficios: CAT.ben2 }, beneficios: [{ nome: 'VR', valorMensal: 800, categoryId: CAT.ben }, { nome: 'VT', valorMensal: 200, categoryId: null }] }]))
  guarda(c2.lancamentos)
  t(c2.lancamentos.filter(l => l.beneficio === 'VR').every(l => l.categoryId === CAT.ben), 'benefício com natureza própria vence a exceção')
  t(c2.lancamentos.filter(l => l.beneficio === 'VT').every(l => l.categoryId === CAT.ben2), 'benefício sem natureza própria usa a exceção da pessoa')

  // (d) natureza fora das válidas
  const d = montarFolha(quadro([{ nome: 'Maria Silva' }], { mapa: { ...mapaCheio, salario: 'cat-pai-invalida' } }))
  t(d.recusas.length === 1 && d.recusas[0].motivo === 'Maria Silva: Salário sem natureza válida', `recusa única: ${JSON.stringify(d.recusas.map(r => r.motivo))}`)
  t(d.lancamentos.length > 0 && d.lancamentos.every(l => l.componente !== 'salario'), 'o resto ainda vem para a prévia')
  const d2 = montarFolha(quadro([{}], { mapa: {} }))
  t(d2.recusas.length > 1 && d2.recusas.some(r => r.motivo === 'Ana: Salário sem natureza válida') && d2.lancamentos.length === 0, 'mapa vazio: uma recusa por componente, nenhum lançamento')

  // (e) UJ sem regime
  const e = montarFolha(quadro([{ nome: 'Beto' }], { unidades: new Map([['uj-1', { ...UJ_LP, regime: null, nome: 'Filial Sul' }]]) }))
  t(e.recusas.length === 1 && e.recusas[0].motivo === 'Beto: a unidade jurídica Filial Sul não tem regime tributário', `regime ausente: ${e.recusas[0]?.motivo}`)

  // (f) sem alocação
  const f = montarFolha(quadro([{ nome: 'Carla' }]))
  guarda(f.lancamentos)
  t(f.avisos.length === 1 && f.avisos[0] === 'Carla sem centro de custo e unidade de negócio', `aviso: ${JSON.stringify(f.avisos)}`)
  t(f.lancamentos.length > 0 && f.lancamentos.every(l => l.costCenterId === null && l.businessUnitId === null && l.alocacao === 0), 'CC/UEN nulos')

  // descrição
  t(f.lancamentos.find(l => l.componente === 'salario')!.descricao === 'Folha · Carla · Salário', 'descrição de componente')
  t(c.lancamentos.find(l => l.componente === 'beneficios')!.descricao === 'Folha · Ana · VR', 'descrição de benefício = nome do benefício')
  const descEnc = (sobre: 'decimo_terceiro' | 'terco_ferias', parte: 'patronal' | 'fgts') =>
    f.lancamentos.find(l => l.encargo?.sobre === sobre && l.encargo.parte === parte)?.descricao
  t(descEnc('decimo_terceiro', 'patronal') === 'Folha · Carla · Encargos s/ 13º — INSS/RAT/terceiros'
    && descEnc('decimo_terceiro', 'fgts') === 'Folha · Carla · Encargos s/ 13º — FGTS'
    && descEnc('terco_ferias', 'patronal') === 'Folha · Carla · Encargos s/ férias — INSS/RAT/terceiros'
    && descEnc('terco_ferias', 'fgts') === 'Folha · Carla · Encargos s/ férias — FGTS', 'quatro descrições distintas dos encargos')

  // (g) nomeDaPessoa
  t(nomeDaPessoa({ nome: 'Maria Silva', isVaga: false, cargo: null }) === 'Maria Silva', 'nome da pessoa')
  t(nomeDaPessoa({ nome: null, isVaga: true, cargo: 'Vendedor' }) === 'Vaga · Vendedor', 'vaga com cargo')
  t(nomeDaPessoa({ nome: null, isVaga: true, cargo: null }) === 'Vaga', 'vaga sem cargo')
}

// ═══ guarda geral ════════════════════════════════════════════════════════════
console.log('\n── todas as linhas ──')
{
  const ruins = TODAS.filter(l => !(l.centavos > 0) || !Number.isInteger(l.centavos))
  t(TODAS.length > 0 && ruins.length === 0,
    `todo lançamento de todos os casos é inteiro e > 0 (${TODAS.length} linhas${ruins.length ? `; ruins: ${JSON.stringify(ruins.slice(0, 3))}` : ''})`)
}

console.log(`\n${ok} OK, ${falhas} falha(s)`)
process.exit(falhas ? 1 : 0)
