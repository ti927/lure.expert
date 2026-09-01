// Contas manuais — as que não vêm de conexão bancária.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ISTO EXISTE
//
// Levantado em 24/ago, respondendo à pergunta "onde está o cadastro de contas?".
// A resposta medida: **não existe**. "Conta" morava em três lugares e nenhum era
// cadastro:
//
//   1. `data_sources` (a linha)      → registra a CONEXÃO, não a conta.
//                                       `/contas` lê isto, filtrando `pluggy`.
//   2. `data_sources.metadata.accounts` → array JSON com as contas daquela
//                                       conexão. Único escritor: o sync do
//                                       Pluggy (`sync-pluggy-item.ts`).
//   3. `transactions.account_*`      → 4 colunas de texto, SEM FK. É o que o
//                                       filtro de `/transacoes` agrupa.
//
// Nada liga (2) a (3): os ids batem porque o mesmo job escreve os dois. Não há
// constraint que perceba se divergirem.
//
// Consequência prática: **conta caixa não tinha como existir**, nem conta
// corrente de banco que o Open Finance não alcança — o único escritor do array
// era o Pluggy. E 7.762 de 7.762 lançamentos importados por arquivo estavam sem
// conta nenhuma.
//
// ─────────────────────────────────────────────────────────────────────────────
// A ESCOLHA: `data_sources` com `provider='manual'`, SEM TABELA NOVA
//
// `data_sources` já é exatamente "uma fonte de lançamentos" — é o que ela
// significa para o Pluggy e para o upload. Uma conta manual é uma fonte cujo
// sync não existe, e só.
//
// O ganho que decidiu a escolha: `getDataSourcesWithTransactions` (o filtro de
// `/transacoes`) já faz `JOIN data_sources` para pegar o nome da instituição.
// Com a conta manual sendo uma `data_sources` própria com `institutionName`, o
// rótulo sai certo **sem tocar naquela query**. A alternativa (conta só nas
// colunas de `transactions`) faria o filtro exibir a palavra "Banco" literal,
// porque o `?? 'Banco'` é o fallback de quem não tem instituição.
//
// O formato de `metadata.accounts` é o MESMO do Pluggy, de propósito: é o que
// `/contas` já sabe desenhar (`ConnectionMeta` em `contas-client.tsx`).

import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { dataSources, transactions } from '@/db/schema'
import { contaCanonica, lerTipoDeConta, ROTULO_DE_CONTA, type TipoDeConta } from '@/lib/import-contract'

type Exec = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

/**
 * Só leitura. Estreito de propósito: o `Exec` de `staging-import.ts` é
 * `Pick<db,'select'>` e não seria atribuível ao `Exec` largo acima, então a
 * importação não conseguiria repassar o executor que já recebe.
 */
type ExecLeitura = Pick<typeof db, 'select'>

export const PROVIDER_MANUAL = 'manual'

export interface ContaManual {
  dataSourceId: string
  /** `transactions.account_id` — derivado do nome, determinístico (`arq:<slug>`). */
  accountId: string
  nome: string
  tipo: TipoDeConta
  numero: string | null
}

export interface ContaManualComUso extends ContaManual {
  lancamentos: number
}

/**
 * `data_sources.type` continua significando o que sempre significou.
 *
 * O Pluggy grava `'bank'`; o upload grava o `source_type` do documento. Cartão e
 * adquirente ganham o próprio valor para que qualquer leitura futura por tipo de
 * fonte não passe a chamar fatura de extrato.
 */
function tipoDeFonte(tipo: TipoDeConta): string {
  if (tipo === 'CREDIT_CARD') return 'credit_card'
  if (tipo === 'ACQUIRER') return 'acquirer'
  return 'bank'
}

function metadadosDaConta(accountId: string, nome: string, tipo: TipoDeConta, numero: string | null) {
  return {
    manual: true,
    // Lido por `getDataSourcesWithTransactions` para montar o rótulo do filtro.
    institutionName: nome,
    // Mesmo formato do Pluggy — é o que `/contas` sabe desenhar.
    accounts: [{
      id: accountId,
      name: nome,
      marketingName: null,
      type: tipo === 'CREDIT_CARD' ? 'CREDIT' : 'BANK',
      subtype: tipo,
      number: numero ?? '',
    }],
    accountId,
  }
}

/**
 * Acha ou cria a conta manual, e devolve a identidade dela.
 *
 * A identidade é o **slug do nome** (`arq:itau-pj`), não o texto cru. É o que
 * faz "Itaú PJ", "itau pj" e "ITAU PJ" serem a mesma conta em arquivos
 * diferentes — `norm` derruba acento e caixa. Duas grafias realmente distintas
 * ("Itaú PJ" × "Itaú Pessoa Jurídica") continuam sendo duas contas, e é por isso
 * que a tela oferece as existentes antes de deixar digitar uma nova.
 *
 * **A conta existente vence no nome.** Chamar de novo com outra grafia da mesma
 * conta ("  caixa " para uma "Caixa" que já existe) NÃO renomeia: importar um
 * arquivo não pode mudar em silêncio o rótulo que a pessoa vê em `/contas` e no
 * filtro de `/transacoes`. Tipo e número só são preenchidos quando faltavam —
 * o arquivo completa o cadastro, nunca o sobrescreve.
 */
export async function garantirContaManual(
  organizationId: string,
  nome: string,
  tipo?: string | null,
  numero?: string | null,
  exec: Exec = db,
): Promise<{ error: string } | ContaManual> {
  const limpo = (nome ?? '').trim()
  if (!limpo) return { error: 'Informe o nome da conta.' }
  if (limpo.length > 200) return { error: 'O nome da conta é longo demais (máximo 200 caracteres).' }

  const canonica = contaCanonica(limpo, tipo, numero)
  if (!canonica.accountId) return { error: 'Nome de conta inválido.' }

  const t = lerTipoDeConta(tipo)
  const num = canonica.accountNumber
  const meta = metadadosDaConta(canonica.accountId, limpo, t, num)

  const [existente] = await exec
    .select({ id: dataSources.id, name: dataSources.name, metadata: dataSources.metadata })
    .from(dataSources)
    .where(and(
      eq(dataSources.organizationId, organizationId),
      eq(dataSources.provider, PROVIDER_MANUAL),
      sql`${dataSources.metadata}->>'accountId' = ${canonica.accountId}`,
    ))
    .limit(1)

  if (existente) {
    const metaAtual = (existente.metadata ?? {}) as Record<string, unknown>
    const contaAtual = (Array.isArray(metaAtual.accounts) ? metaAtual.accounts[0] : null) as
      { subtype?: string; number?: string } | null

    const nomeFinal = existente.name
    const tipoFinal = tipo ? t : lerTipoDeConta(contaAtual?.subtype)
    const numeroFinal = num ?? (contaAtual?.number?.trim() || null)

    await exec
      .update(dataSources)
      .set({
        name: nomeFinal,
        type: tipoDeFonte(tipoFinal),
        metadata: metadadosDaConta(canonica.accountId, nomeFinal, tipoFinal, numeroFinal),
        updatedAt: new Date(),
      })
      .where(eq(dataSources.id, existente.id))
    return {
      dataSourceId: existente.id, accountId: canonica.accountId,
      nome: nomeFinal, tipo: tipoFinal, numero: numeroFinal,
    }
  }

  const [criada] = await exec
    .insert(dataSources)
    .values({
      organizationId,
      type: tipoDeFonte(t),
      provider: PROVIDER_MANUAL,
      name: limpo,
      status: 'active',
      metadata: meta,
    })
    .returning({ id: dataSources.id })

  return { dataSourceId: criada.id, accountId: canonica.accountId, nome: limpo, tipo: t, numero: num }
}

/**
 * As contas manuais da organização, com quantos lançamentos cada uma carrega.
 *
 * A contagem é o que decide se a conta pode ser apagada, e é o que a tela mostra
 * — sem ela, "apagar conta" seria uma decisão às cegas sobre dado contábil.
 */
export async function listarContasManuais(
  organizationId: string,
  exec: Exec = db,
): Promise<ContaManualComUso[]> {
  const rows = await exec
    .select({
      id: dataSources.id,
      name: dataSources.name,
      metadata: dataSources.metadata,
      // `${dataSources}.id`, NÃO `${dataSources.id}` — ver SCHEMA_DECISIONS
      // Decisão 18. Numa consulta SEM join o Drizzle emite a coluna sem
      // qualificar, o `"id"` é capturado pelo escopo do subselect e a correlação
      // vira `tx.data_source_id = tx.id`: constante falsa, sem erro. Aqui isso
      // devolveria 0 lançamentos para toda conta — e `apagarContaManual`
      // passaria a autorizar apagar conta em uso.
      lancamentos: sql<number>`(
        SELECT count(*)::int FROM ${transactions} tx WHERE tx.data_source_id = ${dataSources}.id
      )`,
    })
    .from(dataSources)
    .where(and(
      eq(dataSources.organizationId, organizationId),
      eq(dataSources.provider, PROVIDER_MANUAL),
    ))
    .orderBy(dataSources.name)

  return rows.map(r => ({ ...contaDeLinha(r.id, r.name, r.metadata), lancamentos: Number(r.lancamentos ?? 0) }))
}

/** A linha de `data_sources` vira a identidade da conta. Uma leitura do metadata, não duas. */
function contaDeLinha(id: string, name: string, metadata: unknown): ContaManual {
  const meta = (metadata ?? {}) as Record<string, unknown>
  const conta = (Array.isArray(meta.accounts) ? meta.accounts[0] : null) as
    { subtype?: string; number?: string } | null
  return {
    dataSourceId: id,
    accountId: String(meta.accountId ?? ''),
    nome: name,
    tipo: lerTipoDeConta(conta?.subtype),
    numero: conta?.number?.trim() || null,
  }
}

/**
 * As contas manuais da organização indexadas pela IDENTIDADE (`arq:<slug>`).
 *
 * A chave é a mesma que `garantirContaManual` usa para achar a conta existente
 * (`metadata->>'accountId'`), derivada por `contaCanonica`. É o que faz
 * "Caixa Av. D", "Caixa Av D" e "  caixa   av. d " resolverem para a MESMA conta
 * — a regra de identidade fica escrita uma vez só, e as duas portas de arquivo
 * (a tela e o MCP) casam nome com cadastro do mesmo jeito.
 *
 * Uso: `mapa.get(contaCanonica(nome).accountId ?? '')`.
 *
 * **NÃO reusar `listarContasManuais` no lugar desta.** Aquela carrega a
 * subconsulta de contagem por conta, que numa importação roda à toa — e é
 * exatamente a construção que a Decisão 18 morde (ver o comentário dela). Aqui
 * não há subconsulta correlacionada: imunidade por construção.
 */
export async function mapaDeContasManuais(
  organizationId: string,
  exec: ExecLeitura = db,
): Promise<Map<string, ContaManual>> {
  const rows = await exec
    .select({ id: dataSources.id, name: dataSources.name, metadata: dataSources.metadata })
    .from(dataSources)
    .where(and(
      eq(dataSources.organizationId, organizationId),
      eq(dataSources.provider, PROVIDER_MANUAL),
    ))

  const mapa = new Map<string, ContaManual>()
  for (const r of rows) {
    const c = contaDeLinha(r.id, r.name, r.metadata)
    if (c.accountId) mapa.set(c.accountId, c)
  }
  return mapa
}

/**
 * Uma conta citada por um arquivo de importação — no cabeçalho ou nas linhas.
 *
 * Mora aqui e não em `staging-import.ts` porque as duas portas a devolvem: a
 * tela de revisão a usa para avisar antes do clique, e `prever_importacao` para
 * dizer ao modelo o que não vai vincular.
 */
export interface ResumoDeContaDoArquivo {
  /** A grafia como o arquivo escreveu — a primeira vista dela. */
  nomeDeclarado: string
  /** `arq:<slug>`. Duas grafias do mesmo nome compartilham. */
  accountId: string
  /** A conta cadastrada que casou. `null` NÃO cria nada: a linha entra sem vínculo. */
  conta: ContaManual | null
  /** Quantas linhas normalizadas citam esta conta. */
  linhas: number
  /** Veio do cabeçalho do documento, não da coluna das linhas. */
  doCabecalho: boolean
}

export interface ContaUsada {
  /** `transactions.account_id` — o valor que o filtro `contas` do motor espera. */
  accountId: string
  nome: string | null
  tipo: string | null
  /** O número mais recente. Um cartão com adicional tem mais de um. */
  numero: string | null
  /** Quantos números distintos o mesmo id já carregou (adicional, renumeração). */
  numerosDistintos: number
  lancamentos: number
  periodo: { de: string; ate: string } | null
  origem: string | null
  /** Outro accountId tem o MESMO nome — sem isto, os dois são indistinguíveis. */
  nomeAmbiguo: boolean
}

/**
 * TODAS as contas que aparecem em lançamentos — não só as manuais.
 *
 * Existe porque o filtro `contas` do motor e o `contaId` que várias leituras
 * devolvem falam de `transactions.account_id`, que vem de qualquer origem
 * (Pluggy, upload, manual). `listarContasManuais` cobre só o cadastro próprio, e
 * era a única listagem — então não havia como traduzir um `contaId` recebido
 * numa resposta em algo legível, nem escolher entre duas contas de nome igual.
 * Achado 4 do diagnóstico do MCP, 26/ago.
 *
 * Lê de `transactions` e não de `data_sources` porque é lá que o id vive: as
 * quatro colunas de conta são desnormalizadas e sem FK (ver o cabeçalho deste
 * arquivo), então a fonte da verdade do que EXISTE é o uso.
 */
export async function listarContasUsadas(
  organizationId: string,
  exec: Exec = db,
): Promise<ContaUsada[]> {
  const linhas = await exec.execute<{
    account_id: string
    nome: string | null
    tipo: string | null
    numero: string | null
    numeros_distintos: number
    lancamentos: number
    de: string | null
    ate: string | null
    origem: string | null
  }>(sql`
    SELECT
      t.account_id::text AS account_id,
      -- O nome e o tipo do lançamento MAIS RECENTE: conta renomeada mostra o
      -- nome de hoje, não o de dois anos atrás.
      (ARRAY_AGG(t.account_name  ORDER BY t.date DESC NULLS LAST))[1] AS nome,
      (ARRAY_AGG(t.account_type  ORDER BY t.date DESC NULLS LAST))[1] AS tipo,
      (ARRAY_AGG(t.account_number ORDER BY t.date DESC NULLS LAST))[1] AS numero,
      COUNT(DISTINCT t.account_number)::int AS numeros_distintos,
      COUNT(*)::int AS lancamentos,
      MIN(t.date) AS de,
      MAX(t.date) AS ate,
      (ARRAY_AGG(ds.provider ORDER BY t.date DESC NULLS LAST))[1] AS origem
    FROM transactions t
    LEFT JOIN data_sources ds ON ds.id = t.data_source_id
    WHERE t.organization_id = ${organizationId}::uuid
      AND t.account_id IS NOT NULL
    GROUP BY t.account_id
    ORDER BY COUNT(*) DESC
  `)

  // Homônimo é o defeito que o diagnóstico encontrou no dado real: duas contas
  // "itau" com ids diferentes, indistinguíveis na resposta. Marcar é melhor que
  // renomear por conta própria — o nome é do usuário.
  const porNome = new Map<string, number>()
  for (const l of linhas) {
    const chave = (l.nome ?? '').trim().toLowerCase()
    if (chave) porNome.set(chave, (porNome.get(chave) ?? 0) + 1)
  }

  return linhas.map(l => ({
    accountId: l.account_id,
    nome: l.nome,
    tipo: l.tipo,
    numero: l.numero,
    numerosDistintos: Number(l.numeros_distintos ?? 0),
    lancamentos: Number(l.lancamentos ?? 0),
    periodo: l.de && l.ate ? { de: l.de, ate: l.ate } : null,
    origem: l.origem,
    nomeAmbiguo: (porNome.get((l.nome ?? '').trim().toLowerCase()) ?? 0) > 1,
  }))
}

/**
 * Apagar conta manual.
 *
 * **Recusa quando há lançamento**, e não é conservadorismo: `transactions
 * .data_source_id` é `NOT NULL` e a FK não tem `ON DELETE`, então o banco
 * recusaria de qualquer forma — com um erro de constraint em vez de uma frase.
 * A alternativa seria apagar os lançamentos junto, o que transformaria "arrumei
 * o nome da conta" em "apaguei a contabilidade". Renomear resolve o caso real.
 */
export async function apagarContaManual(
  organizationId: string,
  dataSourceId: string,
  exec: Exec = db,
): Promise<{ error: string } | { ok: true }> {
  const [alvo] = await exec
    .select({
      id: dataSources.id,
      nome: dataSources.name,
      // `${dataSources}.id`, NÃO `${dataSources.id}` — ver SCHEMA_DECISIONS
      // Decisão 18. Numa consulta SEM join o Drizzle emite a coluna sem
      // qualificar, o `"id"` é capturado pelo escopo do subselect e a correlação
      // vira `tx.data_source_id = tx.id`: constante falsa, sem erro. Aqui isso
      // devolveria 0 lançamentos para toda conta — e `apagarContaManual`
      // passaria a autorizar apagar conta em uso.
      lancamentos: sql<number>`(
        SELECT count(*)::int FROM ${transactions} tx WHERE tx.data_source_id = ${dataSources}.id
      )`,
    })
    .from(dataSources)
    .where(and(
      eq(dataSources.id, dataSourceId),
      eq(dataSources.organizationId, organizationId),
      eq(dataSources.provider, PROVIDER_MANUAL),
    ))
    .limit(1)

  if (!alvo) return { error: 'Conta não encontrada.' }
  if (Number(alvo.lancamentos) > 0) {
    return {
      error: `"${alvo.nome}" tem ${alvo.lancamentos} lançamento${Number(alvo.lancamentos) === 1 ? '' : 's'} ` +
        'e não pode ser apagada. Renomeie a conta, ou apague os lançamentos em Transações primeiro.',
    }
  }

  // Segunda barreira: a contagem acima é uma fotografia, e a FK é a verdade.
  // Sem isto, uma importação concorrente transformaria "não dá para apagar" num
  // erro de constraint cru na tela.
  try {
    await exec.delete(dataSources).where(eq(dataSources.id, dataSourceId))
  } catch {
    return { error: `"${alvo.nome}" passou a ser usada por lançamentos e não pode ser apagada.` }
  }
  return { ok: true }
}

/** Rótulo de uma conta manual, no mesmo formato do filtro de `/transacoes`. */
export function rotuloDaConta(c: Pick<ContaManual, 'nome' | 'tipo' | 'numero'>): string {
  const partes = [c.nome, ROTULO_DE_CONTA[c.tipo]]
  if (c.numero) partes.push(c.numero)
  return partes.join(' · ')
}
