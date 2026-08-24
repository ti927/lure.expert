// As regras de categorização, fora de `'use server'`.
//
// Movido de `src/server/categorization-rules.ts` — mesma razão dos irmãos
// `transactions-write` e `allocations-write`: o servidor MCP não pode importar de
// `src/server/**`, e duas cópias da validação de alvo é como a tela e o MCP
// passam a aceitar regras diferentes sem ninguém notar.
//
// ─────────────────────────────────────────────────────────────────────────────
// O que uma regra é, e o que ela NÃO é
//
// Uma regra é `(descrição, conta) → alvos`, e o casamento é por SUBSTRING, sem
// diferenciar maiúsculas (`applyRules` em `categorizer.ts` faz
// `description.toLowerCase().includes(...)`). Uma regra "PAG" casa com
// "PAGSEGURO", "PAGAMENTO FORNECEDOR" e "COMPAGAS". É por isso que a prévia
// CONTA quantos lançamentos a descrição alcança hoje: é o único jeito de o
// humano enxergar que pediu algo largo demais antes de gravar.
//
// E regra NÃO reclassifica o que já existe. Ela entra na camada 1 da próxima
// passada de categorização. Reclassificar o passado é
// `prever_classificacao_em_lote`, que é outra ferramenta de propósito — misturar
// as duas faria "criar uma regra" mexer em contabilidade fechada.
//
// A identidade é o par `(descrição exata, conta)`, comparado por igualdade de
// string — igual ao que `upsertRule` e a tela já fazem. Gravar uma regra cuja
// identidade já existe ATUALIZA os alvos dela, e a prévia diz para onde ela
// aponta hoje, senão o humano aprovaria uma sobrescrita às cegas.

import { z } from 'zod'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  categorizationRules, categories,
  costCenters, businessUnits, legalEntities, contacts,
} from '@/db/schema'
import { validarDimensoes } from '@/lib/allocations-write'

/** Teto por chamada. 50 linhas ainda é uma lista que uma pessoa lê antes de aceitar. */
export const MAX_REGRAS_POR_LOTE = 50

/**
 * Piso de 3 caracteres na descrição.
 *
 * A tela aceita 1, e num formulário isso é inofensivo — quem digita vê o que
 * fez. Em lote não: uma regra "a" casaria com praticamente todo lançamento da
 * organização e mandaria a base inteira para uma natureza só.
 */
const MIN_DESCRICAO = 3

const uuidOrNull = z.string().uuid().nullable()

export const alvosRegraSchema = z.object({
  targetCategoryId:     uuidOrNull,
  targetCostCenterId:   uuidOrNull,
  targetBusinessUnitId: uuidOrNull,
  targetLegalEntityId:  uuidOrNull,
  targetContactId:      uuidOrNull,
})

export const ruleInputSchema = alvosRegraSchema.extend({
  description: z.string().trim().min(1, 'Descrição obrigatória').max(200, 'Máximo 200 caracteres'),
  accountId: z.string().trim().min(1).max(200).nullable(),
})

export type RuleInput = z.infer<typeof ruleInputSchema>
type AlvosRegra = z.infer<typeof alvosRegraSchema>

export function temAlgumAlvo(a: AlvosRegra): boolean {
  return !!(a.targetCategoryId || a.targetCostCenterId || a.targetBusinessUnitId
    || a.targetLegalEntityId || a.targetContactId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Validação dos alvos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * As naturezas citadas: pertencem à organização, e são folha?
 *
 * Em uma consulta só, porque o lote pode ter 50 regras e `assertLeafCategory`
 * custa duas idas ao banco por chamada.
 *
 * **Só natureza folha.** A tela nunca ofereceu outra coisa (`CellCombobox`
 * filtra pelos que não são pai de ninguém), mas o servidor não conferia: uma
 * regra apontando para uma natureza pai penduraria o lançamento no pai e o valor
 * apareceria duas vezes na cascata da DRE — no pai e na soma dos filhos.
 */
async function classificarNaturezas(
  organizationId: string,
  ids: string[],
): Promise<Map<string, { nome: string; codigo: string | null; folha: boolean }>> {
  const mapa = new Map<string, { nome: string; codigo: string | null; folha: boolean }>()
  if (ids.length === 0) return mapa

  const linhas = await db
    .select({
      id: categories.id,
      nome: categories.name,
      codigo: categories.code,
      // `${categories}.id` e NÃO `${categories.id}` — ver a nota em
      // `lib/sql-dimensions.ts`. Sem join, o Drizzle emite `"id"` puro na lista
      // do SELECT e o alias `f` do EXISTS o captura.
      folha: sql<boolean>`NOT EXISTS (
        SELECT 1 FROM ${categories} f WHERE f.parent_id = ${categories}.id
      )`,
    })
    .from(categories)
    .where(and(
      eq(categories.organizationId, organizationId),
      inArray(categories.id, Array.from(new Set(ids))),
    ))

  for (const l of linhas) {
    mapa.set(l.id, { nome: l.nome, codigo: l.codigo, folha: l.folha === true })
  }
  return mapa
}

/** Erro legível quando algum alvo não pertence à organização ou não é folha. */
export async function validarAlvosDaRegra(
  organizationId: string,
  a: AlvosRegra,
): Promise<string | null> {
  if (a.targetCategoryId) {
    const naturezas = await classificarNaturezas(organizationId, [a.targetCategoryId])
    const n = naturezas.get(a.targetCategoryId)
    if (!n) return 'Categoria-alvo não pertence à sua organização.'
    if (!n.folha) return 'Categorias com subcategorias não podem ser alvo de regra.'
  }
  return validarDimensoes(organizationId, [{
    costCenterId:   a.targetCostCenterId,
    businessUnitId: a.targetBusinessUnitId,
    legalEntityId:  a.targetLegalEntityId,
    contactId:      a.targetContactId,
  }])
}

// ─────────────────────────────────────────────────────────────────────────────
// A identidade `(descrição, conta)`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O predicado de identidade, escrito uma vez.
 *
 * Regra sem conta é GLOBAL, e o `IS NULL` é parte da identidade: "UBER" global e
 * "UBER" na conta 1234 são duas regras diferentes, e a específica vence na hora
 * de categorizar.
 */
function mesmaIdentidade(descricao: string, contaId: string | null) {
  return and(
    sql`${categorizationRules.conditions}->>'description' = ${descricao}`,
    contaId
      ? sql`${categorizationRules.conditions}->>'accountId' = ${contaId}`
      : sql`(${categorizationRules.conditions} ->> 'accountId') IS NULL`,
  )!
}

function montarConditions(descricao: string, contaId: string | null): Record<string, string> {
  const c: Record<string, string> = { description: descricao }
  if (contaId) c.accountId = contaId
  return c
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura
// ─────────────────────────────────────────────────────────────────────────────

export interface RegraResumida {
  id: string
  descricao: string
  contaId: string | null
  categoria: string | null
  centroDeCusto: string | null
  unidadeDeNegocio: string | null
  entidadeLegal: string | null
  contato: string | null
  vezesAplicada: number
  criadaAutomaticamente: boolean
}

/**
 * As regras da organização, com os alvos já resolvidos em nome.
 *
 * A tela tem a sua própria leitura paginada em `listRules`; esta é a forma que o
 * MCP precisa — sem paginação, com nome em vez de id, porque um id não diz nada
 * a quem lê a resposta.
 */
export async function listarRegras(
  organizationId: string,
  opcoes: { busca?: string; limite?: number } = {},
): Promise<RegraResumida[]> {
  const busca = opcoes.busca?.trim()
  const linhas = await db
    .select({
      id: categorizationRules.id,
      conditions: categorizationRules.conditions,
      categoria: sql<string | null>`${categories.code} || ' ' || ${categories.name}`,
      centroDeCusto: costCenters.name,
      unidadeDeNegocio: businessUnits.name,
      entidadeLegal: legalEntities.name,
      contato: contacts.name,
      vezesAplicada: categorizationRules.matchCount,
      auto: categorizationRules.autoGenerated,
    })
    .from(categorizationRules)
    .leftJoin(categories,    eq(categorizationRules.targetCategoryId, categories.id))
    .leftJoin(costCenters,   eq(categorizationRules.targetCostCenterId, costCenters.id))
    .leftJoin(businessUnits, eq(categorizationRules.targetBusinessUnitId, businessUnits.id))
    .leftJoin(legalEntities, eq(categorizationRules.targetLegalEntityId, legalEntities.id))
    .leftJoin(contacts,      eq(categorizationRules.targetContactId, contacts.id))
    .where(and(
      eq(categorizationRules.organizationId, organizationId),
      // Só o formato novo `{ description, accountId }`. As antigas
      // `{ field, op, value }` ficaram invisíveis na tela desde a 0019 e não
      // faria sentido o MCP enxergar o que a tela não deixa editar.
      sql`${categorizationRules.conditions} ? 'description'`,
      ...(busca ? [sql`${categorizationRules.conditions}->>'description' ILIKE ${`%${busca}%`}`] : []),
    ))
    .orderBy(desc(categorizationRules.updatedAt))
    .limit(Math.min(opcoes.limite ?? 200, 500))

  return linhas.map(l => {
    const c = (l.conditions ?? {}) as { description?: string; accountId?: string }
    return {
      id: l.id,
      descricao: c.description ?? '',
      contaId: c.accountId ?? null,
      categoria: l.categoria,
      centroDeCusto: l.centroDeCusto,
      unidadeDeNegocio: l.unidadeDeNegocio,
      entidadeLegal: l.entidadeLegal,
      contato: l.contato,
      vezesAplicada: l.vezesAplicada,
      criadaAutomaticamente: l.auto,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// O plano do lote — o miolo do par prever_/aplicar_
// ─────────────────────────────────────────────────────────────────────────────

export const regraDeLoteSchema = z.object({
  descricao: z.string().trim().min(MIN_DESCRICAO).max(200),
  contaId: z.string().trim().min(1).max(200).nullable().default(null),
  categoryId:     z.string().uuid().nullable().default(null),
  costCenterId:   z.string().uuid().nullable().default(null),
  businessUnitId: z.string().uuid().nullable().default(null),
  legalEntityId:  z.string().uuid().nullable().default(null),
  contactId:      z.string().uuid().nullable().default(null),
})

export type RegraDeLote = z.infer<typeof regraDeLoteSchema>

export interface LinhaPlanejada {
  indice: number
  descricao: string
  contaId: string | null
  acao: 'criar' | 'atualizar'
  regraExistenteId: string | null
  /** Para onde a regra existente aponta HOJE — o que a atualização sobrescreve. */
  alvosAtuais: string | null
  alvos: {
    categoria: string | null
    centroDeCusto: string | null
    unidadeDeNegocio: string | null
    entidadeLegal: string | null
    contato: string | null
  }
  /** Lançamentos que a descrição já alcança hoje. Regra não os reclassifica. */
  lancamentosQueCasam: number
  /** Destes, quantos ainda estão sem natureza — os que a próxima passada pegaria. */
  semNatureza: number
}

export interface LinhaRecusada {
  indice: number
  descricao: string
  motivo: string
}

export interface PlanoDeRegras {
  linhas: LinhaPlanejada[]
  recusadas: LinhaRecusada[]
  criar: number
  atualizar: number
}

/**
 * Nomes das dimensões citadas, em quatro consultas.
 *
 * Escritas por extenso pela mesma razão de `validarDimensoes`: as tabelas do
 * Drizzle têm tipos distintos, e uni-las numa variável só se resolve com cast —
 * mentir para o compilador exatamente onde ele protege o isolamento.
 */
async function nomesDasDimensoes(organizationId: string, regras: RegraDeLote[]) {
  const unicos = (f: (r: RegraDeLote) => string | null) =>
    Array.from(new Set(regras.map(f).filter((v): v is string => !!v)))

  const carregar = async (
    tabela: typeof costCenters | typeof businessUnits | typeof legalEntities | typeof contacts,
    ids: string[],
  ) => {
    const m = new Map<string, string>()
    if (ids.length === 0) return m
    const linhas = await db.select({ id: tabela.id, nome: tabela.name }).from(tabela)
      .where(and(eq(tabela.organizationId, organizationId), inArray(tabela.id, ids)))
    for (const l of linhas) m.set(l.id, l.nome)
    return m
  }

  const [cc, bu, le, ct] = await Promise.all([
    carregar(costCenters,   unicos(r => r.costCenterId)),
    carregar(businessUnits, unicos(r => r.businessUnitId)),
    carregar(legalEntities, unicos(r => r.legalEntityId)),
    carregar(contacts,      unicos(r => r.contactId)),
  ])
  return { cc, bu, le, ct }
}

/**
 * Quantos lançamentos cada descrição alcança — numa consulta só.
 *
 * `position(lower(...) in lower(...))` e não `ILIKE '%'||d||'%'` de propósito:
 * é literalmente o que `applyRules` faz em JS, e não trata `%` nem `_` da
 * descrição como curinga. Uma descrição com `%` viraria outro filtro no ILIKE, e
 * a contagem mentiria justamente na regra mais estranha do lote.
 */
async function contarAlcance(
  organizationId: string,
  regras: RegraDeLote[],
): Promise<Map<number, { casam: number; semNatureza: number }>> {
  const mapa = new Map<number, { casam: number; semNatureza: number }>()
  if (regras.length === 0) return mapa

  const valores = sql.join(
    regras.map((r, i) => sql`(${i}::int, ${r.descricao}::text, ${r.contaId}::text)`),
    sql`, `,
  )

  const rows = await db.execute<{ idx: number; casam: number; sem_natureza: number }>(sql`
    SELECT v.idx AS idx,
           COUNT(t.id)::int AS casam,
           COUNT(t.id) FILTER (WHERE t.category_id IS NULL)::int AS sem_natureza
      FROM (VALUES ${valores}) AS v(idx, descricao, conta)
      LEFT JOIN transactions t
        ON t.organization_id = ${organizationId}::uuid
       AND t.status <> 'pending'
       AND position(lower(v.descricao) in lower(t.description)) > 0
       AND (v.conta IS NULL OR t.account_id = v.conta)
     GROUP BY v.idx
  `)

  for (const r of rows) {
    mapa.set(Number(r.idx), { casam: Number(r.casam), semNatureza: Number(r.sem_natureza) })
  }
  return mapa
}

/**
 * O que o lote faria, sem gravar.
 *
 * Linha inválida NÃO derruba o lote — sai com o motivo e as outras seguem. É o
 * mesmo princípio da importação de planilha da 9.5: num lote de 40 regras, uma
 * natureza errada não pode custar as 39 boas.
 */
export async function planejarRegras(
  organizationId: string,
  entrada: RegraDeLote[],
): Promise<{ error: string } | PlanoDeRegras> {
  if (entrada.length === 0) return { error: 'Informe ao menos uma regra.' }
  if (entrada.length > MAX_REGRAS_POR_LOTE) {
    return { error: `Máximo de ${MAX_REGRAS_POR_LOTE} regras por vez. Divida em chamadas menores.` }
  }

  const recusadas: LinhaRecusada[] = []
  const validas: { indice: number; regra: RegraDeLote }[] = []

  // Duplicata dentro do próprio lote, sem diferenciar maiúsculas. Duas linhas
  // que só diferem no caixa não são duas regras: as duas casariam com os mesmos
  // lançamentos, e qual venceria dependeria da ordem de gravação.
  const vistas = new Map<string, number>()

  entrada.forEach((r, i) => {
    if (!r.categoryId && !r.costCenterId && !r.businessUnitId && !r.legalEntityId && !r.contactId) {
      recusadas.push({ indice: i, descricao: r.descricao, motivo: 'Sem nenhum alvo. Informe ao menos uma dimensão de destino.' })
      return
    }
    const chave = `${r.descricao.toLowerCase()}::${r.contaId ?? ''}`
    const anterior = vistas.get(chave)
    if (anterior !== undefined) {
      recusadas.push({
        indice: i, descricao: r.descricao,
        motivo: `Repete a regra da posição ${anterior} (mesma descrição e conta). Mantenha só uma.`,
      })
      return
    }
    vistas.set(chave, i)
    validas.push({ indice: i, regra: r })
  })

  if (validas.length === 0) {
    return { linhas: [], recusadas, criar: 0, atualizar: 0 }
  }

  const naturezas = await classificarNaturezas(
    organizationId,
    validas.map(v => v.regra.categoryId).filter((v): v is string => !!v),
  )
  const dims = await nomesDasDimensoes(organizationId, validas.map(v => v.regra))

  // Segunda peneira: alvo que não existe na organização, ou natureza que não é
  // folha. Só depois de peneirar é que vale contar alcance e procurar existentes.
  const sobreviventes: { indice: number; regra: RegraDeLote }[] = []
  for (const v of validas) {
    const r = v.regra
    if (r.categoryId) {
      const n = naturezas.get(r.categoryId)
      if (!n) {
        recusadas.push({ indice: v.indice, descricao: r.descricao, motivo: 'Natureza não encontrada nesta empresa.' })
        continue
      }
      if (!n.folha) {
        recusadas.push({
          indice: v.indice, descricao: r.descricao,
          motivo: `"${n.nome}" tem subcategorias e não pode ser alvo. Escolha uma natureza folha.`,
        })
        continue
      }
    }
    const faltando =
      (r.costCenterId   && !dims.cc.has(r.costCenterId)   && 'Centro de custo') ||
      (r.businessUnitId && !dims.bu.has(r.businessUnitId) && 'Unidade de negócio') ||
      (r.legalEntityId  && !dims.le.has(r.legalEntityId)  && 'Entidade jurídica') ||
      (r.contactId      && !dims.ct.has(r.contactId)      && 'Contato')
    if (faltando) {
      recusadas.push({ indice: v.indice, descricao: r.descricao, motivo: `${faltando} não encontrado nesta empresa.` })
      continue
    }
    sobreviventes.push(v)
  }

  if (sobreviventes.length === 0) {
    return { linhas: [], recusadas, criar: 0, atualizar: 0 }
  }

  const alcance = await contarAlcance(organizationId, sobreviventes.map(s => s.regra))

  // As regras que já existem com a mesma identidade. Uma consulta por descrição
  // seria N idas ao banco; aqui é uma só, filtrando por descrição e conferindo o
  // par exato em memória.
  const existentes = await db
    .select({
      id: categorizationRules.id,
      conditions: categorizationRules.conditions,
      categoria: sql<string | null>`${categories.code} || ' ' || ${categories.name}`,
      cc: costCenters.name,
      bu: businessUnits.name,
      le: legalEntities.name,
      ct: contacts.name,
    })
    .from(categorizationRules)
    .leftJoin(categories,    eq(categorizationRules.targetCategoryId, categories.id))
    .leftJoin(costCenters,   eq(categorizationRules.targetCostCenterId, costCenters.id))
    .leftJoin(businessUnits, eq(categorizationRules.targetBusinessUnitId, businessUnits.id))
    .leftJoin(legalEntities, eq(categorizationRules.targetLegalEntityId, legalEntities.id))
    .leftJoin(contacts,      eq(categorizationRules.targetContactId, contacts.id))
    .where(and(
      eq(categorizationRules.organizationId, organizationId),
      inArray(
        sql`${categorizationRules.conditions}->>'description'`,
        Array.from(new Set(sobreviventes.map(s => s.regra.descricao))),
      ),
    ))

  const porIdentidade = new Map<string, (typeof existentes)[number]>()
  for (const e of existentes) {
    const c = (e.conditions ?? {}) as { description?: string; accountId?: string }
    porIdentidade.set(`${c.description ?? ''}::${c.accountId ?? ''}`, e)
  }

  const linhas: LinhaPlanejada[] = sobreviventes.map(({ indice, regra: r }, pos) => {
    const existente = porIdentidade.get(`${r.descricao}::${r.contaId ?? ''}`)
    // `pos` e não `indice`: `contarAlcance` recebeu os sobreviventes, então a
    // chave do alcance é a posição nessa lista, não no lote original.
    const a = alcance.get(pos) ?? { casam: 0, semNatureza: 0 }
    return {
      indice,
      descricao: r.descricao,
      contaId: r.contaId,
      acao: existente ? 'atualizar' : 'criar',
      regraExistenteId: existente?.id ?? null,
      alvosAtuais: existente
        ? [existente.categoria, existente.cc, existente.bu, existente.le, existente.ct]
            .filter(Boolean).join(' · ') || '(sem alvo)'
        : null,
      alvos: {
        categoria: r.categoryId
          ? [naturezas.get(r.categoryId)?.codigo, naturezas.get(r.categoryId)?.nome].filter(Boolean).join(' ')
          : null,
        centroDeCusto:    r.costCenterId   ? dims.cc.get(r.costCenterId)   ?? null : null,
        unidadeDeNegocio: r.businessUnitId ? dims.bu.get(r.businessUnitId) ?? null : null,
        entidadeLegal:    r.legalEntityId  ? dims.le.get(r.legalEntityId)  ?? null : null,
        contato:          r.contactId      ? dims.ct.get(r.contactId)      ?? null : null,
      },
      lancamentosQueCasam: a.casam,
      semNatureza: a.semNatureza,
    }
  })

  return {
    linhas,
    recusadas,
    criar:     linhas.filter(l => l.acao === 'criar').length,
    atualizar: linhas.filter(l => l.acao === 'atualizar').length,
  }
}

/**
 * A assinatura do plano — o que o apply compara com o que a prévia prometeu.
 *
 * Não basta a contagem: se alguém criar, no intervalo, uma regra com a mesma
 * identidade, um `criar` vira `atualizar` e a operação passa a SOBRESCREVER algo
 * que o humano nunca viu. A quantidade seria a mesma; o efeito, outro.
 *
 * De fora fica `lancamentosQueCasam`: ele muda a cada importação e não altera
 * uma vírgula do que será gravado. Incluí-lo faria a prévia expirar por conta de
 * um extrato que chegou no meio, sem nenhum ganho.
 */
export function assinaturaDoPlano(plano: PlanoDeRegras): string {
  return plano.linhas
    .map(l => `${l.indice}:${l.acao}:${l.regraExistenteId ?? ''}`)
    .join('|')
}

export interface ResultadoRegras {
  criadas: number
  atualizadas: number
}

/**
 * Grava o plano.
 *
 * Numa transação: um lote de regras é uma decisão só, e metade dela gravada é
 * pior que nenhuma — o categorizador passaria a aplicar um mapeamento pela
 * metade sem ninguém saber qual metade.
 */
export async function aplicarRegras(
  organizationId: string,
  entrada: RegraDeLote[],
  plano: PlanoDeRegras,
): Promise<ResultadoRegras> {
  let criadas = 0
  let atualizadas = 0

  await db.transaction(async (tx) => {
    for (const linha of plano.linhas) {
      const r = entrada[linha.indice]
      const alvos = {
        targetCategoryId:     r.categoryId,
        targetCostCenterId:   r.costCenterId,
        targetBusinessUnitId: r.businessUnitId,
        targetLegalEntityId:  r.legalEntityId,
        targetContactId:      r.contactId,
      }

      if (linha.regraExistenteId) {
        await tx.update(categorizationRules)
          .set({ ...alvos, autoGenerated: false, confirmedAt: new Date(), updatedAt: new Date() })
          .where(and(
            eq(categorizationRules.id, linha.regraExistenteId),
            eq(categorizationRules.organizationId, organizationId),
          ))
        atualizadas++
      } else {
        await tx.insert(categorizationRules).values({
          organizationId,
          name: `Regra: ${r.descricao.slice(0, 80)}`,
          conditions: montarConditions(r.descricao, r.contaId),
          ...alvos,
          autoGenerated: false,
          confirmedAt: new Date(),
          priority: 0,
        })
        criadas++
      }
    }
  })

  return { criadas, atualizadas }
}

// ─────────────────────────────────────────────────────────────────────────────
// O caminho da tela — uma regra por vez, pelo formulário
// ─────────────────────────────────────────────────────────────────────────────

export async function criarRegra(
  organizationId: string,
  input: RuleInput,
): Promise<{ error: string } | { success: true }> {
  const parsed = ruleInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (!temAlgumAlvo(parsed.data)) {
    return { error: 'Selecione ao menos um alvo (categoria, centro de custo, unidade de negócio, entidade ou contato).' }
  }

  const erro = await validarAlvosDaRegra(organizationId, parsed.data)
  if (erro) return { error: erro }

  const existente = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(
      eq(categorizationRules.organizationId, organizationId),
      mesmaIdentidade(parsed.data.description, parsed.data.accountId),
    ))
    .limit(1)
  if (existente.length > 0) {
    return { error: 'Já existe uma regra com essa descrição e conta. Edite a existente em vez de criar uma nova.' }
  }

  await db.insert(categorizationRules).values({
    organizationId,
    name: `Manual: ${parsed.data.description.slice(0, 80)}`,
    conditions: montarConditions(parsed.data.description, parsed.data.accountId),
    targetCategoryId:     parsed.data.targetCategoryId,
    targetCostCenterId:   parsed.data.targetCostCenterId,
    targetBusinessUnitId: parsed.data.targetBusinessUnitId,
    targetLegalEntityId:  parsed.data.targetLegalEntityId,
    targetContactId:      parsed.data.targetContactId,
    autoGenerated: false,
    confirmedAt: new Date(),
    priority: 0,
  })

  return { success: true }
}

export async function atualizarRegra(
  organizationId: string,
  id: string,
  input: RuleInput,
): Promise<{ error: string } | { success: true }> {
  const parsed = ruleInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (!temAlgumAlvo(parsed.data)) {
    return { error: 'Selecione ao menos um alvo (categoria, centro de custo, unidade de negócio, entidade ou contato).' }
  }

  const erro = await validarAlvosDaRegra(organizationId, parsed.data)
  if (erro) return { error: erro }

  const [own] = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(eq(categorizationRules.id, id), eq(categorizationRules.organizationId, organizationId)))
    .limit(1)
  if (!own) return { error: 'Regra não encontrada.' }

  const colisao = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(
      eq(categorizationRules.organizationId, organizationId),
      sql`${categorizationRules.id} != ${id}`,
      mesmaIdentidade(parsed.data.description, parsed.data.accountId),
    ))
    .limit(1)
  if (colisao.length > 0) {
    return { error: 'Já existe outra regra com essa descrição e conta. Apague a outra primeiro ou ajuste a descrição.' }
  }

  await db.update(categorizationRules)
    .set({
      name: `Manual: ${parsed.data.description.slice(0, 80)}`,
      conditions: montarConditions(parsed.data.description, parsed.data.accountId),
      targetCategoryId:     parsed.data.targetCategoryId,
      targetCostCenterId:   parsed.data.targetCostCenterId,
      targetBusinessUnitId: parsed.data.targetBusinessUnitId,
      targetLegalEntityId:  parsed.data.targetLegalEntityId,
      targetContactId:      parsed.data.targetContactId,
      autoGenerated: false,
      confirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(categorizationRules.id, id), eq(categorizationRules.organizationId, organizationId)))

  return { success: true }
}
