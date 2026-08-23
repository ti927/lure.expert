// A especificação de um bloco do painel.
//
// É o contrato entre três partes que nunca se falam: a IA que cria o bloco pelo
// MCP, o banco que o guarda como `jsonb`, e o componente que o desenha. Nenhuma
// delas confia nas outras — tudo passa por este Zod, inclusive na LEITURA.
//
// Por que validar ao ler: uma spec gravada por uma versão anterior do schema
// tem de falhar alto, com o bloco mostrando erro, em vez de renderizar um
// gráfico plausível a partir de campo que mudou de significado. Um número
// errado numa tela financeira é pior que uma tela quebrada.
//
// **Código gerado por IA nunca é executado.** O único objeto que cruza a
// fronteira é JSON que precisa passar por aqui.

import { z } from 'zod'
import { querySpecSchema } from '@/lib/query/spec'

/**
 * Versão do formato. Sobe quando um campo muda de significado — não quando
 * ganha campo novo opcional, que é retrocompatível por construção.
 */
export const BLOCK_SPEC_VERSAO = 1

const base = {
  versao: z.number().int().min(1).max(BLOCK_SPEC_VERSAO),
  titulo: z.string().trim().max(120).optional(),
  /** Largura em colunas de uma grade de 12. */
  largura: z.number().int().min(1).max(12).default(6),
}

/**
 * O período pode ser herdado do painel — que é o que faz o seletor de mês
 * mexer em todos os blocos de uma vez — ou fixo no bloco, para o caso do
 * comparativo que sempre olha 12 meses independentemente do mês escolhido.
 */
export const periodoDoBlocoSchema = z.discriminatedUnion('modo', [
  z.object({ modo: z.literal('herda_do_painel') }),
  z.object({ modo: z.literal('proprio') }),
]).default({ modo: 'herda_do_painel' })

// ─── Blocos que consultam dados ──────────────────────────────────────────────
//
// Todos embutem `query: querySpecSchema` — o MESMO schema do motor. É a peça
// que carrega o desenho inteiro: um Zod, três consumidores.

const kpi = z.object({
  ...base,
  tipo: z.literal('kpi'),
  query: querySpecSchema,
  periodo: periodoDoBlocoSchema,
  formato: z.enum(['moeda', 'inteiro', 'percentual']).default('moeda'),
  /** Mostra a variação contra o período anterior. */
  comparar: z.boolean().default(true),
  meta: z.number().optional(),
})

const serie = z.object({
  ...base,
  tipo: z.literal('serie'),
  query: querySpecSchema,
  periodo: periodoDoBlocoSchema,
  visual: z.enum(['barra', 'barra_empilhada', 'linha', 'area', 'combinado']).default('barra'),
})

const ranking = z.object({
  ...base,
  tipo: z.literal('ranking'),
  query: querySpecSchema,
  periodo: periodoDoBlocoSchema,
  /** Barra horizontal é leitura melhor que pizza para ranking de 5 itens. */
  visual: z.enum(['barra_horizontal', 'lista']).default('lista'),
  mostrarPercentual: z.boolean().default(true),
})

const composicao = z.object({
  ...base,
  tipo: z.literal('composicao'),
  query: querySpecSchema,
  periodo: periodoDoBlocoSchema,
  visual: z.enum(['pizza', 'rosca', 'barra_horizontal']).default('rosca'),
})

// ─── Blocos que carregam lógica que já existe ────────────────────────────────
//
// Indicadores e alertas NÃO são agregação: são regras com limiares. Forçá-los
// para dentro do motor exigiria que o SQL soubesse o que é "liquidez baixa".
// Estas duas são as escotilhas que trazem a lógica da tela atual para o formato
// de bloco sem reescrevê-la.

export const INDICADORES = [
  'margemEbitda', 'liquidezCorrente', 'liquidezSeca',
  'endividamentoGeral', 'coberturaServicoDivida', 'roe', 'cicloFinanceiro',
] as const

const indicador = z.object({
  ...base,
  tipo: z.literal('indicador'),
  indicadores: z.array(z.enum(INDICADORES)).min(1).max(7).default([...INDICADORES]),
  periodo: periodoDoBlocoSchema,
})

/** As 8 regras que hoje vivem no `useMemo` de `dashboard-client.tsx`. */
export const REGRAS_DE_ALERTA = [
  'saldo-negativo', 'lucro-negativo', 'despesas-alta', 'receita-queda',
  'ebitda-baixo', 'cobertura-divida', 'liquidez-corrente', 'endividamento',
] as const

const alertas = z.object({
  ...base,
  tipo: z.literal('alertas'),
  regras: z.array(z.enum(REGRAS_DE_ALERTA)).min(1).default([...REGRAS_DE_ALERTA]),
  maximo: z.number().int().min(1).max(20).default(6),
})

const texto = z.object({
  ...base,
  tipo: z.literal('texto'),
  markdown: z.string().max(2000),
})

// ─── União ───────────────────────────────────────────────────────────────────

export const blockSpecSchema = z.discriminatedUnion('tipo', [
  kpi, serie, ranking, composicao, indicador, alertas, texto,
])

export type BlockSpec = z.infer<typeof blockSpecSchema>
export type BlockSpecInput = z.input<typeof blockSpecSchema>
export type BlockType = BlockSpec['tipo']

/** Tipos que consultam o motor — os únicos com `query`. */
export const TIPOS_COM_CONSULTA: BlockType[] = ['kpi', 'serie', 'ranking', 'composicao']

export function temConsulta(spec: BlockSpec): spec is Extract<BlockSpec, { query: unknown }> {
  return TIPOS_COM_CONSULTA.includes(spec.tipo)
}

/**
 * Lê uma spec vinda do banco.
 *
 * Devolve o erro em vez de lançar: um bloco quebrado tem de aparecer quebrado
 * no painel, com o motivo, sem derrubar os outros blocos junto.
 */
export function lerBlockSpec(bruto: unknown):
  | { ok: true; spec: BlockSpec }
  | { ok: false; erro: string } {
  const r = blockSpecSchema.safeParse(bruto)
  if (r.success) return { ok: true, spec: r.data }
  const i = r.error.issues[0]
  return { ok: false, erro: `${i.path.join('.') || 'spec'}: ${i.message}` }
}

// ─── Disposição do painel ────────────────────────────────────────────────────

export const layoutSchema = z.object({
  colunas: z.number().int().min(1).max(12).default(12),
  /** Mês de referência do painel, herdado pelos blocos que não têm o seu. */
  mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
}).default({ colunas: 12 })

export type DashboardLayout = z.infer<typeof layoutSchema>
