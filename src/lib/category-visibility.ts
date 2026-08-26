// Os selos "ocultar na DRE" e "ocultar no Fluxo", com herança do pai.
//
// ─────────────────────────────────────────────────────────────────────────────
// O DEFEITO QUE ISTO CORRIGE (26/ago)
//
// A tela de categorias oferece os botões DRE e FC nas DUAS linhas da árvore —
// na Natureza Pai e na Natureza Filho. O botão do pai salvava no banco, mudava
// de cor e **não afetava número nenhum, jamais**.
//
// A razão é estrutural, não um esquecimento pontual: só Natureza Filho pode
// receber lançamento (regra do plano de contas, conferida no banco — zero
// lançamentos em categoria de nível 1 nas seis organizações), e as cinco
// queries que consultam o selo o liam da categoria DO LANÇAMENTO. Um selo que
// só existe no pai nunca era alcançado por nenhuma delas.
//
// Julio encontrou isso marcando "Devoluções" como oculta no fluxo e vendo o
// ramo continuar na tela: os 26 lançamentos estavam no filho "Devolução de
// pagamentos (+)", que seguia visível. Marcado no filho, some — foi assim que
// as duas linhas de "Transferência entre contas" saíram.
//
// ─────────────────────────────────────────────────────────────────────────────
// A REGRA, ESCRITA UMA VEZ SÓ
//
// Uma categoria entra na leitura quando **nem ela nem o pai dela** estão
// ocultos naquele regime. Ocultar o pai passa a ocultar o ramo; ocultar um
// filho continua ocultando só ele.
//
// A árvore tem exatamente DOIS níveis de linha (Tipo é coluna, não linha), o
// que foi conferido no banco antes de escrever isto — por isso um único salto
// até o pai basta, e não é preciso CTE recursiva.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE `EXISTS` COM ALIAS PRÓPRIO, E NÃO `${categories.hideInDre}`
//
// Decisão 18: o Drizzle só qualifica a coluna num template `sql` quando a
// consulta tem join. Dentro de uma subconsulta correlacionada, uma coluna sem
// qualificação é capturada pelo escopo INTERNO — a correlação vira
// `x.parent_id = x.id`, constante, e **sem erro**. Já mordeu três vezes neste
// projeto. Aqui o alias externo entra como string via `sql.raw` (o mesmo padrão
// de `dimensionFilters`) e o interno é `cat_pai`, um nome que não colide com
// nenhum alias das consultas chamadoras.

import { sql } from 'drizzle-orm'

export type CampoDeVisibilidade = 'hide_in_dre' | 'hide_in_cashflow'

/** A coluna de visibilidade do regime: competência → DRE, caixa → Fluxo. */
export function campoDoRegime(regime: 'competencia' | 'caixa'): CampoDeVisibilidade {
  return regime === 'caixa' ? 'hide_in_cashflow' : 'hide_in_dre'
}

/**
 * O predicado de visibilidade para a categoria em `alias`, herdando do pai.
 *
 * Entra no WHERE já com o `AND` na frente, como os demais fragmentos das
 * consultas que o usam.
 *
 * @param alias  alias da tabela `categories` do LANÇAMENTO na consulta (ex: 'c')
 * @param campo  qual selo consultar
 */
export function filtroDeVisibilidade(alias: string, campo: CampoDeVisibilidade) {
  const a = sql.raw(alias)
  const col = sql.raw(campo)
  return sql`
      AND COALESCE(${a}.${col}, false) = false
      AND NOT EXISTS (
        SELECT 1 FROM categories cat_pai
         WHERE cat_pai.id = ${a}.parent_id
           AND COALESCE(cat_pai.${col}, false) = true
      )`
}
