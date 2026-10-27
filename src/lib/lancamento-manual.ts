// Lançamento manual — o lançamento digitado na conferência de uma conta MANUAL.
//
// Pedido do Julio (27/out): poder lançar à mão quando o saldo não bate, mas
// DESTACADO como manual e não importado, com quem fez, data e hora, e o
// dispositivo. Decisão 30.
//
// Três regras:
//
//  1. **Só em conta manual.** Na conta do Pluggy o banco manda os lançamentos, e
//     um lançamento à mão ali vira duplicata quando o sync trouxer o real; e o
//     lançamento do Pluggy apagado por engano VOLTA por ressincronização com data
//     de corte. O manual não tem de onde voltar — daí a regra 3.
//  2. **A autoria mora no `metadata` do lançamento** (`origem: 'manual'`, quem,
//     quando, dispositivo) e é carimbada pelo SERVIDOR — o cliente manda só o
//     identificador do navegador, que não é prova de nada e é dito como pista.
//     O registro em `agent_events` guarda o mesmo, porque o `metadata` some com o
//     lançamento.
//  3. **Apagar guarda o retrato.** Ao apagar um lançamento manual, o evento
//     `lancamento_manual.apagado` guarda a linha inteira e as partes do rateio, e
//     `restaurarLancamentoManual` a devolve — com o MESMO id, então restaurar
//     duas vezes é recusado pelo próprio banco.
//
// Fora de `'use server'` para ser exercitável por script.

import { z } from 'zod'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  transactions, dataSources, agentEvents, categories,
  costCenters, businessUnits, legalEntities, contacts,
} from '@/db/schema'
import { lerTipoDeConta } from '@/lib/import-contract'
import { ORIGEM_MANUAL, type MetadadosManuais } from '@/lib/lancamento-manual-types'

type Exec = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

export { ORIGEM_MANUAL, ehManual, type MetadadosManuais } from '@/lib/lancamento-manual-types'
/** Por quanto tempo um lançamento manual apagado pode ser restaurado. */
export const DIAS_PARA_RESTAURAR = 90

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.')
const idOpcional = z.string().uuid().nullable().optional()

export const lancamentoManualSchema = z.object({
  /** Competência: quando o fato aconteceu. */
  data: dataIso,
  /** Caixa: quando o dinheiro se moveu. Em branco = a competência. */
  dataCaixa: dataIso.nullable().optional(),
  valor: z.number().finite().positive('O valor é sempre positivo; o sentido diz se entra ou sai.')
    .refine(v => v < 1e13, 'Valor grande demais.'),
  sentido: z.enum(['inflow', 'outflow']),
  descricao: z.string().trim().min(1, 'Informe a descrição.').max(300),
  categoryId: idOpcional,
  costCenterId: idOpcional,
  businessUnitId: idOpcional,
  legalEntityId: idOpcional,
  contactId: idOpcional,
})
export type LancamentoManualInput = z.input<typeof lancamentoManualSchema>

/** Quem lançou, e de onde. Carimbado pelo servidor, exceto `dispositivoId`. */
export interface Autoria {
  userId: string
  email: string | null
  userAgent: string | null
  ip: string | null
  /** Código aleatório lembrado no navegador — diferencia aparelhos, não os prova. */
  dispositivoId: string | null
}

/**
 * Navegador e sistema, legíveis, a partir do User-Agent. Grosseiro de
 * propósito: é para uma pessoa reconhecer "Chrome no Windows", não para
 * estatística. A ordem dos testes importa — o Edge e o Opera se dizem Chrome, e
 * o Chrome se diz Safari.
 */
export function descreverUserAgent(ua: string | null | undefined): { navegador: string | null; sistema: string | null } {
  if (!ua) return { navegador: null, sistema: null }
  const v = (re: RegExp) => ua.match(re)?.[1]?.split('.')[0]
  const navegador =
    /Edg\//.test(ua) ? `Edge ${v(/Edg\/([\d.]+)/) ?? ''}`.trim()
    : /OPR\//.test(ua) ? `Opera ${v(/OPR\/([\d.]+)/) ?? ''}`.trim()
    : /Firefox\//.test(ua) ? `Firefox ${v(/Firefox\/([\d.]+)/) ?? ''}`.trim()
    : /Chrome\//.test(ua) ? `Chrome ${v(/Chrome\/([\d.]+)/) ?? ''}`.trim()
    : /Safari\//.test(ua) ? `Safari ${v(/Version\/([\d.]+)/) ?? ''}`.trim()
    : null
  const sistema =
    /Windows NT/.test(ua) ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : null
  return { navegador, sistema }
}

/** A conta manual pelo `account_id` (`arq:<slug>`). `null` = não é conta manual. */
async function contaManual(organizationId: string, accountId: string, exec: Pick<typeof db, 'select'>) {
  const [ds] = await exec
    .select({ id: dataSources.id, name: dataSources.name, metadata: dataSources.metadata })
    .from(dataSources)
    .where(and(
      eq(dataSources.organizationId, organizationId),
      eq(dataSources.provider, 'manual'),
      sql`${dataSources.metadata}->>'accountId' = ${accountId}`,
    ))
    .limit(1)
  if (!ds) return null
  const meta = (ds.metadata ?? {}) as Record<string, unknown>
  const c = (Array.isArray(meta.accounts) ? meta.accounts[0] : null) as { subtype?: string; number?: string } | null
  return { dataSourceId: ds.id, nome: ds.name, tipo: lerTipoDeConta(c?.subtype), numero: c?.number?.trim() || null }
}

/** As dimensões informadas existem NESTA organização? (O id vem do cliente.) */
async function validarDimensoes(
  organizationId: string, d: z.infer<typeof lancamentoManualSchema>, exec: Pick<typeof db, 'select'>,
): Promise<string | null> {
  if (d.categoryId) {
    const [cat] = await exec.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.id, d.categoryId), eq(categories.organizationId, organizationId))).limit(1)
    if (!cat) return 'Natureza não encontrada.'
    const [filho] = await exec.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.parentId, d.categoryId), eq(categories.organizationId, organizationId))).limit(1)
    if (filho) return 'Escolha uma Natureza Filho — natureza com subnaturezas não recebe lançamento.'
  }
  const tabelas = [
    [costCenters, d.costCenterId, 'Centro de custo'],
    [businessUnits, d.businessUnitId, 'Unidade de negócio'],
    [legalEntities, d.legalEntityId, 'Entidade'],
    [contacts, d.contactId, 'Contato'],
  ] as const
  for (const [tabela, id, nome] of tabelas) {
    if (!id) continue
    const [r] = await exec.select({ id: tabela.id }).from(tabela)
      .where(and(eq(tabela.id, id), eq(tabela.organizationId, organizationId))).limit(1)
    if (!r) return `${nome} não encontrado.`
  }
  return null
}

/** Cria o lançamento manual. Recusa conta que não seja manual. */
export async function criarLancamentoManual(
  organizationId: string,
  accountId: string,
  entrada: LancamentoManualInput,
  autoria: Autoria,
  exec: Exec = db,
): Promise<{ error: string } | { ok: true; id: string }> {
  const p = lancamentoManualSchema.safeParse(entrada)
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Dados inválidos.' }
  const d = p.data

  const conta = await contaManual(organizationId, accountId, exec)
  if (!conta) {
    return { error: 'Lançamento manual só em conta manual. Numa conta conectada, os lançamentos vêm do banco.' }
  }
  const erro = await validarDimensoes(organizationId, d, exec)
  if (erro) return { error: erro }

  const metadata: MetadadosManuais = {
    origem: ORIGEM_MANUAL,
    lancadoPor: { userId: autoria.userId, email: autoria.email },
    lancadoEm: new Date().toISOString(),
    dispositivo: { ...descreverUserAgent(autoria.userAgent), userAgent: autoria.userAgent, ip: autoria.ip, id: autoria.dispositivoId },
  }

  const [criado] = await exec.insert(transactions).values({
    organizationId,
    dataSourceId: conta.dataSourceId,
    // Prefixo próprio: nunca colide com a chave de dedup das importações (`arq:`).
    externalId: `man:${crypto.randomUUID()}`,
    date: d.data,
    effectiveDate: d.dataCaixa && d.dataCaixa !== d.data ? d.dataCaixa : null,
    amount: d.valor.toFixed(2),
    direction: d.sentido,
    description: d.descricao,
    categoryId: d.categoryId ?? null,
    costCenterId: d.costCenterId ?? null,
    businessUnitId: d.businessUnitId ?? null,
    legalEntityId: d.legalEntityId ?? null,
    contactId: d.contactId ?? null,
    categorizationMethod: d.categoryId ? 'manual' : null,
    needsReview: false,
    status: 'confirmed',
    // A conta do CADASTRO, como as importações fazem desde 20/out.
    accountId,
    accountName: conta.nome,
    accountType: conta.tipo,
    accountNumber: conta.numero,
    metadata: metadata as unknown as Record<string, unknown>,
  }).returning({ id: transactions.id })

  await exec.insert(agentEvents).values({
    organizationId,
    type: 'lancamento_manual.criado',
    entityType: 'transaction',
    entityId: criado.id,
    payload: { accountId, lancamento: { ...d }, autoria: metadata },
  })
  return { ok: true, id: criado.id }
}

/**
 * Chamado por quem apaga lançamentos, ANTES do DELETE: guarda o retrato de cada
 * lançamento manual entre os ids (a linha inteira e as partes do rateio).
 * Os não manuais passam reto — o do Pluggy volta pela ressincronização, o
 * importado volta reimportando o arquivo.
 */
export async function registrarApagamentoDeManuais(
  organizationId: string,
  ids: string[],
  quem: { userId: string; email: string | null },
  exec: Exec = db,
): Promise<number> {
  if (ids.length === 0) return 0
  const retratos = await exec.execute<{ id: string; linha: Record<string, unknown>; partes: unknown[] | null; account_id: string | null }>(sql`
    SELECT t.id::text AS id, t.account_id,
           to_jsonb(t) - 'embedding' AS linha,
           (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.sequence) FROM transaction_allocations a WHERE a.transaction_id = t.id) AS partes
      FROM transactions t
     WHERE t.organization_id = ${organizationId}::uuid
       AND t.id IN (${sql.join(ids.map(i => sql`${i}::uuid`), sql`, `)})
       AND t.metadata->>'origem' = ${ORIGEM_MANUAL}
  `)
  if (retratos.length === 0) return 0
  await exec.insert(agentEvents).values(retratos.map(r => ({
    organizationId,
    type: 'lancamento_manual.apagado',
    entityType: 'transaction',
    entityId: r.id,
    payload: { accountId: r.account_id, apagadoPor: quem, apagadoEm: new Date().toISOString(), linha: r.linha, partes: r.partes ?? [] },
  })))
  return retratos.length
}

export interface ManualApagado {
  eventoId: string
  apagadoEm: string
  apagadoPor: string | null
  data: string
  valor: number
  sentido: string
  descricao: string
  lancadoPor: string | null
}

/** Os lançamentos manuais desta conta apagados nos últimos 90 dias e ainda não restaurados. */
export async function listarManuaisApagados(
  organizationId: string, accountId: string, exec: Pick<typeof db, 'select'> = db,
): Promise<ManualApagado[]> {
  const eventos = await exec
    .select({ id: agentEvents.id, payload: agentEvents.payload, criado: agentEvents.createdAt, entityId: agentEvents.entityId })
    .from(agentEvents)
    .where(and(
      eq(agentEvents.organizationId, organizationId),
      eq(agentEvents.type, 'lancamento_manual.apagado'),
      sql`${agentEvents.payload}->>'accountId' = ${accountId}`,
      sql`${agentEvents.payload}->>'restauradoEm' IS NULL`,
      sql`${agentEvents.createdAt} > now() - make_interval(days => ${DIAS_PARA_RESTAURAR})`,
    ))
    .orderBy(desc(agentEvents.createdAt))
    .limit(100)
  if (eventos.length === 0) return []

  // Um lançamento apagado, restaurado e apagado de novo tem dois eventos; e um
  // que já voltou por outro caminho não está apagado. Fica só o que não existe.
  const existentes = new Set((await exec.select({ id: transactions.id }).from(transactions).where(and(
    eq(transactions.organizationId, organizationId),
    inArray(transactions.id, eventos.map(e => e.entityId).filter((x): x is string => !!x)),
  ))).map(r => r.id))
  const vistos = new Set<string>()

  return eventos.flatMap(e => {
    if (!e.entityId || existentes.has(e.entityId) || vistos.has(e.entityId)) return []
    vistos.add(e.entityId)
    const p = e.payload as { apagadoPor?: { email?: string | null }; linha: Record<string, unknown> }
    const meta = (p.linha.metadata ?? {}) as Partial<MetadadosManuais>
    return [{
      eventoId: e.id,
      apagadoEm: e.criado.toISOString(),
      apagadoPor: p.apagadoPor?.email ?? null,
      data: String(p.linha.date),
      valor: Number(p.linha.amount),
      sentido: String(p.linha.direction),
      descricao: String(p.linha.description),
      lancadoPor: meta.lancadoPor?.email ?? null,
    }]
  })
}

/**
 * Devolve um lançamento manual apagado, com o MESMO id e as partes do rateio.
 * Recusa se o retrato for de outra organização, se já tiver sido restaurado ou
 * se o lançamento existir (a chave primária recusaria de qualquer forma).
 */
export async function restaurarLancamentoManual(
  organizationId: string,
  eventoId: string,
  quem: { userId: string; email: string | null },
  exec: Pick<typeof db, 'transaction'> = db,
): Promise<{ error: string } | { ok: true; id: string }> {
  return exec.transaction(async (tx) => {
    const [ev] = await tx.select().from(agentEvents).where(and(
      eq(agentEvents.id, eventoId),
      eq(agentEvents.organizationId, organizationId),
      eq(agentEvents.type, 'lancamento_manual.apagado'),
    )).limit(1)
    if (!ev || !ev.entityId) return { error: 'Lançamento apagado não encontrado.' }
    const p = ev.payload as { linha: Record<string, unknown>; partes: unknown[]; restauradoEm?: string }
    if (p.restauradoEm) return { error: 'Este lançamento já foi restaurado.' }

    const [existe] = await tx.select({ id: transactions.id }).from(transactions)
      .where(eq(transactions.id, ev.entityId)).limit(1)
    if (existe) return { error: 'Este lançamento já existe — foi restaurado antes.' }

    const agora = new Date().toISOString()
    const linha = {
      ...p.linha,
      metadata: { ...((p.linha.metadata ?? {}) as object), restauradoEm: agora, restauradoPor: quem },
    }
    // `jsonb_populate_record` devolve a linha com TODAS as colunas do retrato —
    // é o que garante que nada (dimensões, conta, datas) volte diferente.
    await tx.execute(sql`
      INSERT INTO transactions SELECT * FROM jsonb_populate_record(NULL::transactions, ${JSON.stringify(linha)}::jsonb)
    `)
    if (Array.isArray(p.partes) && p.partes.length > 0) {
      await tx.execute(sql`
        INSERT INTO transaction_allocations
        SELECT * FROM jsonb_populate_recordset(NULL::transaction_allocations, ${JSON.stringify(p.partes)}::jsonb)
      `)
    }
    await tx.update(agentEvents)
      .set({ payload: { ...p, restauradoEm: agora, restauradoPor: quem } })
      .where(eq(agentEvents.id, eventoId))
    await tx.insert(agentEvents).values({
      organizationId,
      type: 'lancamento_manual.restaurado',
      entityType: 'transaction',
      entityId: ev.entityId,
      payload: { eventoDoApagamento: eventoId, restauradoPor: quem, restauradoEm: agora },
    })
    return { ok: true as const, id: ev.entityId }
  })
}
