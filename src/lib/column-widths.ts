// A largura das colunas de uma tabela, escolhida por quem está olhando.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR NAVEGADOR, NÃO POR USUÁRIO — e isso é a v1, declarada
//
// A gravação é `localStorage`, como todo o resto das preferências de tela do app
// (filtros, sidebar, alertas dispensados). Consequências que valem estar
// escritas: a mesma pessoa no notebook e no desktop vê larguras diferentes, e
// duas pessoas no mesmo perfil do navegador dividem as mesmas. Persistir por
// USUÁRIO exigiria tabela de preferência e migration — não há nenhuma hoje
// (`memberships` guarda papel e convite, sem jsonb).
//
// ─────────────────────────────────────────────────────────────────────────────
// FORA DO COMPONENTE DE PROPÓSITO
//
// A aritmética daqui **não levanta exceção quando erra**: uma largura fora de
// faixa não quebra a tela, ela encolhe a coluna até o usuário não conseguir mais
// pegá-la com o mouse — e o estado ruim fica gravado, então recarregar não
// resolve. É o tipo de defeito que só um teste alcança, e aqui ele pode ser
// exercitado por script sem navegador.

/** Piso: abaixo disso a alça fica menor que o cursor e a coluna vira armadilha. */
export const LARGURA_MINIMA = 60
/** Teto: uma coluna sozinha não pode empurrar as outras para fora da tela. */
export const LARGURA_MAXIMA = 900

export interface ColunaRedimensionavel {
  id: string
  /** A largura de fábrica — o que o "restaurar" devolve. */
  largura: number
  /** Colunas de utilidade (caixa de seleção, ações): largura fixa e sem alça. */
  fixa?: boolean
}

/** A chave no storage. Separada da de filtros: largura não é filtro, e "Limpar
 *  filtros" não pode levar o layout junto. */
export function chaveDeLarguras(rota: string): string {
  return `lure:${rota}:colwidths`
}

export function clampLargura(n: number): number {
  // Só o NaN precisa de ramo: ele atravessa `Math.max`/`Math.min` intacto e
  // viraria `width: NaNpx`, que o navegador descarta em silêncio — a coluna
  // sumiria sem erro nenhum. Infinito, esse, o próprio clamp resolve.
  if (Number.isNaN(n)) return LARGURA_MINIMA
  return Math.min(LARGURA_MAXIMA, Math.max(LARGURA_MINIMA, Math.round(n)))
}

/**
 * O que estava salvo, misturado ao padrão — ignorando o que não reconhece.
 *
 * **Tolerante de propósito**, pelo mesmo motivo de `lerAgenda`: o dado vem de
 * fora (storage de outra versão do app, editado à mão, corrompido) e um valor
 * ruim não pode impedir a tabela de renderizar. Id desconhecido é descartado —
 * senão uma coluna removida numa versão futura voltaria a ocupar espaço na
 * soma da largura da tabela sem existir na tela.
 */
export function lerLarguras(
  bruto: unknown,
  colunas: readonly ColunaRedimensionavel[],
): Record<string, number> {
  const larguras: Record<string, number> = {}
  for (const c of colunas) larguras[c.id] = c.largura

  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return larguras

  const salvo = bruto as Record<string, unknown>
  for (const c of colunas) {
    if (c.fixa) continue // coluna fixa nunca honra o storage
    const v = salvo[c.id]
    // Não-finito é corrupção, não intenção: melhor o padrão da coluna que o
    // piso, que apareceria como uma coluna espremida sem motivo visível.
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    larguras[c.id] = clampLargura(v)
  }
  return larguras
}

/**
 * O que vai para o storage: **só o que difere do padrão**.
 *
 * Gravar as 13 colunas congelaria o layout de hoje no navegador de quem mexeu
 * numa só — coluna nova, ou padrão ajustado num deploy futuro, nunca chegaria a
 * essa pessoa.
 */
export function larguraParaSalvar(
  colunas: readonly ColunaRedimensionavel[],
  larguras: Record<string, number>,
): Record<string, number> {
  const diff: Record<string, number> = {}
  for (const c of colunas) {
    if (c.fixa) continue
    const atual = larguras[c.id]
    if (typeof atual === 'number' && atual !== c.largura) diff[c.id] = atual
  }
  return diff
}

/** A largura da tabela é a soma das colunas — é o que produz a rolagem lateral. */
export function larguraTotal(
  colunas: readonly ColunaRedimensionavel[],
  larguras: Record<string, number>,
): number {
  let total = 0
  for (const c of colunas) total += larguras[c.id] ?? c.largura
  return total
}

/** Alguma coluna saiu do padrão? É o que decide se o botão de restaurar aparece. */
export function temCustomizacao(
  colunas: readonly ColunaRedimensionavel[],
  larguras: Record<string, number>,
): boolean {
  return Object.keys(larguraParaSalvar(colunas, larguras)).length > 0
}

/**
 * As colunas de `/transacoes`, na ordem do `<colgroup>`.
 *
 * Mora aqui, e não na tela, para que o teste afirme sobre a **lista real** — uma
 * cópia no script provaria a aritmética contra si mesma e deixaria a tabela
 * livre para divergir.
 *
 * As larguras são as que a tabela já tinha. `fixa` são as duas colunas de
 * utilidade: arrastar a caixa de seleção ou os ícones de ação não serve a
 * ninguém, e o piso de 60px as inflaria.
 *
 * A soma (1.462px) passa a ser a largura MÍNIMA da tabela, no lugar do
 * `min-w-[1470px]` que estava lá — um número solto, 8px maior que o que as
 * colunas pediam, distribuídos pelo navegador entre elas. A largura declarada
 * passa a ser a obtida, que é o pressuposto de poder arrastar.
 */
export const COLUNAS_TRANSACOES: readonly ColunaRedimensionavel[] = [
  { id: 'sel',          largura: 36,  fixa: true },
  { id: 'date',         largura: 90 },
  { id: 'desc',         largura: 200 },
  { id: 'amount',       largura: 110 },
  { id: 'account',      largura: 140 },
  { id: 'direction',    largura: 80 },
  { id: 'reporttype',   largura: 70 },
  { id: 'category',     largura: 180 },
  { id: 'costcenter',   largura: 130 },
  { id: 'businessunit', largura: 120 },
  { id: 'legalentity',  largura: 120 },
  { id: 'contact',      largura: 150 },
  { id: 'acoes',        largura: 36,  fixa: true },
]
