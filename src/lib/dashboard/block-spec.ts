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
 *
 * No modo herdado, a `janela` diz COMO ancorar no mês M do painel, e as datas
 * de `query.periodo` são ignoradas (o regime competência/caixa vem de lá):
 *
 * - `mes`           → o próprio mês M
 * - `ultimos_meses` → `tamanho` meses terminando no fim de M
 * - `ultimos_dias`  → `tamanho` dias terminando no fim de M (o "90 dias" do
 *                     gráfico de fluxo do dashboard)
 * - `acumulado`     → do início dos tempos até o fim de M (o "Saldo em Caixa")
 */
export const periodoDoBlocoSchema = z.discriminatedUnion('modo', [
  z.object({
    modo: z.literal('herda_do_painel'),
    janela: z.enum(['mes', 'ultimos_meses', 'ultimos_dias', 'acumulado']).default('mes'),
    /** Tamanho da janela — exigido em ultimos_meses (1..60) e ultimos_dias (1..366). */
    tamanho: z.number().int().min(1).max(366).optional(),
  }).superRefine((v, ctx) => {
    if ((v.janela === 'ultimos_meses' || v.janela === 'ultimos_dias') && v.tamanho === undefined) {
      ctx.addIssue({ code: 'custom', path: ['tamanho'], message: `A janela "${v.janela}" exige o tamanho.` })
    }
    if (v.janela === 'ultimos_meses' && (v.tamanho ?? 0) > 60) {
      ctx.addIssue({ code: 'custom', path: ['tamanho'], message: 'No máximo 60 meses.' })
    }
    if ((v.janela === 'mes' || v.janela === 'acumulado') && v.tamanho !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['tamanho'], message: `A janela "${v.janela}" não usa tamanho.` })
    }
  }),
  z.object({ modo: z.literal('proprio') }),
]).default({ modo: 'herda_do_painel', janela: 'mes' })

export type PeriodoDoBloco = z.infer<typeof periodoDoBlocoSchema>

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
  /**
   * Multiplica o valor por −1 antes de exibir. É o que faz "Despesas" aparecer
   * positivo: com `tiposDeCategoria` de despesa, `valor_liquido` sai negativo
   * (entrada − saída), e o cartão mostra o gasto como número positivo.
   */
  inverterSinal: z.boolean().default(false),
  /**
   * Semântica do delta: subir é ruim (despesas). O renderizador usa para
   * colorir a variação — o número não muda.
   */
  menorEhMelhor: z.boolean().default(false),
  meta: z.number().optional(),
}).superRefine((v, ctx) => {
  // KPI é UM número: agrupamento produziria várias linhas e só a primeira
  // apareceria — melhor recusar na escrita que truncar em silêncio na leitura.
  if (v.query.agruparPor.length > 0) {
    ctx.addIssue({ code: 'custom', path: ['query', 'agruparPor'], message: 'Bloco kpi não agrupa — use serie, ranking ou composicao.' })
  }
  if (v.query.medidas.length !== 1) {
    ctx.addIssue({ code: 'custom', path: ['query', 'medidas'], message: 'Bloco kpi usa exatamente uma medida.' })
  }
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
