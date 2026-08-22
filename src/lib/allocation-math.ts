// Aritmética do rateio. Pura, sem banco — é aqui que mora o risco de centavo.
//
// Tudo por dentro em CENTAVOS INTEIROS. Reais em ponto flutuante quebram
// exatamente no caso que a regra do rateio proíbe: 0.1 + 0.2 !== 0.3, e
// 1000 * 0.6 não dá 600 redondo. Como a soma das partes tem de bater com o
// lançamento no centavo (migration 0026), a conta não pode passar por float.

/**
 * Reais → centavos inteiros, aceitando as DUAS notações que circulam aqui.
 *
 * O que o usuário digita é brasileiro ("1.234,56": ponto agrupa, vírgula
 * decide). O que `transactions.amount` devolve do Postgres é "467.62": ponto
 * DECIMAL, sem agrupamento. Tratar tudo como brasileiro apagava esse ponto e
 * multiplicava o valor por cem — o diálogo pedia partes que somassem R$
 * 46.762,00 num lançamento de R$ 467,62, e o banco recusava no commit.
 *
 * A vírgula é o que desempata: se existe, o formato é brasileiro e o ponto só
 * agrupa; se não existe, um ponto só pode ser decimal.
 */
export function toCents(v: number | string): number {
  if (typeof v === 'number') return Math.round(v * 100)

  const texto = v.trim()
  if (texto === '') return 0

  const limpo = texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto

  const n = Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function fromCents(c: number): number {
  return c / 100
}

/**
 * Divide `totalCents` em `n` partes iguais, somando o total EXATO.
 *
 * A sobra vai para as primeiras partes, um centavo em cada — e não toda na
 * primeira: R$ 10,00 em 3 dá 3,34 / 3,33 / 3,33, não 3,34 / 3,33 / 3,33 com
 * uma parte carregando 2 centavos. Espalhar mantém as partes o mais próximas
 * possível entre si, que é o que "igualmente" promete.
 */
export function splitEqually(totalCents: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(totalCents / n)
  const sobra = totalCents - base * n
  return Array.from({ length: n }, (_, i) => base + (i < sobra ? 1 : 0))
}

/**
 * Distribui `totalCents` segundo pesos (percentuais ou quaisquer números
 * positivos), garantindo que a soma seja o total exato.
 *
 * Método do maior resto: arredonda cada parte para baixo e entrega os centavos
 * que sobraram a quem tinha a maior fração descartada. É o mesmo critério de
 * distribuição de cadeiras — sem ele, arredondar cada parte por conta própria
 * erra o total para mais ou para menos conforme o acaso dos decimais.
 */
export function applyProportion(totalCents: number, weights: number[]): number[] {
  const soma = weights.reduce((a, w) => a + w, 0)
  if (soma <= 0 || weights.length === 0) return weights.map(() => 0)

  const exatos = weights.map(w => (totalCents * w) / soma)
  const piso   = exatos.map(Math.floor)
  let resto    = totalCents - piso.reduce((a, v) => a + v, 0)

  // Maior fração descartada primeiro; empate resolve pela ordem, que é estável.
  const ordem = exatos
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)

  const out = [...piso]
  for (const { i } of ordem) {
    if (resto <= 0) break
    out[i] += 1
    resto -= 1
  }
  return out
}

/** Quanto falta distribuir. Negativo = passou do valor do lançamento. */
export function remainingCents(totalCents: number, partsCents: number[]): number {
  return totalCents - partsCents.reduce((a, v) => a + v, 0)
}

/** Percentual de uma parte sobre o total, com 2 casas — só para exibição. */
export function pctOf(partCents: number, totalCents: number): number {
  if (totalCents === 0) return 0
  return Math.round((partCents / totalCents) * 10000) / 100
}

/** Percentual digitado → centavos. O valor é o que vale; o % só o alimenta. */
export function centsFromPct(pct: number, totalCents: number): number {
  return Math.round((totalCents * pct) / 100)
}
