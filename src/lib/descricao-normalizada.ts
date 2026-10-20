// A descrição "normalizada": a chave que junta "PIX JOAO 12/09" e "PIX JOAO 15/09".
//
// Minúsculas, sem acento, e tudo que não é letra vira um espaço só — números
// (datas, CNPJ, NSU, parcelas) e pontuação saem. "PAGAMENTO PIX 13059145000100
// EBURY BANCO DE CÂMBIO S.A" vira "pagamento pix ebury banco de cambio s a".
//
// O custo é declarado: "PIX 123" e "PIX 456" viram a mesma chave. Por isso o
// agrupamento EXATO (`descricao`) continua existindo ao lado deste, e o modelo
// diz qual usou.
//
// A regra existe em SQL (agrupar e filtrar no banco) e em TypeScript (o teste
// confere uma contra a outra). O banco não tem `unaccent`, então o acento sai
// por `translate` — os dois mapas abaixo precisam andar juntos.

import { sql, type SQL } from 'drizzle-orm'

const COM_ACENTO = 'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ'
const SEM_ACENTO = 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'

/**
 * A expressão SQL sobre uma coluna (ou parâmetro) de texto. Vazio vira NULL —
 * descrição só de números não tem chave, e o rótulo vazio do agrupamento diz
 * isso em vez de juntar todas numa linha "".
 *
 * As constantes entram por `sql.raw`: são fixas, e parametrizá-las faria SELECT
 * e GROUP BY deixarem de ser reconhecidos como a mesma expressão.
 */
export function descricaoNormalizadaSql(texto: SQL): SQL<string | null> {
  return sql<string | null>`NULLIF(btrim(regexp_replace(lower(translate(${texto}, ${
    sql.raw(`'${COM_ACENTO}'`)}, ${sql.raw(`'${SEM_ACENTO}'`)})), '[^a-z]+', ' ', 'g')), '')`
}

/** A mesma regra em TypeScript. */
export function normalizarDescricao(texto: string): string | null {
  let s = ''
  for (const ch of texto) {
    const i = COM_ACENTO.indexOf(ch)
    s += i >= 0 ? SEM_ACENTO[i] : ch
  }
  const r = s.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
  return r || null
}
