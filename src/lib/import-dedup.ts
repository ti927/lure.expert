// A chave de deduplicação da importação por arquivo.
//
// Mora fora de `import-contract.ts` por uma razão de empacotamento, não de
// desenho: o contrato é importado por `csv-templates.ts`, que roda no
// **cliente** (o download da planilha modelo), e `node:crypto` não existe lá.
// Um `import` transitivo faria o build do navegador falhar. O contrato fica
// isomórfico; o hash fica aqui.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE A CHAVE PRECISA SER A MESMA NAS DUAS PORTAS
//
// Enquanto ela vivia dentro de `import-write.ts`, só o MCP deduplicava. Subir
// pela tela o mesmo extrato que a IA já tinha importado duplicaria tudo — a
// dedup ficava cega justamente entre os dois caminhos que ela precisa unir.
// Daí o prefixo ter deixado de ser `mcp:`.
//
// O hash **não inclui o prefixo**, então migrar as linhas já gravadas é um
// `UPDATE` de troca de prefixo, e nada mais.

import { createHash } from 'node:crypto'
import { norm } from '@/lib/format'

export const PREFIXO_CHAVE = 'arq:'

export interface LinhaChaveavel {
  competencia: string
  valor: number
  sentido: string
  descricao: string
  conta?: string | null
}

function assinaturaDeConteudo(l: LinhaChaveavel): string {
  return [l.competencia, l.valor.toFixed(2), l.sentido, norm(l.descricao), l.conta ?? ''].join('|')
}

/**
 * A chave de uma linha.
 *
 * `ocorrencia` é o detalhe que faz isto funcionar: dois cafés idênticos de R$ 15
 * no mesmo dia são DOIS lançamentos legítimos e precisam de duas chaves.
 * Numerando as repetições na ordem em que aparecem, o mesmo arquivo reimportado
 * produz exatamente as mesmas N chaves, e um arquivo com 3 linhas iguais produz
 * 3 chaves distintas. Sem isso, ou a dedup mataria lançamento de verdade, ou não
 * existiria.
 *
 * **A ordem importa.** Quem chama precisa passar as linhas na ordem do arquivo
 * (`row_index`), senão a numeração muda entre execuções e o mesmo arquivo gera
 * chaves diferentes — a dedup passaria a não reconhecer o próprio trabalho.
 */
export function chaveDaLinha(l: LinhaChaveavel, ocorrencia: number): string {
  const bruto = `${assinaturaDeConteudo(l)}|${ocorrencia}`
  return `${PREFIXO_CHAVE}${createHash('sha256').update(bruto).digest('hex').slice(0, 40)}`
}

/** Numera as repetições de linhas idênticas e devolve a chave de cada uma. */
export function chavear(linhas: LinhaChaveavel[]): string[] {
  const vistas = new Map<string, number>()
  return linhas.map(l => {
    const base = assinaturaDeConteudo(l)
    const n = vistas.get(base) ?? 0
    vistas.set(base, n + 1)
    return chaveDaLinha(l, n)
  })
}

/**
 * Balanço **não** deduplica, e isto é regra, não omissão.
 *
 * O BP é snapshot por documento: `getBpAllDates` escolhe o documento mais
 * recente de cada mês. Se as linhas de balanço tivessem chave de conteúdo,
 * reenviar o balanço de janeiro corrigido geraria as mesmas chaves, a segunda
 * importação seria inteiramente ignorada, o documento novo ficaria com zero
 * linhas — e a tela passaria a mostrar justamente esse vazio. "Reenviei o
 * balanço corrigido" viraria "o balanço do mês sumiu".
 *
 * Snapshot se substitui; não se acumula.
 */
export function deduplica(tipoDeRelatorio: 'movimentos' | 'balanco'): boolean {
  return tipoDeRelatorio !== 'balanco'
}
