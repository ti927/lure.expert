// Análise de fornecedores — o miolo que lê e grava no banco. Fora de `'use server'`
// para ser exercitável por script (scripts/verify-fornecedores.ts). Ver Decisão 33.
//
// A CONSOLIDAÇÃO do fornecedor, em ordem — a primeira que casa decide:
//   1. agrupamento da organização (supplier_groupings): "descrição contém X",
//      opcionalmente só numa Natureza Pai, em lançamento sem contato (ou com
//      contato, se o agrupamento "sobrepõe o contato"); ou
//      qualquer lançamento do contato ligado ao agrupamento;
//   2. o contato do lançamento — ou, num rateado, o das partes quando todas
//      apontam para o mesmo;
//   3. o nome que aparece no extrato casado com o cadastro de contatos (o cadastro
//      quase nunca tem CNPJ; o nome é a ponte);
//   4. o CNPJ do extrato, sem cadastro: agrupa pelo CNPJ;
//   5. a descrição normalizada (marcada com "~").
//
// RATEIO DESCONSIDERADO: cada lançamento entra pelo valor inteiro; a natureza de
// um rateado é a da parte de maior valor. É a mesma escolha da análise que deu
// origem à tela, e o motivo é o pedido: olhar por quem recebe, não por onde o
// custo foi distribuído.

import { sql, and, eq, asc } from 'drizzle-orm'
import { db } from '@/db'
import { agentEvents, supplierGroupings, supplierNegotiations } from '@/db/schema'
import { normalizarDescricao } from '@/lib/descricao-normalizada'
import {
  agrupamentoSchema, itemMesaSchema,
  type Agrupamento, type AgrupamentoInput, type ItemMesa, type ItemMesaInput, type LancamentoFornecedor,
} from '@/lib/fornecedores-types'

type Exec = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>
type Erro = { error: string }

/** Tipos de natureza que são despesa (entram na curva). Sem natureza também entra. */
export const TIPOS_DESPESA = ['cpv', 'sga', 'deducoes_tributarias', 'deducoes_operacionais', 'resultado_financeiro'] as const
const GRUPO_FORA: Record<string, string> = {
  investimentos_retiradas: 'Investimentos (imobilizado/intangível)',
  emprestimos_amortizacoes: 'Pagamento de empréstimos',
  receita_operacional: 'Devoluções de recebimentos',
  transfer: 'Transferências entre contas',
  ir: 'IR e CSLL',
}

// Sufixos societários e palavras de ligação saem antes de comparar nomes: "ASN CARGO
// LOGISTICS LTDA" no extrato e "ASN CARGO LOGISTICS" no cadastro são a mesma empresa.
const SUFIXOS = /\b(ltda|s a|sa|me|epp|eireli|cia|limitada|comercio|servicos|e)\b/g
const nomeComparavel = (s: string) => (normalizarDescricao(s) ?? '').replace(SUFIXOS, ' ').replace(/\s+/g, ' ').trim()

export interface LinhaBruta {
  id: string; date: string; amt: number; description: string; conta: string | null
  rateado: boolean; ctype: string | null; pai_id: string | null; pai: string | null; filho: string | null
  contact_id: string | null; contato: string | null
}

export interface Periodo { de: string; ate: string }

/**
 * As saídas do período, com o fornecedor consolidado. Pela data de COMPETÊNCIA,
 * fora pendentes e duplicados (o mesmo corte do /fluxo e do copiar-do-realizado).
 */
export async function lerSaidasPorFornecedor(exec: Exec, organizationId: string, periodo: Periodo): Promise<LancamentoFornecedor[]> {
  const brutas = await exec.execute<LinhaBruta & Record<string, unknown>>(sql`
    WITH rat AS (
      SELECT a.transaction_id,
             (array_agg(a.category_id ORDER BY a.amount DESC, a.id))[1] AS cat,
             CASE WHEN count(DISTINCT a.contact_id) = 1 AND bool_and(a.contact_id IS NOT NULL)
                  THEN min(a.contact_id::text)::uuid END AS contato
        FROM transaction_allocations a
        JOIN transactions tt ON tt.id = a.transaction_id
       WHERE tt.organization_id = ${organizationId}::uuid
       GROUP BY a.transaction_id)
    SELECT t.id::text AS id, t.date::text AS date, t.amount::float8 AS amt, t.description, t.account_name AS conta,
           (r.transaction_id IS NOT NULL) AS rateado,
           c.type AS ctype, cp.id::text AS pai_id, cp.name AS pai, c.name AS filho,
           coalesce(t.contact_id, r.contato)::text AS contact_id, ct.name AS contato
      FROM transactions t
      LEFT JOIN rat r         ON r.transaction_id = t.id
      LEFT JOIN categories c  ON c.id  = coalesce(r.cat, t.category_id)
      LEFT JOIN categories cp ON cp.id = c.parent_id
      LEFT JOIN contacts ct   ON ct.id = coalesce(t.contact_id, r.contato)
     WHERE t.organization_id = ${organizationId}::uuid
       AND t.direction = 'outflow'
       AND t.status NOT IN ('pending', 'duplicate')
       AND t.date >= ${periodo.de}::date
       AND t.date <= ${periodo.ate}::date
     ORDER BY t.date, t.amount DESC, t.id`)

  // Em sequência, não em paralelo: dentro de uma transação as consultas dividem a conexão.
  const contatos = await exec.execute<{ id: string; name: string; trade_name: string | null }>(sql`
    SELECT id::text AS id, name, trade_name FROM contacts WHERE organization_id = ${organizationId}::uuid`)
  const grupos = await lerAgrupamentos(exec, organizationId)
  return consolidar(Array.from(brutas), Array.from(contatos), grupos.filter((g) => g.isActive))
}

/** A consolidação em si — pura, para o teste poder exercitá-la sem banco. */
export function consolidar(
  brutas: LinhaBruta[],
  contatos: { id: string; name: string; trade_name: string | null }[],
  grupos: Agrupamento[],
): LancamentoFornecedor[] {
  const nomePorId = new Map(contatos.map((c) => [c.id, c.name.trim()]))

  // nome comparável → contato; homônimo (dois contatos com o mesmo nome) sai, para não adivinhar
  const porNome = new Map<string, { id: string; name: string }>()
  const homonimos = new Set<string>()
  for (const c of contatos) for (const nome of [c.name, c.trade_name]) {
    if (!nome) continue
    const k = nomeComparavel(nome)
    if (k.length < 5) continue
    const ja = porNome.get(k)
    if (ja && ja.id !== c.id) homonimos.add(k)
    porNome.set(k, { id: c.id, name: c.name.trim() })
  }
  homonimos.forEach((k) => porNome.delete(k))
  const nomes = Array.from(porNome.keys()).sort((a, b) => b.length - a.length)
  const acharPorNome = (texto: string) => {
    const t = ' ' + nomeComparavel(texto) + ' '
    for (const k of nomes) if (t.includes(' ' + k + ' ')) return porNome.get(k)!
    return null
  }
  const ordenados = [...grupos].sort((a, b) => a.ordem - b.ordem)

  return brutas.map((r) => {
    const descn = normalizarDescricao(r.description) ?? ''
    const cnpj = (r.description.match(/\b(\d{14})\b/) ?? [])[1]
    const grupo = r.ctype == null || (TIPOS_DESPESA as readonly string[]).includes(r.ctype)
      ? 'Despesas' : GRUPO_FORA[r.ctype] ?? 'Outras saídas'

    let chave: string, fornecedor: string, identificacao: string
    const g = ordenados.find((x) =>
      (x.contactId && r.contact_id === x.contactId) ||
      ((!r.contact_id || x.sobrepoeContato) && descn.includes(x.padrao) && (!x.naturezaPaiId || x.naturezaPaiId === r.pai_id)))
    if (g) {
      chave = 'G:' + g.id; fornecedor = g.nome; identificacao = 'Agrupamento: ' + g.nome
    } else if (r.contact_id) {
      chave = 'C:' + r.contact_id; fornecedor = (r.contato ?? nomePorId.get(r.contact_id) ?? '').trim() || '(contato sem nome)'
      identificacao = r.rateado && !r.contato ? 'Contato das partes do rateio' : 'Cadastro de contatos'
    } else {
      const achado = acharPorNome(cnpj ? (r.description.split(cnpj)[1] ?? '') : r.description)
      if (achado) {
        chave = 'C:' + achado.id; fornecedor = achado.name; identificacao = 'Nome no extrato = cadastro'
      } else if (cnpj) {
        chave = 'J:' + cnpj; fornecedor = r.description.split(cnpj)[1]?.replace(/\s+/g, ' ').trim() || cnpj
        identificacao = 'CNPJ no extrato, sem cadastro'
      } else {
        chave = 'D:' + (descn || '(vazia)'); fornecedor = '~ ' + (descn || '(descrição vazia)'); identificacao = 'Só a descrição do extrato'
      }
    }
    return {
      id: r.id, data: r.date, mes: r.date.slice(0, 7), grupo, chave, fornecedor, identificacao,
      valor: Math.round(Number(r.amt) * 100) / 100,
      naturezaPai: r.pai ?? '(sem natureza)', natureza: r.filho ?? '(sem natureza)',
      rateado: !!r.rateado, conta: r.conta ?? '',
      // CPF de pessoa física não precisa ir à tela; o CNPJ identifica o fornecedor e fica
      descricao: r.description.replace(/\b\d{11}\b/g, '[CPF]').replace(/\s+/g, ' ').trim(),
    }
  })
}

// ── agrupamentos ──────────────────────────────────────────────────────────────

export async function lerAgrupamentos(exec: Exec, organizationId: string): Promise<Agrupamento[]> {
  const rows = await exec.select().from(supplierGroupings)
    .where(eq(supplierGroupings.organizationId, organizationId))
    .orderBy(asc(supplierGroupings.ordem), asc(supplierGroupings.createdAt))
  return rows.map((g) => ({
    id: g.id, nome: g.nome, padrao: g.padrao, naturezaPaiId: g.naturezaPaiId, contactId: g.contactId,
    sobrepoeContato: g.sobrepoeContato, ordem: g.ordem, isActive: g.isActive,
  }))
}

/** A natureza pai e o contato precisam ser DESTA organização — senão o id vira oráculo. */
async function validarAlvosDoAgrupamento(exec: Exec, organizationId: string, v: { naturezaPaiId: string | null; contactId: string | null }): Promise<string | null> {
  if (v.naturezaPaiId) {
    // Natureza Pai é a categoria sem pai (o Tipo é coluna, não categoria).
    const [c] = await exec.execute<{ pai: boolean }>(sql`
      SELECT (parent_id IS NULL) AS pai FROM categories
       WHERE id = ${v.naturezaPaiId}::uuid AND organization_id = ${organizationId}::uuid`)
    if (!c) return 'A natureza escolhida não existe nesta organização.'
    if (!c.pai) return 'Escolha uma Natureza Pai, não uma Natureza Filho.'
  }
  if (v.contactId) {
    const [c] = await exec.execute<{ id: string }>(sql`
      SELECT id FROM contacts WHERE id = ${v.contactId}::uuid AND organization_id = ${organizationId}::uuid`)
    if (!c) return 'O contato escolhido não existe nesta organização.'
  }
  return null
}

export async function salvarAgrupamento(exec: Exec, organizationId: string, userId: string, input: AgrupamentoInput, id?: string): Promise<{ id: string } | Erro> {
  const p = agrupamentoSchema.safeParse(input)
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Agrupamento inválido.' }
  const recusa = await validarAlvosDoAgrupamento(exec, organizationId, p.data)
  if (recusa) return { error: recusa }

  let gravadoId: string
  if (id) {
    const r = await exec.update(supplierGroupings).set({ ...p.data })
      .where(and(eq(supplierGroupings.id, id), eq(supplierGroupings.organizationId, organizationId)))
      .returning({ id: supplierGroupings.id })
    if (!r.length) return { error: 'Agrupamento não encontrado.' }
    gravadoId = r[0].id
  } else {
    const [{ prox }] = await exec.execute<{ prox: number }>(sql`
      SELECT coalesce(max(ordem), 0) + 1 AS prox FROM supplier_groupings WHERE organization_id = ${organizationId}::uuid`)
    const r = await exec.insert(supplierGroupings).values({ organizationId, ...p.data, ordem: Number(prox) })
      .returning({ id: supplierGroupings.id })
    gravadoId = r[0].id
  }
  await exec.insert(agentEvents).values({
    organizationId, type: id ? 'fornecedores.agrupamento_alterado' : 'fornecedores.agrupamento_criado',
    entityType: 'supplier_grouping', entityId: gravadoId, payload: { userId, ...p.data },
  })
  return { id: gravadoId }
}

export async function apagarAgrupamento(exec: Exec, organizationId: string, userId: string, id: string): Promise<{ ok: true } | Erro> {
  const r = await exec.delete(supplierGroupings)
    .where(and(eq(supplierGroupings.id, id), eq(supplierGroupings.organizationId, organizationId)))
    .returning({ nome: supplierGroupings.nome, padrao: supplierGroupings.padrao })
  if (!r.length) return { error: 'Agrupamento não encontrado.' }
  await exec.insert(agentEvents).values({
    organizationId, type: 'fornecedores.agrupamento_apagado', entityType: 'supplier_grouping', entityId: id,
    payload: { userId, ...r[0] },
  })
  return { ok: true }
}

// ── a mesa ────────────────────────────────────────────────────────────────────

export async function lerMesa(exec: Exec, organizationId: string): Promise<ItemMesa[]> {
  const rows = await exec.select().from(supplierNegotiations)
    .where(eq(supplierNegotiations.organizationId, organizationId))
    .orderBy(asc(supplierNegotiations.createdAt))
  return rows.map((r) => ({
    chave: r.chave, rotulo: r.rotulo, tipo: r.tipo === 'valor' ? 'valor' : 'pct',
    reducao: Number(r.reducao), nota: r.nota, updatedAt: r.updatedAt.toISOString(),
  }))
}

/** Leva à mesa (ou atualiza o que já está). A chave é a identidade: o mesmo fornecedor não entra duas vezes. */
export async function salvarItemMesa(exec: Exec, organizationId: string, userId: string, input: ItemMesaInput): Promise<{ item: ItemMesa } | Erro> {
  const p = itemMesaSchema.safeParse(input)
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Dados da negociação inválidos.' }
  const v = p.data
  const [r] = await exec.insert(supplierNegotiations).values({
    organizationId, chave: v.chave, rotulo: v.rotulo, tipo: v.tipo, reducao: String(v.reducao), nota: v.nota,
    createdBy: userId, updatedBy: userId,
  }).onConflictDoUpdate({
    target: [supplierNegotiations.organizationId, supplierNegotiations.chave],
    set: { rotulo: v.rotulo, tipo: v.tipo, reducao: String(v.reducao), nota: v.nota, updatedBy: userId },
  }).returning()
  await exec.insert(agentEvents).values({
    organizationId, type: 'fornecedores.mesa_alterada', entityType: 'supplier_negotiation', entityId: r.id,
    payload: { userId, chave: v.chave, rotulo: v.rotulo, tipo: v.tipo, reducao: v.reducao },
  })
  return { item: { chave: r.chave, rotulo: r.rotulo, tipo: r.tipo === 'valor' ? 'valor' : 'pct', reducao: Number(r.reducao), nota: r.nota, updatedAt: r.updatedAt.toISOString() } }
}

export async function tirarDaMesa(exec: Exec, organizationId: string, userId: string, chave: string): Promise<{ ok: true } | Erro> {
  const r = await exec.delete(supplierNegotiations)
    .where(and(eq(supplierNegotiations.organizationId, organizationId), eq(supplierNegotiations.chave, chave)))
    .returning({ id: supplierNegotiations.id, rotulo: supplierNegotiations.rotulo, tipo: supplierNegotiations.tipo, reducao: supplierNegotiations.reducao })
  if (!r.length) return { error: 'Este fornecedor já não está na mesa.' }
  await exec.insert(agentEvents).values({
    organizationId, type: 'fornecedores.mesa_retirada', entityType: 'supplier_negotiation', entityId: r[0].id,
    payload: { userId, chave, rotulo: r[0].rotulo, tipo: r[0].tipo, reducao: Number(r[0].reducao) },
  })
  return { ok: true }
}
