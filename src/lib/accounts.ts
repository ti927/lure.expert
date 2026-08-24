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

  return rows.map(r => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>
    const conta = (Array.isArray(meta.accounts) ? meta.accounts[0] : null) as
      { subtype?: string; number?: string } | null
    return {
      dataSourceId: r.id,
      accountId: String(meta.accountId ?? ''),
      nome: r.name,
      tipo: lerTipoDeConta(conta?.subtype),
      numero: conta?.number?.trim() || null,
      lancamentos: Number(r.lancamentos ?? 0),
    }
  })
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
