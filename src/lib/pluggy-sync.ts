/**
 * O miolo da gravação do sync do Pluggy — fora do job para ser exercitável
 * direto contra o banco, numa transação revertida.
 *
 * Nasceu do relatório de 01/11 (agente do app.lure) com quatro defeitos, todos
 * conferidos no código e no banco em 03/11:
 *
 * 1. **Data em UTC.** O Pluggy manda horários como `T02:59:59Z`, que em Brasília
 *    é 23:59 do dia ANTERIOR; gravar `toISOString()` punha o lançamento no dia
 *    seguinte — e, na virada, no mês seguinte da DRE. 530 de 5.983 linhas.
 * 2. **Status congelado.** `ON CONFLICT DO NOTHING` nunca atualizava o que já
 *    entrou: a pendente que o banco efetivava com o mesmo id ficava pendente para
 *    sempre, e a que ele efetivava com OUTRO id virava duplicata.
 * 3. (cadastro de conexão — fora deste arquivo)
 * 4. **A janela não avançava.** O sync gravava o início da janela lida, não o fim.
 *
 * O que NÃO se toca ao atualizar: natureza, dimensões, rateio, revisão, status
 * interno — tudo que é trabalho de quem classificou. E data/valor/descrição só
 * mudam se ainda forem os que o Pluggy mandou da outra vez: editado à mão, casado
 * com NF-e (a data passa a ser a da emissão) ou rateado (o banco recusaria o
 * valor novo), fica como está.
 */

import { sql } from 'drizzle-orm'
import { timingSafeEqual } from 'node:crypto'
import { db } from '@/db'
import { transactions } from '@/db/schema'

type Exec = typeof db

const FORMATO_DATA_BRASILIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
})

/**
 * A data do calendário em Brasília (`YYYY-MM-DD`). `en-CA` porque é o locale
 * que formata já em ISO; `America/Sao_Paulo` e não `−3` fixo pelo mesmo motivo
 * de `sync-schedule.ts` — o horário de verão é revogável por decreto.
 */
export function dataEmBrasilia(quando: Date | string): string {
  return FORMATO_DATA_BRASILIA.format(typeof quando === 'string' ? new Date(quando) : quando)
}

/** `YYYY-MM-DD` deslocado em dias, sem passar por fuso. */
export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Até onde a releitura volta para alcançar as pendentes. Uma compra no cartão
 * fica pendente até a fatura fechar — ~40 dias no pior caso. Mais que isso não
 * vale a releitura em todo webhook; quem quiser, sincroniza pela tela com a data.
 */
export const JANELA_DAS_PENDENTES_DIAS = 45

/**
 * O início da releitura: o pedido, estendido para trás até a pendente mais antiga
 * (um dia antes dela), sem passar da janela das pendentes. Sem isto, a janela que
 * agora avança (defeito 4) deixaria de rever justamente as pendentes.
 */
export function inicioDaReleitura(pedido: string, pendenteMaisAntiga: string | null, hoje: string): string {
  if (!pendenteMaisAntiga) return pedido
  const limite = somarDias(hoje, -JANELA_DAS_PENDENTES_DIAS)
  const alvo = somarDias(pendenteMaisAntiga, -1)
  const estendido = alvo < limite ? limite : alvo
  return estendido < pedido ? estendido : pedido
}

/** A data da pendente ativa mais antiga da conexão, em Brasília. */
export async function pendenteMaisAntiga(
  exec: Exec, organizationId: string, dataSourceId: string,
): Promise<string | null> {
  const [r] = await exec.execute<{ d: string | null }>(sql`
    SELECT MIN(((raw_data->>'date')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date)::text AS d
      FROM transactions
     WHERE organization_id = ${organizationId}::uuid
       AND data_source_id  = ${dataSourceId}::uuid
       AND raw_data->>'status' = 'PENDING'
       AND status NOT IN ('duplicate', 'ignored')`)
  return r?.d ?? null
}

export type LinhaPluggy = typeof transactions.$inferInsert

/**
 * Insere o que é novo e atualiza o que o Pluggy mudou desde a última leitura.
 *
 * `setWhere` compara o `raw_data` inteiro: releitura sem mudança não escreve nada
 * (nem `updated_at`). `xmax = 0` no RETURNING separa linha nova de atualizada —
 * só a nova vai para categorização e conciliação.
 */
export async function gravarLancamentosPluggy(
  exec: Exec, linhas: LinhaPluggy[],
): Promise<{ inseridos: string[]; atualizados: string[] }> {
  if (linhas.length === 0) return { inseridos: [], atualizados: [] }

  // A data e o valor que o Pluggy mandou da OUTRA vez — se a linha ainda os tem,
  // ninguém mexeu nela. As duas datas porque as linhas antigas foram gravadas em
  // UTC; a correção de 03/11 as alinha, mas o sync não pode depender disso.
  const dataAnteriorUtc = sql.raw(`((transactions.raw_data->>'date')::timestamptz AT TIME ZONE 'UTC')::date`)
  const dataAnteriorBr  = sql.raw(`((transactions.raw_data->>'date')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date`)
  const dataIntocada = sql`(transactions.invoice_id IS NULL
    AND transactions.date IN (${dataAnteriorUtc}, ${dataAnteriorBr}))`
  const caixaIntocada = sql`(transactions.invoice_id IS NULL
    AND (transactions.effective_date IS NULL OR transactions.effective_date IN (${dataAnteriorUtc}, ${dataAnteriorBr})))`
  const valorIntocado = sql`(transactions.amount = abs((transactions.raw_data->>'amount')::numeric)
    AND NOT EXISTS (SELECT 1 FROM transaction_allocations ta WHERE ta.transaction_id = transactions.id))`
  const descricaoIntocada = sql`(transactions.description = transactions.raw_data->>'description')`

  const rows = await exec
    .insert(transactions)
    .values(linhas)
    .onConflictDoUpdate({
      target: [transactions.dataSourceId, transactions.externalId],
      targetWhere: sql`external_id IS NOT NULL`,
      set: {
        rawData:       sql`excluded.raw_data`,
        date:          sql`CASE WHEN ${dataIntocada} THEN excluded.date ELSE transactions.date END`,
        effectiveDate: sql`CASE WHEN ${caixaIntocada} THEN excluded.effective_date ELSE transactions.effective_date END`,
        amount:        sql`CASE WHEN ${valorIntocado} THEN excluded.amount ELSE transactions.amount END`,
        description:   sql`CASE WHEN ${descricaoIntocada} THEN excluded.description ELSE transactions.description END`,
        updatedAt:     sql`now()`,
      },
      setWhere: sql`transactions.raw_data IS DISTINCT FROM excluded.raw_data`,
    })
    .returning({ id: transactions.id, inserido: sql<boolean>`(xmax = 0)` })

  return {
    inseridos:   rows.filter(r => r.inserido).map(r => r.id),
    atualizados: rows.filter(r => !r.inserido).map(r => r.id),
  }
}

/**
 * Pendente que o Pluggy deixou de devolver foi substituída (o banco a efetivou
 * com outro id) ou cancelada. Sai das somas como `duplicate` — o mesmo status que
 * toda leitura analítica já exclui —, apontando para a gêmea efetivada quando há
 * uma. Não apaga: a linha fica, com o motivo no `metadata`.
 *
 * Só vale DENTRO da cobertura: o que o Pluggy não devolveu porque a janela não
 * chegou lá não sumiu. Por isso `coberturaDesde` é o dia seguinte ao início da
 * janela (o filtro de data do Pluggy não fala o nosso fuso) E não antes da data
 * mais antiga que ele de fato devolveu — conector com histórico curto não pode
 * apagar o passado. Conta que voltou vazia não marca nada.
 */
export async function marcarPendentesQueSumiram(exec: Exec, p: {
  organizationId: string
  dataSourceId: string
  accountId: string
  idsLidos: string[]
  coberturaDesde: string
}): Promise<number> {
  if (p.idsLidos.length === 0) return 0
  // Ids do Pluggy são UUIDs: sem vírgula, então a lista vai como um texto só.
  // (`ANY(${array})` não converte neste driver — o achado 10 do hardening.)
  const lidos = p.idsLidos.join(',')
  const dataBr = sql.raw(`((t.raw_data->>'date')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date`)

  const rows = await exec.execute<{ id: string }>(sql`
    UPDATE transactions t
       SET status = 'duplicate',
           needs_review = false,
           duplicate_of = (
             SELECT q.id FROM transactions q
              WHERE q.organization_id = t.organization_id
                AND q.data_source_id  = t.data_source_id
                AND q.account_id      = t.account_id
                AND q.id <> t.id
                AND q.direction = t.direction
                AND q.amount    = t.amount
                AND abs(q.date - t.date) <= 3
                AND q.raw_data->>'status' = 'POSTED'
                AND q.status NOT IN ('duplicate', 'ignored')
              ORDER BY similarity(q.description, t.description) DESC, abs(q.date - t.date)
              LIMIT 1),
           metadata = (t.metadata - 'reconciliationPending' - 'reconciliationCandidateId'
                                  - 'reconciliationScore' - 'reconciliationKind')
                      || jsonb_build_object('substituidaEm', now(), 'motivoSubstituicao', 'pendente_sumiu_do_pluggy'),
           updated_at = now()
     WHERE t.organization_id = ${p.organizationId}::uuid
       AND t.data_source_id  = ${p.dataSourceId}::uuid
       AND t.account_id      = ${p.accountId}
       AND t.raw_data->>'status' = 'PENDING'
       AND t.status NOT IN ('duplicate', 'ignored')
       AND t.external_id IS NOT NULL
       AND t.external_id <> ALL (string_to_array(${lidos}, ','))
       AND ${dataBr} >= ${p.coberturaDesde}::date
    RETURNING t.id`)
  return rows.length
}

/**
 * O webhook do Pluggy não assina o corpo, então o segredo vai na URL
 * (`?token=`). Sem `PLUGGY_WEBHOOK_SECRET` configurado, aceita como antes — o
 * deploy não pode derrubar o webhook antes de a URL nova estar no painel.
 */
export function webhookAutorizado(tokenRecebido: string | null, segredo: string | undefined): boolean {
  const esperado = (segredo ?? '').trim()
  if (!esperado) return true
  if (!tokenRecebido) return false
  const a = Buffer.from(tokenRecebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}
