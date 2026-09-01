'use server'

import { getAuthContext } from '@/lib/auth-context'

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import {
  transactionsStaging,
  documents,
  transactions,
  dataSources,
} from '@/db/schema'
import { eq, and, inArray, isNull, sql } from 'drizzle-orm'
import { sendCategorizationEvents } from '@/lib/inngest'
import {
  loadOrgContext,
  findCategoryByCsvMapping,
  findCategoryByText,
  domainFromReportType,
  type CsvCategoryMapping,
} from '@/lib/categorizer'
import { BP_TYPES } from '@/lib/bp-types'
import {
  planejarStaging,
  lerContaDoDocumento,
  type PlanoDeStaging,
  type ContaDaLinha,
  type EdicaoDeConta,
} from '@/lib/staging-import'
import {
  garantirContaManual,
  listarContasManuais,
  mapaDeContasManuais,
  rotuloDaConta,
  PROVIDER_MANUAL,
  type ContaManual,
  type ResumoDeContaDoArquivo,
} from '@/lib/accounts'
import { contaCanonica, lerTipoDeConta } from '@/lib/import-contract'

// `balance_sheet` faltava aqui desde a Fase 6 — o mapa nasceu antes de o BP
// existir como origem, e um balanço aparecia rotulado como "Upload manual".
const SOURCE_LABELS: Record<string, string> = {
  bank: 'Extrato bancário',
  erp: 'Relatório ERP',
  acquirer: 'Adquirente',
  credit_card: 'Fatura de cartão',
  sefaz: 'Nota fiscal',
  balance_sheet: 'Balanço Patrimonial',
  other: 'Upload manual',
}

// ─── Fetch document + all staging rows ──────────────────────────────────────
export async function getDocumentStagingRows(documentId: string) {
  const { organizationId } = await getAuthContext()

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(
      eq(documents.id, documentId),
      eq(documents.organizationId, organizationId),
    ))
    .limit(1)

  if (!doc) throw new Error('Documento não encontrado')

  const [rows, txResult] = await Promise.all([
    db
      .select()
      .from(transactionsStaging)
      .where(and(
        eq(transactionsStaging.documentId, documentId),
        eq(transactionsStaging.organizationId, organizationId),
      ))
      .orderBy(transactionsStaging.rowIndex),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.documentId, documentId)),
  ])

  const importedCount = Number(txResult[0]?.count ?? 0)

  // O resumo vem do MESMO código que a gravação usa (`planejarStaging`). Calcular
  // o aviso por outro caminho faria a tela prometer um número e o insert entregar
  // outro — e é justamente sobre esse número que a pessoa decide clicar.
  const plano = importedCount > 0 ? null : await planejarStaging(organizationId, doc, rows)

  // Quantas naturezas de BP existem para casar contra.
  // ACHADO DA 4.5.B, medido no banco: `seed_categories_for_org` **não cria
  // nenhuma** — das 6 organizações, só uma tem naturezas de BP, criadas à mão.
  // Sem elas o balanço importa e `getBpData`, que soma por tipo de categoria,
  // ignora todas as linhas: `/balanco` continuaria vazio depois de uma
  // importação bem-sucedida. Vale avisar antes, não depois.
  let folhasBp = 0
  if (doc.reportType === 'balance_sheet') {
    const [r] = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM categories c
       WHERE c.organization_id = ${organizationId}::uuid
         AND c.is_active
         AND c.type = ANY(${BP_TYPES as unknown as string[]})
         AND NOT EXISTS (SELECT 1 FROM categories f WHERE f.parent_id = c.id)`)
    folhasBp = Number(r?.n ?? 0)
  }

  const resumo = plano && !('error' in plano)
    ? {
        aInserir: plano.aInserir.length,
        duplicadas: plano.duplicadas,
        recusadas: plano.recusadas.slice(0, 20),
        totalRecusadas: plano.recusadas.length,
        deduplicando: plano.deduplicando,
        tipoDeRelatorio: plano.cabecalho.tipoDeRelatorio,
        dataDeReferencia: plano.cabecalho.dataDeReferencia,
        folhasBp,
        contasDoArquivo: plano.contasDoArquivo,
        semConta: plano.semConta,
        erro: null as string | null,
      }
    : {
        aInserir: 0, duplicadas: 0, recusadas: [], totalRecusadas: 0,
        deduplicando: false,
        tipoDeRelatorio: (doc.reportType === 'balance_sheet' ? 'balanco' : 'movimentos') as 'balanco' | 'movimentos',
        dataDeReferencia: doc.referenceDate ?? null,
        folhasBp,
        contasDoArquivo: [] as ResumoDeContaDoArquivo[],
        semConta: 0,
        erro: plano && 'error' in plano ? plano.error : null,
      }

  const contaPorLinha = plano && !('error' in plano)
    ? contaDoPlano(plano)
    : await contaJaGravada(organizationId, documentId)

  return { document: doc, rows, importedCount, resumo, conta: lerContaDoDocumento(doc), contaPorLinha }
}

function contaDoPlano(plano: PlanoDeStaging): Record<string, ContaDaLinha> {
  const mapa: Record<string, ContaDaLinha> = {}
  for (const n of plano.normalizadas) {
    if (n.conta) {
      mapa[n.staging.id] = { accountId: n.conta.accountId, rotulo: rotuloDaConta(n.conta), cadastrada: true }
    } else if (n.contaDeclarada) {
      mapa[n.staging.id] = { accountId: n.contaDeclarada.accountId, rotulo: n.contaDeclarada.nome, cadastrada: false }
    }
  }
  return mapa
}

/**
 * Depois de importado, a coluna mostra o que está no RAZÃO — não o que o plano
 * faria hoje. Um recibo que re-simula mentiria se o cadastro tivesse mudado
 * desde a importação.
 *
 * `metadata.stagingId` é gravado no insert, e é o que liga as duas pontas.
 */
async function contaJaGravada(
  organizationId: string,
  documentId: string,
): Promise<Record<string, ContaDaLinha>> {
  const linhas = await db.execute<{
    staging_id: string | null
    account_id: string | null
    account_name: string | null
    account_type: string | null
    account_number: string | null
    provider: string | null
  }>(sql`
    SELECT t.metadata->>'stagingId' AS staging_id,
           t.account_id, t.account_name, t.account_type, t.account_number,
           ds.provider
      FROM transactions t
      JOIN data_sources ds ON ds.id = t.data_source_id
     WHERE t.document_id = ${documentId}::uuid
       AND t.organization_id = ${organizationId}::uuid`)

  const mapa: Record<string, ContaDaLinha> = {}
  for (const l of linhas) {
    if (!l.staging_id || !l.account_id) continue
    mapa[l.staging_id] = {
      accountId: l.account_id,
      rotulo: rotuloDaConta({
        nome: l.account_name ?? l.account_id,
        tipo: lerTipoDeConta(l.account_type),
        numero: l.account_number,
      }),
      // Vinculada de verdade é a linha cuja fonte é a conta manual.
      cadastrada: l.provider === PROVIDER_MANUAL,
    }
  }
  return mapa
}

// ─── Conta do arquivo ────────────────────────────────────────────────────────

/**
 * As contas que já existem na organização, para a revisão oferecer em vez de
 * pedir digitação.
 *
 * Sem cadastro de conta, **erro de digitação multiplica conta**: o `account_id`
 * é o slug do nome, então "Itaú PJ" e "itau pj" colapsam, mas "Itaú PJ" e "Itaú
 * Pessoa Jurídica" viram duas. Oferecer as existentes é a defesa barata.
 */
export async function getAccountOptions(): Promise<{ accountId: string; nome: string; rotulo: string }[]> {
  const { organizationId } = await getAuthContext()
  const manuais = await listarContasManuais(organizationId)
  return manuais.map(c => ({ accountId: c.accountId, nome: c.nome, rotulo: rotuloDaConta(c) }))
}

/**
 * Declara a conta PADRÃO do arquivo — a das linhas que não declaram a sua.
 *
 * A coluna `Conta` da planilha vence este bloco, linha a linha (é o que
 * `docs/FORMATO_DE_IMPORTACAO.md` promete para o extrato consolidado, e o que
 * `normalizarLancamento` faz). O que continua sendo só daqui é **criar conta**:
 * `garantirContaManual` insere uma `data_sources` com `provider='manual'`, e é
 * ela que faz a conta aparecer em `/contas` e no filtro de `/transacoes`. Conta
 * citada numa linha e ausente do cadastro **não é criada** — a linha entra sem
 * vínculo, e a tela avisa antes do clique.
 */
export async function setDocumentAccount(
  documentId: string,
  conta: { nome: string; tipo: string | null; numero: string | null } | null,
) {
  const { organizationId } = await getAuthContext()

  const [doc] = await db
    .select({ id: documents.id, metadata: documents.metadata })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
    .limit(1)
  if (!doc) return { error: 'Documento não encontrado.' }

  const meta = { ...((doc.metadata ?? {}) as Record<string, unknown>) }

  if (!conta || !conta.nome.trim()) {
    delete meta.account
    await db.update(documents).set({ metadata: meta }).where(eq(documents.id, documentId))
    revalidatePath(`/upload/${documentId}/review`)
    return { success: true, conta: null }
  }

  const criada = await garantirContaManual(organizationId, conta.nome, conta.tipo, conta.numero)
  if ('error' in criada) return criada

  meta.account = { nome: criada.nome, tipo: criada.tipo, numero: criada.numero }
  await db.update(documents).set({ metadata: meta }).where(eq(documents.id, documentId))

  revalidatePath(`/upload/${documentId}/review`)
  revalidatePath('/contas')
  return { success: true, conta: { nome: criada.nome, tipo: criada.tipo, numero: criada.numero } }
}

/**
 * A conta de linhas específicas, escolhida na tela.
 *
 * **Não cria conta** (é a diferença para `setDocumentAccount`): `definir` recusa
 * nome que não existe no cadastro, dizendo onde criá-lo. É a única escrita que
 * poderia violar essa regra, então a barreira mora aqui.
 *
 * Grava em `raw_data.__conta`, ao lado de `__contrato` — ver `ContaEditadaNaLinha`.
 */
export async function setStagingRowsAccount(
  documentId: string,
  rowIds: string[],
  edicao: EdicaoDeConta,
): Promise<{ error: string } | { updated: number; conta: ContaManual | null }> {
  if (rowIds.length === 0) return { updated: 0, conta: null }

  const { organizationId } = await getAuthContext()

  // A tela já esconde o controle depois de importado, mas esta é a única ação
  // que muda um VÍNCULO — e o vínculo já foi gravado em `transactions`.
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.documentId, documentId), eq(transactions.organizationId, organizationId)))
  if (Number(count) > 0) {
    return { error: 'Este arquivo já foi importado — a conta das linhas não muda mais aqui. Ajuste em Transações.' }
  }

  let conta: ContaManual | null = null
  if (edicao.modo === 'definir') {
    const alvo = contaCanonica(edicao.nome).accountId
    const cadastro = await mapaDeContasManuais(organizationId)
    conta = (alvo && cadastro.get(alvo)) || null
    if (!conta) {
      return {
        error: `A conta "${edicao.nome.trim()}" não existe. Crie-a em Contas, ou no bloco "Conta deste arquivo" acima.`,
      }
    }
  }

  const where = and(
    eq(transactionsStaging.organizationId, organizationId),
    eq(transactionsStaging.documentId, documentId),
    inArray(transactionsStaging.id, rowIds),
  )

  const payload = conta
    ? { nome: conta.nome, tipo: conta.tipo, numero: conta.numero }
    : { nome: null }

  const result = await db
    .update(transactionsStaging)
    .set({
      rawData: edicao.modo === 'do-arquivo'
        ? sql`coalesce(${transactionsStaging.rawData}, '{}'::jsonb) #- '{__conta}'`
        : sql`jsonb_set(coalesce(${transactionsStaging.rawData}, '{}'::jsonb), '{__conta}', ${JSON.stringify(payload)}::jsonb, true)`,
    })
    .where(where)
    .returning({ id: transactionsStaging.id })

  // Obrigatório, e não por estética: a conta entra na chave de dedup, então o
  // aviso de duplicadas da tela sai errado sem recalcular o plano.
  revalidatePath(`/upload/${documentId}/review`)
  return { updated: result.length, conta }
}

// ─── Update single staging row (inline edit) ─────────────────────────────────
export async function updateStagingRow(
  rowId: string,
  fields: {
    date?: string | null
    effectiveDate?: string | null
    amount?: string | null
    direction?: string | null
    description?: string | null
  },
) {
  const { organizationId } = await getAuthContext()

  await db
    .update(transactionsStaging)
    .set(fields)
    .where(and(
      eq(transactionsStaging.id, rowId),
      eq(transactionsStaging.organizationId, organizationId),
    ))

  return { success: true }
}

// ─── Batch update: approve | reject | flip direction ─────────────────────────
export async function batchUpdateStaging(
  documentId: string,
  rowIds: string[],
  action: 'approve' | 'reject' | 'flip',
) {
  if (rowIds.length === 0) return { success: true }

  const { organizationId } = await getAuthContext()

  const where = and(
    eq(transactionsStaging.organizationId, organizationId),
    eq(transactionsStaging.documentId, documentId),
    inArray(transactionsStaging.id, rowIds),
  )

  if (action === 'flip') {
    await db
      .update(transactionsStaging)
      .set({
        direction: sql`CASE
          WHEN direction = 'inflow' THEN 'outflow'
          WHEN direction = 'outflow' THEN 'inflow'
          ELSE direction
        END`,
      })
      .where(where)
  } else {
    await db
      .update(transactionsStaging)
      .set({ status: action === 'approve' ? 'approved' : 'rejected' })
      .where(where)
  }

  return { success: true }
}

// ─── Bulk: define direção em TODAS as linhas sem direção do documento ────────
// Usado quando o parser não conseguiu inferir direção (ex: ERP de vendas, onde
// todas as linhas são entradas mas não há coluna explícita de tipo).
export async function setAllPendingDirection(
  documentId: string,
  direction: 'inflow' | 'outflow',
) {
  const { organizationId } = await getAuthContext()

  const result = await db
    .update(transactionsStaging)
    .set({ direction })
    .where(and(
      eq(transactionsStaging.documentId, documentId),
      eq(transactionsStaging.organizationId, organizationId),
      isNull(transactionsStaging.direction),
    ))
    .returning({ id: transactionsStaging.id })

  return { updated: result.length }
}

// ─── Bulk: data de caixa única para todas as linhas sem ela ──────────────────
/**
 * O caso que isto resolve é a fatura de cartão, e é o princípio 13.
 *
 * Numa fatura, a competência é a data de cada compra e o caixa é **o vencimento
 * da fatura, o mesmo para todas as linhas**. Sem isto, cada compra sairia do
 * fluxo no dia da compra E o pagamento da fatura sairia de novo — o valor
 * saindo duas vezes. Preencher 300 linhas à mão não acontece; um campo só, sim.
 *
 * Só toca linha SEM data de caixa: quem editou uma à mão não é sobrescrito.
 */
export async function setAllPendingEffectiveDate(documentId: string, effectiveDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return { error: 'Data inválida.' }
  const { organizationId } = await getAuthContext()

  const result = await db
    .update(transactionsStaging)
    .set({ effectiveDate })
    .where(and(
      eq(transactionsStaging.documentId, documentId),
      eq(transactionsStaging.organizationId, organizationId),
      isNull(transactionsStaging.effectiveDate),
    ))
    .returning({ id: transactionsStaging.id })

  revalidatePath(`/upload/${documentId}/review`)
  return { updated: result.length }
}

// ─── Approve pending + insert approved rows into transactions ─────────────────
export async function approveAndInsert(documentId: string) {
  const { organizationId } = await getAuthContext()

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(
      eq(documents.id, documentId),
      eq(documents.organizationId, organizationId),
    ))
    .limit(1)
  if (!doc) throw new Error('Documento não encontrado')

  // Approve all still-pending rows before inserting
  await db
    .update(transactionsStaging)
    .set({ status: 'approved' })
    .where(and(
      eq(transactionsStaging.documentId, documentId),
      eq(transactionsStaging.organizationId, organizationId),
      eq(transactionsStaging.status, 'pending'),
    ))

  const sourceType = ((doc.metadata as Record<string, unknown>)?.source_type as string) ?? 'other'

  // ── A fonte de RESERVA, preguiçosa ───────────────────────────────────────
  // A fonte de cada linha é a conta que ELA declara, quando essa conta existe no
  // cadastro (`plano.aInserir[i].conta`). Isto responde pelas outras: a conta do
  // arquivo, quando declarada — e é o único ponto desta porta que CRIA conta —,
  // ou a fonte genérica por origem, como sempre.
  //
  // Preguiçosa porque agora existe o caso em que nenhuma linha precisa dela:
  // arquivo cujas linhas todas resolvem não deve mais criar a `data_sources`
  // "Upload — …" que nasceria sem uso.
  const contaDoArquivo = lerContaDoDocumento(doc)

  async function fonteDeReserva(): Promise<{ error: string } | { id: string }> {
    if (contaDoArquivo) {
      const conta = await garantirContaManual(
        organizationId, contaDoArquivo.nome, contaDoArquivo.tipo, contaDoArquivo.numero,
      )
      if ('error' in conta) return { error: conta.error }
      return { id: conta.dataSourceId }
    }

    let [dataSource] = await db
      .select()
      .from(dataSources)
      .where(and(
        eq(dataSources.organizationId, organizationId),
        eq(dataSources.provider, 'upload'),
        eq(dataSources.type, sourceType),
      ))
      .limit(1)

    if (!dataSource) {
      ;[dataSource] = await db
        .insert(dataSources)
        .values({
          organizationId,
          type: sourceType,
          provider: 'upload',
          name: `Upload — ${SOURCE_LABELS[sourceType] ?? 'Manual'}`,
        })
        .returning()
    }

    if (!dataSource) throw new Error('Não foi possível criar a fonte de dados. Tente novamente.')
    return { id: dataSource.id }
  }

  // ── As linhas, NA ORDEM DO ARQUIVO ───────────────────────────────────────
  // O `orderBy` não é estética. A chave de dedup numera as repetições de linhas
  // idênticas — dois cafés de R$ 15 no mesmo dia são dois lançamentos legítimos
  // e recebem chaves distintas. Sem ordem determinística, a numeração muda entre
  // execuções e o mesmo arquivo passa a gerar chaves diferentes: a dedup
  // deixaria de reconhecer o próprio trabalho.
  const approved = await db
    .select()
    .from(transactionsStaging)
    .where(and(
      eq(transactionsStaging.documentId, documentId),
      eq(transactionsStaging.organizationId, organizationId),
      eq(transactionsStaging.status, 'approved'),
    ))
    .orderBy(transactionsStaging.rowIndex)

  // ── O plano: normalização pelo contrato + deduplicação ───────────────────
  // O filtro anterior era `r.date && r.amount && r.direction`, e é ele que
  // engolia o balanço inteiro: uma linha de BP não tem data nem sentido
  // próprios — tem a data do ARQUIVO e o lado vem da natureza.
  const plano = await planejarStaging(organizationId, doc, approved)
  if ('error' in plano) return { error: plano.error }

  const skipped = plano.recusadas.length

  if (plano.aInserir.length === 0) {
    return {
      inserted: 0, skipped, total: approved.length, csvMatched: 0,
      duplicadas: plano.duplicadas, recusadas: plano.recusadas.slice(0, 20),
      categorizationDispatched: true,
    }
  }

  // Carrega contexto da org UMA vez (folhas com parentName) pra tentar match
  // determinístico contra Categoria/Natureza Pai/Filho que vieram do CSV.
  // Determina o domínio (DRE vs BP) pelo report_type do documento, igual
  // o categorizer faz.
  const orgCtx = await loadOrgContext(organizationId)
  const documentDomain = domainFromReportType(doc.reportType)
  const bpTypeSet = new Set<string>(BP_TYPES)
  const domainLeaves = orgCtx.categories.filter(c =>
    documentDomain === 'bp' ? bpTypeSet.has(c.type) : !bpTypeSet.has(c.type),
  )

  // A reserva só é resolvida (e só cria conta ou fonte) se alguma linha precisar.
  let reserva: string | null = null
  if (plano.aInserir.some(n => !n.conta)) {
    const r = await fonteDeReserva()
    if ('error' in r) return { error: r.error }
    reserva = r.id
  }

  // Insert in batches of 100 and collect IDs for categorization.
  // csvMatchedIds NÃO entra no batch-inserted event (já classificado, não
  // precisa passar pelo categorizer LLM).
  const BATCH = 100
  const insertedIds: string[] = []
  const csvMatchedIds: string[] = []

  for (let i = 0; i < plano.aInserir.length; i += BATCH) {
    const batch = plano.aInserir.slice(i, i + BATCH)
    const values = batch.map(({ staging: r, valor, chave, conta, contaDeclarada }) => {
      const raw = (r.rawData ?? {}) as Record<string, unknown>
      const hints = raw.__categoryHints && typeof raw.__categoryHints === 'object'
        ? (raw.__categoryHints as Record<string, string>)
        : null
      const mapping = raw.__categoryMapping && typeof raw.__categoryMapping === 'object'
        ? (raw.__categoryMapping as CsvCategoryMapping)
        : null

      const metadata: Record<string, unknown> = { stagingId: r.id, sourceType }
      // O arquivo citou uma conta que o cadastro não tem. As colunas `account_*`
      // são gravadas do mesmo jeito (a chave de dedup depende delas), mas o
      // vínculo de fonte não existe — registrar o nome é o que tornaria um
      // backfill futuro possível sem reprocessar o arquivo.
      if (!conta && contaDeclarada) metadata.contaNaoCadastrada = contaDeclarada.nome
      if (hints && Object.keys(hints).length > 0) metadata.categoryHints = hints
      if (mapping && (mapping.categoriaFilho || mapping.categoriaPai || mapping.tipoNatureza)) metadata.categoryMapping = mapping

      // Camada 0, em duas formas complementares.
      //
      // `findCategoryByCsvMapping` resolve o CSV de ERP com colunas separadas
      // (Pai / Filho / Tipo) e desempate cumulativo — o caminho de sempre.
      //
      // `findCategoryByText` resolve o campo ÚNICO, que é o da coluna `Natureza`
      // do formato canônico e o da linha de balanço (onde a linha É a conta
      // patrimonial). Ele acrescenta o casamento por CÓDIGO, que o primeiro não
      // faz. Para o balanço não é refinamento e sim requisito: sem natureza, a
      // linha entra e `getBpData` — que soma por tipo de categoria — a ignora,
      // deixando `/balanco` vazio depois de uma importação bem-sucedida.
      const csvMatchId =
        findCategoryByCsvMapping(mapping, domainLeaves)
        ?? findCategoryByText(valor.naturezaBruta, domainLeaves)

      return {
        organizationId,
        // A conta da LINHA manda: é o que faz `/contas` contar certo e o filtro
        // de `/transacoes` rotular cada conta com o próprio nome. Sem cadastro
        // que case, cai na reserva — e a linha fica sem vínculo, não sem conta.
        dataSourceId: conta?.dataSourceId ?? reserva!,
        externalId: chave,
        date: valor.date,
        effectiveDate: valor.effectiveDate,
        amount: valor.amount,
        currency: valor.currency,
        direction: valor.direction,
        description: valor.description,
        accountId: valor.accountId,
        accountName: valor.accountName,
        accountType: valor.accountType,
        accountNumber: valor.accountNumber,
        documentId,
        rawData: r.rawData ?? {},
        metadata,
        categoryId: csvMatchId,
        categorizationMethod: csvMatchId ? 'csv_match' : null,
        categorizationConfidence: csvMatchId ? '1.0' : null,
        needsReview: false,
        status: 'confirmed' as const,
      }
    })

    // `ON CONFLICT DO NOTHING` sobre `idx_tx_dedup` é a SEGUNDA barreira: o plano
    // já tirou as duplicadas, mas entre planejar e gravar alguém pode ter
    // importado o mesmo arquivo pelo MCP. O balanço não deduplica — snapshot se
    // substitui — e para ele `chave` é nula, o que já o deixa fora do índice
    // parcial (`WHERE external_id IS NOT NULL`).
    const q = db.insert(transactions).values(values)
    const rows = await (plano.deduplicando ? q.onConflictDoNothing() : q)
      .returning({ id: transactions.id, categoryId: transactions.categoryId })

    for (const row of rows) {
      if (row.categoryId) csvMatchedIds.push(row.id)
      else insertedIds.push(row.id)
    }
  }

  // O relatado é o que ENTROU, não o que foi prometido. A versão anterior
  // devolvia `valid.length` — sem dedup os dois números eram sempre iguais, com
  // dedup passariam a divergir em silêncio.
  const inserted = insertedIds.length + csvMatchedIds.length
  const perdidasNoConflito = plano.aInserir.length - inserted

  // Dispara categorização assíncrona via Inngest SÓ pros que não casaram via
  // CSV. Se o send falhar, NÃO desfazemos os inserts — sinalizamos pro
  // frontend pra usuário poder rodar "Categorizar agora" depois.
  let categorizationDispatched = true
  if (insertedIds.length > 0) {
    try {
      await sendCategorizationEvents(insertedIds, organizationId)
    } catch (err) {
      console.error('[approveAndInsert] sendCategorizationEvents falhou:', err)
      categorizationDispatched = false
    }
  }

  revalidatePath(`/upload/${documentId}/review`)
  revalidatePath('/transacoes')
  // Também quando a conta veio das LINHAS — senão a contagem de `/contas`
  // continuaria em zero e o defeito só teria trocado de camada.
  if (contaDoArquivo || plano.contasDoArquivo.some(c => c.conta)) revalidatePath('/contas')

  return {
    inserted,
    skipped,
    total: approved.length,
    csvMatched: csvMatchedIds.length,
    duplicadas: plano.duplicadas + perdidasNoConflito,
    recusadas: plano.recusadas.slice(0, 20),
    categorizationDispatched,
  }
}
