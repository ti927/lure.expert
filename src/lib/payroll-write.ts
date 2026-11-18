// A escrita da folha no orçamento: o quadro de pessoal, o mapa de naturezas,
// a prévia, a geração das séries, a cópia do quadro entre versões e o aviso de
// desatualização.
//
// SERVER-ONLY: importa `db`. Fora de 'use server' para ser exercitável direto
// contra o banco (`scripts/verify-payroll-write.ts`), como o resto do orçamento.
//
// ─── Duas regras que valem para o arquivo inteiro ────────────────────────────
//
// 1. NENHUM id é confiado sozinho. Toda função recebe `organizationId` e confere
//    que a versão (e a pessoa, a UJ, o centro de custo, a natureza...) pertence
//    a ela antes de escrever; toda linha filha (alocação, benefício) recebe o
//    `organization_id` do PARÂMETRO, nunca de uma leitura.
// 2. Erro é `{ error: string }`, nunca exceção para o usuário.
//
// A folha gerada vira `budget_series` com source = 'folha' e ocorrências
// gravadas DIRETAMENTE (não passa por `expandSeries`): o `cash_lag_days` fixo
// da série não expressa "dia 5 do mês seguinte" nem "20 de dezembro". A série
// é agrupador e rótulo. Ver spec 2026-11-18-folha-no-orcamento, seções 6–8.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import {
  agentEvents, budgetEntries, budgetPayrollSettings, budgetPeople, budgetPeopleAllocations,
  budgetPeopleBenefits, budgetSeries, budgetVersions, businessUnits, categories, contacts,
  costCenters, legalEntities, payrollCategoryMap,
} from '@/db/schema'
import { ENTRY_INSERT_CHUNK, type BudgetTx } from './budget-scope'
import { calcularPessoa, custoAnual, RegimeAusente } from './payroll-calc'
import { montarFolha, nomeDaPessoa, type LancamentoFolha, type RecusaFolha } from './payroll-build'
import {
  CODIGO_PADRAO, COMPONENTES, ROTULO_COMPONENTE, pessoaSchema, parametrosVersaoSchema, paraPessoaCalc,
  paraParametrosVersaoCalc,
  type Componente, type ModoProvisao, type ParametrosUJ, type ParametrosVersaoCalc, type PessoaCalc,
  type PessoaInput, type ParametrosVersaoInput, type Regime, type Vinculo,
} from './payroll-types'

// O guarda "lançamento da folha é só leitura" mora em arquivo próprio para
// `budget-scope` chamá-lo sem ciclo de importação; é reexportado daqui.
export { RECUSA_FOLHA, recusaSeFolha } from './payroll-guard'

type Exec = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>
type Erro = { error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VERSAO_NAO_ENCONTRADA = 'Versão de orçamento não encontrada.'
const VERSAO_ARQUIVADA = 'Esta versão está arquivada e não pode ser alterada. Duplique-a para trabalhar em cima dela.'

/** Centavos inteiros → texto de `numeric(15,2)`, sem passar por ponto flutuante. */
function centavosParaTexto(c: number): string {
  const sinal = c < 0 ? '-' : ''
  const abs = Math.abs(c)
  return `${sinal}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Fração do banco → pontos percentuais da entrada (0.05 → 5), sem o ruído do float. */
const paraPontos = (f: number | null) => (f === null ? null : Math.round(f * 1e6) / 1e4)
const numOuNull = (v: string | null) => (v === null ? null : Number(v))
/** O alvo de compilação é ES5: sem spread de Set/Map. */
const unicos = <T>(xs: T[]): T[] => Array.from(new Set(xs))

// ═══════════════════════════════════════════════════════════════════════════════
// VERSÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A versão é da organização e não está arquivada — com a linha TRAVADA até o
 * fim da transação, para duas gerações simultâneas não se intercalarem.
 * Mesmas mensagens de `carregarVersaoEditavel` (budget-write.ts), que usa o
 * `db` global e por isso não serve dentro do `tx`.
 */
async function versaoEditavel(exec: Exec, organizationId: string, versionId: string): Promise<Erro | { fiscalYear: number }> {
  if (!UUID.test(versionId)) return { error: VERSAO_NAO_ENCONTRADA }
  const r = await exec.execute<{ fiscal_year: number; status: string }>(sql`
    SELECT fiscal_year, status FROM budget_versions
     WHERE id = ${versionId}::uuid AND organization_id = ${organizationId}::uuid
       FOR UPDATE`)
  const v = r[0]
  if (!v) return { error: VERSAO_NAO_ENCONTRADA }
  if (v.status === 'arquivado') return { error: VERSAO_ARQUIVADA }
  return { fiscalYear: Number(v.fiscal_year) }
}

/** Marca que o quadro mudou (cria os parâmetros da versão se ainda não há). */
async function tocarQuadro(exec: Exec, organizationId: string, versionId: string) {
  await exec.insert(budgetPayrollSettings)
    .values({ organizationId, versionId })
    .onConflictDoUpdate({ target: budgetPayrollSettings.versionId, set: { quadroAlteradoEm: sql`now()` } })
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEITURA DO QUADRO
// ═══════════════════════════════════════════════════════════════════════════════

type PessoaCarregada = PessoaCalc & { id: string; observacao: string | null }

type QuadroCarregado = {
  versao: { id: string; nome: string; exercicio: number; status: string }
  settings: typeof budgetPayrollSettings.$inferSelect | null
  parametros: ParametrosVersaoCalc
  pessoas: PessoaCarregada[]
  unidades: Map<string, ParametrosUJ & { nome: string }>
}

async function carregarQuadro(exec: Exec, organizationId: string, versionId: string): Promise<Erro | QuadroCarregado> {
  if (!UUID.test(versionId)) return { error: VERSAO_NAO_ENCONTRADA }
  const [versao] = await exec
    .select({ id: budgetVersions.id, nome: budgetVersions.name, exercicio: budgetVersions.fiscalYear, status: budgetVersions.status })
    .from(budgetVersions)
    .where(and(eq(budgetVersions.id, versionId), eq(budgetVersions.organizationId, organizationId)))
    .limit(1)
  if (!versao) return { error: VERSAO_NAO_ENCONTRADA }

  const [settings] = await exec.select().from(budgetPayrollSettings)
    .where(and(eq(budgetPayrollSettings.versionId, versionId), eq(budgetPayrollSettings.organizationId, organizationId)))
    .limit(1)

  const linhas = await exec.select().from(budgetPeople)
    .where(and(eq(budgetPeople.versionId, versionId), eq(budgetPeople.organizationId, organizationId)))
    .orderBy(asc(budgetPeople.createdAt), asc(budgetPeople.id))
  const ids = linhas.map(p => p.id)

  const alocs = ids.length === 0 ? [] : await exec.select().from(budgetPeopleAllocations)
    .where(and(inArray(budgetPeopleAllocations.personId, ids), eq(budgetPeopleAllocations.organizationId, organizationId)))
    .orderBy(asc(budgetPeopleAllocations.ordem))
  const bens = ids.length === 0 ? [] : await exec.select().from(budgetPeopleBenefits)
    .where(and(inArray(budgetPeopleBenefits.personId, ids), eq(budgetPeopleBenefits.organizationId, organizationId)))
    .orderBy(asc(budgetPeopleBenefits.ordem), asc(budgetPeopleBenefits.createdAt))

  const ujIds = unicos(linhas.map(p => p.legalEntityId).filter((x): x is string => !!x))
  const ujs = ujIds.length === 0 ? [] : await exec.select().from(legalEntities)
    .where(and(inArray(legalEntities.id, ujIds), eq(legalEntities.organizationId, organizationId)))
  const unidades = new Map(ujs.map(u => [u.id, {
    nome: u.name,
    regime: (u.regimeTributario as Regime | null) ?? null,
    anexoIV: u.simplesAnexoIv,
    inss: Number(u.aliquotaInssPatronal),
    ratFap: Number(u.aliquotaRatFap),
    terceiros: Number(u.aliquotaTerceiros),
    fgts: Number(u.aliquotaFgts),
  }]))

  const pessoas: PessoaCarregada[] = linhas.map(p => ({
    id: p.id,
    nome: p.nome,
    isVaga: p.isVaga,
    cargo: p.cargo,
    vinculo: p.vinculo as Vinculo,
    legalEntityId: p.legalEntityId,
    contactId: p.contactId,
    valorBase: Number(p.valorBase),
    outrosProventos: Number(p.outrosProventos),
    mesEntrada: p.mesEntrada,
    mesSaida: p.mesSaida,
    mesesPj: p.mesesPj ?? null,
    mesFerias: p.mesFerias,
    diaPagamentoPj: p.diaPagamentoPj,
    aplicaDissidio: p.aplicaDissidio,
    reajusteMes: p.reajusteMes,
    reajustePct: numOuNull(p.reajustePct),
    naturezas: (p.naturezas ?? {}) as Partial<Record<Componente, string>>,
    observacao: p.observacao,
    alocacoes: alocs.filter(a => a.personId === p.id)
      .map(a => ({ costCenterId: a.costCenterId, businessUnitId: a.businessUnitId, percentual: Number(a.percentual) })),
    beneficios: bens.filter(b => b.personId === p.id)
      .map(b => ({ nome: b.nome, valorMensal: Number(b.valorMensal), categoryId: b.categoryId })),
  }))

  const parametros: ParametrosVersaoCalc = settings
    ? { modoProvisao: settings.modoProvisao as ModoProvisao, dissidioMes: settings.dissidioMes, dissidioPct: numOuNull(settings.dissidioPct) }
    : paraParametrosVersaoCalc(parametrosVersaoSchema.parse({}))

  return { versao, settings: settings ?? null, parametros, pessoas, unidades }
}

/** As linhas calculadas da pessoa; nulo quando falta regime (a prévia recusa nomeando). */
function linhasDaPessoa(q: QuadroCarregado, p: PessoaCarregada) {
  const uj = p.legalEntityId ? q.unidades.get(p.legalEntityId) ?? null : null
  try {
    return calcularPessoa(p, q.parametros, uj, q.versao.exercicio)
  } catch (e) {
    if (e instanceof RegimeAusente) return null
    throw e
  }
}

export type PessoaDoQuadro = {
  id: string
  /** Como aparece nos lançamentos: o nome, ou "Vaga · <cargo>". */
  nomeExibido: string
  nome: string | null
  isVaga: boolean
  vinculo: Vinculo
  cargo: string | null
  legalEntityId: string | null
  contactId: string | null
  valorBase: number
  outrosProventos: number
  mesEntrada: number
  mesSaida: number
  mesesPj: number[] | null
  mesFerias: number | null
  diaPagamentoPj: number
  aplicaDissidio: boolean
  reajusteMes: number | null
  /** Pontos percentuais (5 = 5%), como na entrada. */
  reajustePct: number | null
  naturezas: Partial<Record<Componente, string>>
  observacao: string | null
  alocacoes: { costCenterId: string | null; businessUnitId: string | null; percentual: number }[]
  beneficios: { nome: string; valorMensal: number; categoryId: string | null }[]
  /** Custo do ano em centavos; nulo quando a unidade jurídica não tem regime. */
  custoAnualCentavos: number | null
}

export type QuadroDaVersao = {
  versao: { id: string; nome: string; exercicio: number; status: string; editavel: boolean }
  settings: {
    modoProvisao: ModoProvisao
    dissidioMes: number | null
    /** Pontos percentuais (5 = 5%). */
    dissidioPct: number | null
    /** true = a versão ainda não tem parâmetros gravados; estes são os padrões. */
    virtual: boolean
  }
  pessoas: PessoaDoQuadro[]
  desatualizado: boolean
  geradoEm: string | null
}

export async function lerQuadro(exec: Exec, organizationId: string, versionId: string): Promise<QuadroDaVersao | Erro> {
  const q = await carregarQuadro(exec, organizationId, versionId)
  if ('error' in q) return q

  const pessoas: PessoaDoQuadro[] = q.pessoas.map(p => {
    const linhas = linhasDaPessoa(q, p)
    return {
      ...p,
      nomeExibido: nomeDaPessoa(p),
      reajustePct: paraPontos(p.reajustePct),
      custoAnualCentavos: linhas === null ? null : custoAnual(linhas),
    }
  })

  return {
    versao: { ...q.versao, editavel: q.versao.status !== 'arquivado' },
    settings: {
      modoProvisao: q.parametros.modoProvisao,
      dissidioMes: q.parametros.dissidioMes,
      dissidioPct: paraPontos(q.parametros.dissidioPct),
      virtual: q.settings === null,
    },
    pessoas,
    desatualizado: await quadroDesatualizado(exec, organizationId, versionId),
    geradoEm: q.settings?.geradoEm ? q.settings.geradoEm.toISOString() : null,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ESCRITA DO QUADRO
// ═══════════════════════════════════════════════════════════════════════════════

/** Quantos dos `ids` existem na tabela DESTA organização — um a um, sem confiar no id. */
async function contarDaOrganizacao(
  exec: Exec,
  tabela: typeof costCenters | typeof businessUnits | typeof legalEntities | typeof contacts,
  ids: string[],
  organizationId: string,
): Promise<number> {
  if (ids.length === 0) return 0
  const r = await exec.select({ id: tabela.id }).from(tabela)
    .where(and(inArray(tabela.id, ids), eq(tabela.organizationId, organizationId)))
  return r.length
}

/** As naturezas que podem receber orçado: Natureza Filho ativa desta organização. */
async function naturezasFilhoAtivas(exec: Exec, organizationId: string, ids?: string[]) {
  if (ids && ids.length === 0) return new Map<string, { nome: string; code: string }>()
  const r = await exec.select({ id: categories.id, nome: categories.name, code: categories.code }).from(categories)
    .where(and(
      eq(categories.organizationId, organizationId),
      eq(categories.isActive, true),
      isNotNull(categories.parentId),
      ...(ids ? [inArray(categories.id, ids)] : []),
    ))
  return new Map(r.map(c => [c.id, { nome: c.nome, code: c.code }]))
}

/**
 * Grava a pessoa (cria sem `personId`, edita com). Alocações e benefícios são
 * SUBSTITUÍDOS inteiros — a tela manda a lista toda, e conciliar linha a linha
 * não compraria nada.
 */
export async function salvarPessoa(
  tx: BudgetTx,
  organizationId: string,
  userId: string,
  versionId: string,
  input: PessoaInput,
  personId?: string,
): Promise<{ id: string } | Erro> {
  void userId // a autoria fica para quando o quadro ganhar histórico; a assinatura já a recebe
  const parsed = pessoaSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const v = parsed.data
  const entrada = v.mesEntrada ?? 1

  if (v.vinculo === 'pj' && v.mesesPj && !v.mesesPj.some(m => m >= entrada && m <= v.mesSaida)) {
    return { error: `${nomeDaPessoa(v)}: nenhum mês a lançar — os meses de pagamento do PJ ficam fora do período entre a entrada e a saída.` }
  }

  const versao = await versaoEditavel(tx, organizationId, versionId)
  if ('error' in versao) return versao

  // Toda referência tem de ser desta organização.
  if (v.legalEntityId && await contarDaOrganizacao(tx, legalEntities, [v.legalEntityId], organizationId) !== 1) {
    return { error: 'Unidade jurídica não encontrada nesta organização.' }
  }
  if (v.contactId && await contarDaOrganizacao(tx, contacts, [v.contactId], organizationId) !== 1) {
    return { error: 'Contato não encontrado nesta organização.' }
  }
  const ccs = unicos(v.alocacoes.map(a => a.costCenterId).filter((x): x is string => !!x))
  if (await contarDaOrganizacao(tx, costCenters, ccs, organizationId) !== ccs.length) {
    return { error: 'Centro de custo não encontrado nesta organização.' }
  }
  const ues = unicos(v.alocacoes.map(a => a.businessUnitId).filter((x): x is string => !!x))
  if (await contarDaOrganizacao(tx, businessUnits, ues, organizationId) !== ues.length) {
    return { error: 'Unidade de negócio não encontrada nesta organização.' }
  }
  const naturezasPedidas = unicos([
    ...Object.values(v.naturezas).filter((x): x is string => !!x),
    ...v.beneficios.map(b => b.categoryId).filter((x): x is string => !!x),
  ])
  if ((await naturezasFilhoAtivas(tx, organizationId, naturezasPedidas)).size !== naturezasPedidas.length) {
    return { error: 'Natureza não encontrada nesta organização, inativa ou não é Natureza Filho.' }
  }

  const calc = paraPessoaCalc(v)
  const colunas = {
    nome: calc.nome,
    isVaga: calc.isVaga,
    vinculo: calc.vinculo,
    cargo: calc.cargo,
    legalEntityId: calc.legalEntityId,
    contactId: calc.contactId,
    valorBase: calc.valorBase.toFixed(2),
    outrosProventos: calc.outrosProventos.toFixed(2),
    mesEntrada: calc.mesEntrada,
    mesSaida: calc.mesSaida,
    mesesPj: calc.mesesPj,
    mesFerias: calc.mesFerias,
    diaPagamentoPj: calc.diaPagamentoPj,
    aplicaDissidio: calc.aplicaDissidio,
    reajusteMes: calc.reajusteMes,
    reajustePct: calc.reajustePct === null ? null : String(calc.reajustePct),
    naturezas: calc.naturezas as Record<string, string>,
    observacao: v.observacao,
  }

  let id: string
  if (personId) {
    if (!UUID.test(personId)) return { error: 'Pessoa não encontrada nesta versão.' }
    const r = await tx.update(budgetPeople).set(colunas)
      .where(and(eq(budgetPeople.id, personId), eq(budgetPeople.organizationId, organizationId), eq(budgetPeople.versionId, versionId)))
      .returning({ id: budgetPeople.id })
    if (r.length === 0) return { error: 'Pessoa não encontrada nesta versão.' }
    id = r[0].id
    await tx.delete(budgetPeopleAllocations)
      .where(and(eq(budgetPeopleAllocations.personId, id), eq(budgetPeopleAllocations.organizationId, organizationId)))
    await tx.delete(budgetPeopleBenefits)
      .where(and(eq(budgetPeopleBenefits.personId, id), eq(budgetPeopleBenefits.organizationId, organizationId)))
  } else {
    const [r] = await tx.insert(budgetPeople).values({ organizationId, versionId, ...colunas }).returning({ id: budgetPeople.id })
    id = r.id
  }

  if (v.alocacoes.length > 0) {
    await tx.insert(budgetPeopleAllocations).values(v.alocacoes.map((a, ordem) => ({
      organizationId, personId: id, costCenterId: a.costCenterId, businessUnitId: a.businessUnitId,
      percentual: a.percentual.toFixed(2), ordem,
    })))
  }
  if (v.beneficios.length > 0) {
    await tx.insert(budgetPeopleBenefits).values(v.beneficios.map((b, ordem) => ({
      organizationId, personId: id, nome: b.nome, valorMensal: b.valorMensal.toFixed(2), categoryId: b.categoryId, ordem,
    })))
  }

  await tocarQuadro(tx, organizationId, versionId)
  return { id }
}

export async function apagarPessoa(
  tx: BudgetTx, organizationId: string, versionId: string, personId: string,
): Promise<{ ok: true } | Erro> {
  const versao = await versaoEditavel(tx, organizationId, versionId)
  if ('error' in versao) return versao
  if (!UUID.test(personId)) return { error: 'Pessoa não encontrada nesta versão.' }
  const r = await tx.delete(budgetPeople)
    .where(and(eq(budgetPeople.id, personId), eq(budgetPeople.organizationId, organizationId), eq(budgetPeople.versionId, versionId)))
    .returning({ id: budgetPeople.id })
  if (r.length === 0) return { error: 'Pessoa não encontrada nesta versão.' }
  await tocarQuadro(tx, organizationId, versionId)
  return { ok: true }
}

/** Modo de 13º/férias e dissídio da versão (entrada em pontos percentuais). */
export async function salvarParametrosVersao(
  tx: BudgetTx, organizationId: string, versionId: string, input: ParametrosVersaoInput,
): Promise<{ ok: true } | Erro> {
  const parsed = parametrosVersaoSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const versao = await versaoEditavel(tx, organizationId, versionId)
  if ('error' in versao) return versao

  const p = paraParametrosVersaoCalc(parsed.data)
  const colunas = {
    modoProvisao: p.modoProvisao,
    dissidioMes: p.dissidioMes,
    dissidioPct: p.dissidioPct === null ? null : String(p.dissidioPct),
  }
  // O gatilho move `updated_at`, e é ele que `quadroDesatualizado` compara.
  await tx.insert(budgetPayrollSettings).values({ organizationId, versionId, ...colunas })
    .onConflictDoUpdate({ target: budgetPayrollSettings.versionId, set: colunas })
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAPA DE NATUREZAS
// ═══════════════════════════════════════════════════════════════════════════════

async function mapaGravado(exec: Exec, organizationId: string): Promise<Partial<Record<Componente, string>>> {
  const r = await exec.select({ componente: payrollCategoryMap.componente, categoryId: payrollCategoryMap.categoryId })
    .from(payrollCategoryMap).where(eq(payrollCategoryMap.organizationId, organizationId))
  return Object.fromEntries(r.map(m => [m.componente, m.categoryId])) as Partial<Record<Componente, string>>
}

/** Natureza Filho ativa com o código de `CODIGO_PADRAO`, por componente. */
async function sugestoes(exec: Exec, organizationId: string): Promise<Map<Componente, { id: string; code: string; nome: string }>> {
  const codigos = unicos(Object.values(CODIGO_PADRAO).filter((x): x is string => !!x))
  const r = await exec.select({ id: categories.id, code: categories.code, nome: categories.name }).from(categories)
    .where(and(
      eq(categories.organizationId, organizationId), eq(categories.isActive, true),
      isNotNull(categories.parentId), inArray(categories.code, codigos),
    ))
  const porCodigo = new Map(r.map(c => [c.code, c]))
  const out = new Map<Componente, { id: string; code: string; nome: string }>()
  for (const c of COMPONENTES) {
    const cod = CODIGO_PADRAO[c]
    const cat = cod ? porCodigo.get(cod) : undefined
    if (cat) out.set(c, cat)
  }
  return out
}

/**
 * O mapa da organização. Sem linha gravada, SUGERE a Natureza Filho ativa do
 * plano padrão (`sugerida: true`) — sugestão não vale para gerar até ser salva.
 */
export async function lerMapa(
  exec: Exec, organizationId: string,
): Promise<{ componente: Componente; categoryId: string | null; sugerida: boolean }[]> {
  const [gravado, sug] = await Promise.all([mapaGravado(exec, organizationId), sugestoes(exec, organizationId)])
  return COMPONENTES.map(componente => {
    const g = gravado[componente]
    if (g) return { componente, categoryId: g, sugerida: false }
    const s = sug.get(componente)
    return s ? { componente, categoryId: s.id, sugerida: true } : { componente, categoryId: null, sugerida: false }
  })
}

const mapaSchema = z.partialRecord(z.enum(COMPONENTES), z.string().regex(UUID, 'Natureza inválida').nullable())

/** Grava o mapa (só os componentes informados); `null` apaga a linha do componente. */
export async function salvarMapa(
  tx: BudgetTx, organizationId: string, mapa: Partial<Record<Componente, string | null>>,
): Promise<{ ok: true } | Erro> {
  const parsed = mapaSchema.safeParse(mapa)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const entradas = Object.entries(parsed.data) as [Componente, string | null | undefined][]

  const ids = unicos(entradas.map(([, id]) => id).filter((x): x is string => !!x))
  const validas = await naturezasFilhoAtivas(tx, organizationId, ids)
  const invalida = entradas.find(([, id]) => id && !validas.has(id))
  if (invalida) {
    return { error: `${ROTULO_COMPONENTE[invalida[0]]}: natureza não encontrada nesta organização, inativa ou não é Natureza Filho.` }
  }

  for (const [componente, categoryId] of entradas) {
    if (categoryId === undefined) continue
    if (categoryId === null) {
      await tx.delete(payrollCategoryMap)
        .where(and(eq(payrollCategoryMap.organizationId, organizationId), eq(payrollCategoryMap.componente, componente)))
    } else {
      await tx.insert(payrollCategoryMap).values({ organizationId, componente, categoryId })
        .onConflictDoUpdate({
          target: [payrollCategoryMap.organizationId, payrollCategoryMap.componente],
          set: { categoryId, updatedAt: sql`now()` },
        })
    }
  }
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRÉVIA E GERAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

export type PreviaFolha = {
  /** Havendo qualquer uma, a geração é recusada inteira. */
  recusas: RecusaFolha[]
  avisos: string[]
  totalCentavos: number
  /** `mes` = competência YYYY-MM. */
  porComponenteMes: { componente: Componente; mes: string; centavos: number }[]
  porPessoa: { personId: string; nome: string; centavos: number }[]
  /** Séries de folha que a geração vai substituir. */
  seriesExistentes: number
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function calcularPrevia(
  exec: Exec, organizationId: string, versionId: string,
): Promise<Erro | { previa: PreviaFolha; lancamentos: LancamentoFolha[] }> {
  const q = await carregarQuadro(exec, organizationId, versionId)
  if ('error' in q) return q

  const [mapa, validas, sug] = await Promise.all([
    mapaGravado(exec, organizationId),
    naturezasFilhoAtivas(exec, organizationId),
    sugestoes(exec, organizationId),
  ])

  const r = montarFolha({
    exercicio: q.versao.exercicio,
    versao: q.parametros,
    pessoas: q.pessoas,
    unidades: q.unidades,
    mapa,
    naturezasValidas: validas,
  })

  // O problema é do MAPA, não da pessoa: dizê-lo uma vez por componente, e
  // não "Maria: Salário sem natureza", "João: Salário sem natureza"... A
  // geração usa só o mapa GRAVADO — a sugestão não vale até salvar.
  const usados = new Set<Componente>()
  for (const p of q.pessoas) {
    for (const l of linhasDaPessoa(q, p) ?? []) {
      if (l.beneficio?.categoryId || p.naturezas[l.componente]) continue
      usados.add(l.componente)
    }
  }
  const idsGravados = Object.values(mapa).filter((x): x is string => !!x)
  const gravadas = idsGravados.length === 0 ? [] : await exec
    .select({ id: categories.id, code: categories.code, nome: categories.name }).from(categories)
    .where(and(eq(categories.organizationId, organizationId), inArray(categories.id, idsGravados)))
  const catGravada = new Map(gravadas.map(c => [c.id, c]))

  const problemas = new Set<Componente>()
  const recusasDoMapa: RecusaFolha[] = []
  for (const c of COMPONENTES) {
    if (!usados.has(c)) continue
    const id = mapa[c]
    if (id && validas.has(id)) continue
    problemas.add(c)
    const rotulo = ROTULO_COMPONENTE[c]
    let motivo: string
    if (!id) {
      const s = sug.get(c)
      motivo = s
        ? `${rotulo}: mapa não gravado — a sugestão ${s.code} · ${s.nome} só vale depois de salvar as naturezas da folha`
        : `${rotulo}: mapa não gravado — escolha a natureza em "Naturezas da folha"`
    } else {
      const cat = catGravada.get(id)
      motivo = cat
        ? `${rotulo}: a natureza ${cat.code} · ${cat.nome} do mapa da folha está arquivada ou não é Natureza Filho`
        : `${rotulo}: a natureza do mapa da folha não existe mais`
    }
    recusasDoMapa.push({ personId: null, pessoa: '', motivo })
  }

  // Tira as recusas por pessoa que são só o eco do problema do mapa.
  const pessoaPorId = new Map(q.pessoas.map(p => [p.id, p]))
  const ecos = Array.from(problemas).map(c => ({ c, prefixo: ROTULO_COMPONENTE[c] }))
  const recusasDaPessoa = r.recusas.filter(rec => {
    const p = rec.personId ? pessoaPorId.get(rec.personId) : undefined
    if (!p) return true
    return !ecos.some(({ c, prefixo }) =>
      !p.naturezas[c] &&
      new RegExp(`^${escapar(rec.pessoa)}: ${escapar(prefixo)}( \\(.*\\))? sem natureza válida$`).test(rec.motivo))
  })

  const porCM = new Map<string, { componente: Componente; mes: string; centavos: number }>()
  const somaPessoa = new Map<string, number>()
  let total = 0
  for (const l of r.lancamentos) {
    total += l.centavos
    const k = `${l.componente}|${l.competencia}`
    const acc = porCM.get(k) ?? { componente: l.componente, mes: l.competencia, centavos: 0 }
    acc.centavos += l.centavos
    porCM.set(k, acc)
    somaPessoa.set(l.personId, (somaPessoa.get(l.personId) ?? 0) + l.centavos)
  }
  const ordemComp = new Map(COMPONENTES.map((c, i) => [c, i]))

  const existentes = await exec.select({ n: sql<number>`count(*)::int` }).from(budgetSeries)
    .where(and(eq(budgetSeries.organizationId, organizationId), eq(budgetSeries.versionId, versionId), eq(budgetSeries.source, 'folha')))

  return {
    lancamentos: r.lancamentos,
    previa: {
      recusas: [...recusasDoMapa, ...recusasDaPessoa],
      avisos: r.avisos,
      totalCentavos: total,
      porComponenteMes: Array.from(porCM.values()).sort((a, b) =>
        ordemComp.get(a.componente)! - ordemComp.get(b.componente)! || a.mes.localeCompare(b.mes)),
      porPessoa: q.pessoas.map(p => ({ personId: p.id, nome: nomeDaPessoa(p), centavos: somaPessoa.get(p.id) ?? 0 })),
      seriesExistentes: Number(existentes[0]?.n ?? 0),
    },
  }
}

/** O que "Gerar folha" gravaria, sem gravar. */
export async function preverFolha(exec: Exec, organizationId: string, versionId: string): Promise<PreviaFolha | Erro> {
  const r = await calcularPrevia(exec, organizationId, versionId)
  return 'error' in r ? r : r.previa
}

/** Séries têm no máximo 12 ocorrências (CHECK de `budget_series`). */
const MAX_OCORRENCIAS = 12

/**
 * Apaga as séries `folha` da versão e grava as novas, na transação do chamador.
 * Recalcula a prévia DENTRO do `tx` (a mostrada na tela pode ter envelhecido)
 * e recusa tudo se houver qualquer recusa.
 */
export async function gerarFolha(
  tx: BudgetTx, organizationId: string, userId: string, versionId: string,
): Promise<{ series: number; entries: number; substituidas: number } | Erro> {
  const versao = await versaoEditavel(tx, organizationId, versionId)
  if ('error' in versao) return versao

  const calc = await calcularPrevia(tx, organizationId, versionId)
  if ('error' in calc) return calc
  if (calc.previa.recusas.length > 0) {
    return { error: `A folha não foi gerada: ${calc.previa.recusas.map(r => r.motivo).join('; ')}.` }
  }

  const apagadas = await tx.execute<{ id: string }>(sql`
    DELETE FROM budget_series
     WHERE organization_id = ${organizationId}::uuid
       AND version_id      = ${versionId}::uuid
       AND source          = 'folha'
    RETURNING id`)

  // Uma série por (pessoa, componente, encargo, benefício, alocação): as quatro
  // séries de encargos s/ 13º e férias e cada benefício saem separadas.
  const grupos = new Map<string, LancamentoFolha[]>()
  for (const l of calc.lancamentos) {
    const k = [l.personId, l.componente, l.encargo?.sobre ?? '', l.encargo?.parte ?? '', l.beneficio ?? '', l.alocacao].join('|')
    const g = grupos.get(k)
    if (g) g.push(l)
    else grupos.set(k, [l])
  }

  const series: (typeof budgetSeries.$inferInsert)[] = []
  const entries: (typeof budgetEntries.$inferInsert)[] = []
  for (const g of Array.from(grupos.values())) {
    g.sort((a, b) => a.competencia.localeCompare(b.competencia) || a.caixa.localeCompare(b.caixa))

    // O 13º (e o FGTS sobre ele) sai em DUAS datas de caixa por competência —
    // 24 ocorrências num grupo, e a série aceita no máximo 12. Parte-se pela
    // PARCELA (a posição da data de caixa dentro da competência): cada série
    // fica com uma ocorrência por mês, "1ª parcela" e "2ª parcela".
    const porParcela: LancamentoFolha[][] = []
    let compAnterior = ''
    let posicao = 0
    for (const l of g) {
      posicao = l.competencia === compAnterior ? posicao + 1 : 0
      compAnterior = l.competencia
      ;(porParcela[posicao] ??= []).push(l)
    }
    const varias = porParcela.length > 1

    // Com uma ocorrência por mês do exercício a parcela cabe em 12; o corte em
    // `MAX_OCORRENCIAS` é só rede de segurança contra o CHECK.
    const blocos = porParcela.flatMap((daParcela, parcela) => {
      const out: { parcela: number; parte: LancamentoFolha[] }[] = []
      for (let i = 0; i < daParcela.length; i += MAX_OCORRENCIAS) {
        out.push({ parcela, parte: daParcela.slice(i, i + MAX_OCORRENCIAS) })
      }
      return out
    })

    for (const { parcela, parte } of blocos) {
      const f = parte[0]
      const sufixo = varias ? ` · ${parcela + 1}ª parcela` : ''
      const id = randomUUID()
      series.push({
        id,
        organizationId,
        versionId,
        description: f.descricao + sufixo,
        direction: 'outflow',
        categoryId: f.categoryId,
        costCenterId: f.costCenterId,
        businessUnitId: f.businessUnitId,
        legalEntityId: f.legalEntityId,
        contactId: f.contactId,
        startMonth: `${f.competencia}-01`,
        occurrences: parte.length,
        intervalMonths: 1,
        dayOfMonth: 1,
        cashLagDays: 0,
        amountMode: 'sazonal',
        baseAmount: null,
        totalAmount: null,
        adjustmentRate: null,
        adjustmentEvery: 1,
        seasonalAmounts: parte.map(l => l.centavos / 100),
        source: 'folha',
        createdByUserId: userId,
        metadata: {
          folha: {
            personId: f.personId,
            componente: f.componente,
            alocacao: f.alocacao,
            ...(f.encargo ? { encargo: f.encargo } : {}),
            ...(f.beneficio ? { beneficio: f.beneficio } : {}),
            ...(varias ? { parcela: parcela + 1 } : {}),
          },
        },
      })
      parte.forEach((l, j) => entries.push({
        organizationId,
        versionId,
        seriesId: id,
        sequence: j + 1,
        description: l.descricao + sufixo,
        direction: 'outflow',
        categoryId: l.categoryId,
        costCenterId: l.costCenterId,
        businessUnitId: l.businessUnitId,
        legalEntityId: l.legalEntityId,
        contactId: l.contactId,
        competenceDate: `${l.competencia}-01`,
        cashDate: l.caixa,
        amount: centavosParaTexto(l.centavos),
      }))
    }
  }

  for (let i = 0; i < series.length; i += ENTRY_INSERT_CHUNK) {
    await tx.insert(budgetSeries).values(series.slice(i, i + ENTRY_INSERT_CHUNK))
  }
  for (let i = 0; i < entries.length; i += ENTRY_INSERT_CHUNK) {
    await tx.insert(budgetEntries).values(entries.slice(i, i + ENTRY_INSERT_CHUNK))
  }

  // `now()` é o início da transação — o mesmo instante que o gatilho grava em
  // `updated_at` desta linha, então a própria geração não a marca desatualizada.
  await tx.insert(budgetPayrollSettings).values({ organizationId, versionId, geradoEm: sql`now()` })
    .onConflictDoUpdate({ target: budgetPayrollSettings.versionId, set: { geradoEm: sql`now()` } })

  await tx.insert(agentEvents).values({
    organizationId,
    type: 'folha.gerada',
    entityType: 'budget_version',
    entityId: versionId,
    payload: {
      versionId,
      userId,
      series: series.length,
      ocorrencias: entries.length,
      substituidas: apagadas.length,
      totalCentavos: calc.previa.totalCentavos,
    },
  })

  return { series: series.length, entries: entries.length, substituidas: apagadas.length }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CÓPIA E DESATUALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Substitui o quadro do destino (pessoas, alocações, benefícios e parâmetros)
 * pelo da origem. Não gera: as séries do destino ficam como estão, e o aviso de
 * desatualização passa a aparecer.
 */
export async function copiarQuadro(
  tx: BudgetTx, organizationId: string, userId: string, origemVersionId: string, destinoVersionId: string,
): Promise<{ pessoas: number } | Erro> {
  if (origemVersionId === destinoVersionId) return { error: 'Escolha uma versão diferente desta para copiar o quadro.' }
  const destino = await versaoEditavel(tx, organizationId, destinoVersionId)
  if ('error' in destino) return destino
  const origem = await carregarQuadro(tx, organizationId, origemVersionId)
  if ('error' in origem) return { error: 'Versão de origem não encontrada.' }

  await tx.delete(budgetPeople)
    .where(and(eq(budgetPeople.versionId, destinoVersionId), eq(budgetPeople.organizationId, organizationId)))

  const novos = origem.pessoas.map(p => ({ id: randomUUID(), p }))
  if (novos.length > 0) {
    await tx.insert(budgetPeople).values(novos.map(({ id, p }) => ({
      id,
      organizationId,
      versionId: destinoVersionId,
      nome: p.nome,
      isVaga: p.isVaga,
      vinculo: p.vinculo,
      cargo: p.cargo,
      legalEntityId: p.legalEntityId,
      contactId: p.contactId,
      valorBase: p.valorBase.toFixed(2),
      outrosProventos: p.outrosProventos.toFixed(2),
      mesEntrada: p.mesEntrada,
      mesSaida: p.mesSaida,
      mesesPj: p.mesesPj,
      mesFerias: p.mesFerias,
      diaPagamentoPj: p.diaPagamentoPj,
      aplicaDissidio: p.aplicaDissidio,
      reajusteMes: p.reajusteMes,
      reajustePct: p.reajustePct === null ? null : String(p.reajustePct),
      naturezas: p.naturezas as Record<string, string>,
      observacao: p.observacao,
    })))
    const alocs = novos.flatMap(({ id, p }) => p.alocacoes.map((a, ordem) => ({
      organizationId, personId: id, costCenterId: a.costCenterId, businessUnitId: a.businessUnitId,
      percentual: a.percentual.toFixed(2), ordem,
    })))
    if (alocs.length > 0) await tx.insert(budgetPeopleAllocations).values(alocs)
    const bens = novos.flatMap(({ id, p }) => p.beneficios.map((b, ordem) => ({
      organizationId, personId: id, nome: b.nome, valorMensal: b.valorMensal.toFixed(2), categoryId: b.categoryId, ordem,
    })))
    if (bens.length > 0) await tx.insert(budgetPeopleBenefits).values(bens)
  }

  const params = {
    modoProvisao: origem.parametros.modoProvisao,
    dissidioMes: origem.parametros.dissidioMes,
    dissidioPct: origem.parametros.dissidioPct === null ? null : String(origem.parametros.dissidioPct),
    quadroAlteradoEm: sql`now()`,
  }
  await tx.insert(budgetPayrollSettings).values({ organizationId, versionId: destinoVersionId, ...params })
    .onConflictDoUpdate({ target: budgetPayrollSettings.versionId, set: params })

  await tx.insert(agentEvents).values({
    organizationId,
    type: 'folha.quadro_copiado',
    entityType: 'budget_version',
    entityId: destinoVersionId,
    payload: { origemVersionId, destinoVersionId, userId, pessoas: novos.length },
  })

  return { pessoas: novos.length }
}

/**
 * "O quadro mudou desde a última geração": nunca gerada com pessoas, ou algo
 * mexido depois de `gerado_em` — o quadro, os parâmetros da versão, o mapa da
 * organização ou as unidades jurídicas que o quadro usa. Comparação ESTRITA:
 * a própria geração grava `gerado_em` e o `updated_at` da linha no mesmo
 * `now()`.
 */
export async function quadroDesatualizado(exec: Exec, organizationId: string, versionId: string): Promise<boolean> {
  if (!UUID.test(versionId)) return false
  // SQL cru com aliases próprios: correlações dentro de subconsulta não passam
  // por `${tabela.coluna}` do Drizzle (ver lib/sql-dimensions.ts).
  const r = await exec.execute<{ pessoas: number; gerado: boolean | null; mudou: boolean | null }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM budget_people bp
        WHERE bp.organization_id = ${organizationId}::uuid AND bp.version_id = ${versionId}::uuid) AS pessoas,
      (SELECT s.gerado_em IS NOT NULL FROM budget_payroll_settings s
        WHERE s.organization_id = ${organizationId}::uuid AND s.version_id = ${versionId}::uuid) AS gerado,
      (SELECT s.quadro_alterado_em > s.gerado_em
           OR s.updated_at > s.gerado_em
           OR COALESCE((SELECT MAX(m.updated_at) FROM payroll_category_map m
                         WHERE m.organization_id = ${organizationId}::uuid) > s.gerado_em, false)
           OR COALESCE((SELECT MAX(le.updated_at) FROM legal_entities le
                         WHERE le.organization_id = ${organizationId}::uuid
                           AND le.id IN (SELECT bp2.legal_entity_id FROM budget_people bp2
                                          WHERE bp2.organization_id = ${organizationId}::uuid
                                            AND bp2.version_id = ${versionId}::uuid)) > s.gerado_em, false)
         FROM budget_payroll_settings s
        WHERE s.organization_id = ${organizationId}::uuid AND s.version_id = ${versionId}::uuid) AS mudou`)
  const row = r[0]
  if (!row) return false
  if (!row.gerado) return Number(row.pessoas) > 0
  return row.mudou === true
}
