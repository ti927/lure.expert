// Os valores de filtro existem?
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ISTO EXISTE
//
// Achado 10 do diagnóstico de 26/ago. Passar o NOME da conta onde se espera o
// id devolvia `linhas: []` — sem erro, sem aviso, indistinguível de "não há
// movimento no período". O modelo lê zero linhas e conclui, com confiança, que a
// empresa não teve gastos naquela conta. **Uma resposta errada apresentada como
// certa é pior que um erro**, e numa tela financeira é o pior defeito possível.
//
// O padrão da casa já resolve isso noutro lugar: `prever_importacao` diz "não
// achei no plano de contas: <o quê>" em vez de importar sem natureza em
// silêncio. Aqui é o mesmo princípio aplicado aos filtros.
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE NÃO É VALIDADO, DE PROPÓSITO
//
// - `DIM_NONE` ('__null__') é legítimo e não existe em tabela nenhuma — é o
//   "sem esta dimensão".
// - Um id que EXISTE mas não tem lançamento no período continua devolvendo
//   vazio, e está certo: aí o vazio é a resposta, não um engano.
//
// Uma query só, montada com o que veio preenchido. Sem filtro, nem toca o banco.

import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { DIM_NONE } from '@/lib/dre-types'
import { DRE_TYPES, BP_TYPES } from '@/lib/dre-types'
import { QueryValidationError } from './errors'
import type { Filtros } from './spec'

/** Tipos de natureza que existem no plano de contas — os 15 da Fase 3E. */
const TIPOS_VALIDOS = new Set<string>([...DRE_TYPES, ...BP_TYPES, 'transfer'])

interface Alvo {
  /** O campo do filtro, como o chamador o escreveu. */
  campo: string
  valores: string[]
  /** SELECT que devolve os valores existentes desses ids. */
  consulta: (organizationId: string, valores: string[]) => ReturnType<typeof sql>
  /** A ferramenta que lista o que é válido — vai na mensagem de erro. */
  onde: string
}

/**
 * A lista de valores como parâmetros individuais.
 *
 * `ANY(${array})` NÃO funciona: o Drizzle emite `ANY(($2))` com o array JS como
 * um parâmetro só, e o driver não o converte para array do Postgres — a query
 * falha, a falha vira "recusado", e aí **todo** filtro é recusado, inclusive o
 * certo. Foi o que aconteceu na primeira versão desta validação, e só apareceu
 * porque o teste afirma os DOIS sentidos (id errado recusa, id certo passa).
 * `IN (…)` com `sql.join` é o padrão que o motor já usa.
 */
const lista = (valores: string[]) => sql.join(valores.map(v => sql`${v}`), sql`, `)

const porTabela = (tabela: string, coluna = 'id') =>
  (organizationId: string, valores: string[]) => sql`
    SELECT ${sql.raw(coluna)}::text AS valor FROM ${sql.raw(tabela)}
    WHERE organization_id = ${organizationId}::uuid
      AND ${sql.raw(coluna)}::text IN (${lista(valores)})
  `

export async function validarFiltros(
  organizationId: string,
  filtros: Filtros,
  exec: Pick<typeof db, 'execute'> = db,
): Promise<void> {
  // `tiposDeCategoria` é enum conhecido: valida sem ir ao banco.
  if (filtros.tiposDeCategoria?.length) {
    const ruins = filtros.tiposDeCategoria.filter(t => !TIPOS_VALIDOS.has(t))
    if (ruins.length > 0) {
      throw new QueryValidationError('filtros.tiposDeCategoria',
        `Tipo de natureza inexistente: ${ruins.join(', ')}.`,
        Array.from(TIPOS_VALIDOS))
    }
  }

  const semSentinela = (v: string[] | undefined) =>
    (v ?? []).filter(x => x !== DIM_NONE && x.trim() !== '')

  const alvos: Alvo[] = [
    {
      campo: 'contas', valores: semSentinela(filtros.contas), onde: 'listar_contas',
      // A conta vive em `transactions`, desnormalizada e sem FK — o que EXISTE
      // é o que foi usado. Ver o cabeçalho de `lib/accounts.ts`.
      consulta: (org: string, vals: string[]) => sql`
        SELECT DISTINCT account_id::text AS valor FROM transactions
        WHERE organization_id = ${org}::uuid AND account_id::text IN (${lista(vals)})
      `,
    },
    { campo: 'categorias',        valores: semSentinela(filtros.categorias),        onde: 'listar_categorias', consulta: porTabela('categories') },
    { campo: 'centrosDeCusto',    valores: semSentinela(filtros.centrosDeCusto),    onde: 'listar_dimensoes',  consulta: porTabela('cost_centers') },
    { campo: 'unidadesDeNegocio', valores: semSentinela(filtros.unidadesDeNegocio), onde: 'listar_dimensoes',  consulta: porTabela('business_units') },
    { campo: 'entidadesLegais',   valores: semSentinela(filtros.entidadesLegais),   onde: 'listar_dimensoes',  consulta: porTabela('legal_entities') },
    { campo: 'contatos',          valores: semSentinela(filtros.contatos),          onde: 'listar_dimensoes',  consulta: porTabela('contacts') },
    {
      campo: 'versaoOrcamento', onde: 'listar_versoes_de_orcamento',
      valores: filtros.versaoOrcamento ? [filtros.versaoOrcamento] : [],
      consulta: porTabela('budget_versions'),
    },
  ].filter(a => a.valores.length > 0)

  if (alvos.length === 0) return

  for (const alvo of alvos) {
    const linhas = await exec.execute<{ valor: string }>(alvo.consulta(organizationId, alvo.valores))
    const achados = new Set(linhas.map(l => l.valor))
    const faltando = alvo.valores.filter(v => !achados.has(v))
    if (faltando.length > 0) {
      throw new QueryValidationError(
        `filtros.${alvo.campo}`,
        `Não achei em ${alvo.campo}: ${faltando.slice(0, 5).join(', ')}` +
        `${faltando.length > 5 ? ` (e mais ${faltando.length - 5})` : ''}. ` +
        'O filtro espera o ID, não o nome — sem esta checagem a consulta devolveria ZERO linhas ' +
        `sem avisar, e o vazio pareceria resposta. Use ${alvo.onde} para obter os ids.`,
      )
    }
  }
}
