// Fonte `nfe` — notas fiscais eletrônicas (`invoices`).
//
// É a fonte que o motor usa para provar que sabe recusar. `invoices` tem
// APENAS duas das quatro dimensões — `legal_entity_id` e `contact_id` — e não
// tem natureza nem conta. Pedir NF-e agrupada por centro de custo é recusado
// com a lista do que existe, para o modelo se corrigir na primeira tentativa,
// em vez de ignorado em silêncio (que devolveria um total sem quebra e passaria
// por resposta).
//
// SENTIDO: nota de SAÍDA é receita (dinheiro entra); nota de ENTRADA é compra
// (dinheiro sai). A tradução `saida`→`inflow` vive aqui, e não no motor, porque
// é vocabulário desta tabela.
//
// ⚠️ NÃO VERIFICADA CONTRA DADOS: a tabela `invoices` está vazia (nenhuma
// conexão SEFAZ ativa). Só foi exercitado que o SQL executa, que as recusas
// recusam e que o escopo é aplicado. Quando houver nota, conciliar contra
// `listInvoices`/`getInvoiceStats` antes de confiar nos números.

import { sql } from 'drizzle-orm'
import type { SourceDescriptor, JoinId } from './types'

/** Nota de saída = dinheiro entrando. Normaliza para o vocabulário do motor. */
const sentido = sql`CASE WHEN i.tipo = 'saida' THEN 'inflow' ELSE 'outflow' END`

export const nfe: SourceDescriptor = {
  id:    'nfe',
  from:  sql`invoices i`,
  alias: 'i',
  orgColumn: 'i.organization_id',

  periodKind: 'range',
  dateColumns: {
    competencia: sql`i.data_emissao::date`,
    // Saída/entrada da mercadoria é o que mais se aproxima do caixa aqui; nem
    // toda nota a tem preenchida, daí o COALESCE.
    caixa:       sql`COALESCE(i.data_saida_entrada, i.data_emissao)::date`,
  },

  // As outras duas dimensões simplesmente não existem em `invoices`.
  supportedDimensions: ['entidadesLegais', 'contatos'],
  filterColumns: { direcao: sentido },

  measures: {
    valor_liquido:  { expr: sql`SUM(CASE WHEN i.tipo = 'saida' THEN i.total_nf::numeric ELSE -i.total_nf::numeric END)` },
    entradas:       { expr: sql`SUM(CASE WHEN i.tipo = 'saida'   THEN i.total_nf::numeric ELSE 0 END)` },
    saidas:         { expr: sql`SUM(CASE WHEN i.tipo = 'entrada' THEN i.total_nf::numeric ELSE 0 END)` },
    valor_absoluto: { expr: sql`SUM(i.total_nf::numeric)` },
    contagem:       { expr: sql`COUNT(*)` },
    ticket_medio:   { expr: sql`SUM(i.total_nf::numeric) / NULLIF(COUNT(*), 0)` },
  },

  groupings: {
    entidade_legal: { chave: sql`le.id::text`, rotulo: sql`le.name`, joins: ['entidade_legal'] },
    contato: {
      chave: sql`ct.id::text`,
      // Sem contato vinculado, o nome do emitente/destinatário da própria nota
      // ainda diz mais que "sem contato".
      rotulo: sql`COALESCE(ct.name, i.destinatario_nome, i.emitente_nome)`,
      joins: ['contato'],
    },
    direcao: {
      chave:  sql`i.tipo`,
      rotulo: sql`CASE WHEN i.tipo = 'saida' THEN 'Emitida' ELSE 'Recebida' END`,
    },
  },

  joins: {
    entidade_legal: sql`LEFT JOIN legal_entities le ON i.legal_entity_id = le.id`,
    contato:        sql`LEFT JOIN contacts       ct ON i.contact_id      = ct.id`,
  },

  baseFilters: () => ({
    // Nota cancelada ou denegada não representa fato econômico nenhum.
    where: sql`AND i.status NOT IN ('cancelada', 'denegada')`,
    joins: [] as JoinId[],
  }),
}
