// O que a tela precisa saber do lançamento manual SEM importar o banco —
// `lancamento-manual.ts` importa `db`, e o selo "Manual" roda no navegador.
// Mesmo padrão de `budget-types.ts`.

export const ORIGEM_MANUAL = 'manual'

export interface MetadadosManuais {
  origem: typeof ORIGEM_MANUAL
  lancadoPor: { userId: string; email: string | null }
  /** ISO, relógio do servidor. */
  lancadoEm: string
  dispositivo: { navegador: string | null; sistema: string | null; userAgent: string | null; ip: string | null; id: string | null }
  /** Presente quando o lançamento voltou de um apagamento. */
  restauradoEm?: string
  restauradoPor?: { userId: string; email: string | null }
}

/** O lançamento é manual? Lê o `metadata` — é onde a origem mora. */
export function ehManual(metadata: unknown): metadata is MetadadosManuais {
  return !!metadata && typeof metadata === 'object' && (metadata as { origem?: unknown }).origem === ORIGEM_MANUAL
}

/**
 * A autoria em uma frase, para o selo: "Lançado à mão por x@y em 27/10/2026 às
 * 14:32 · Chrome 130 no Windows · IP 1.2.3.4 · dispositivo #a3f2".
 */
export function descreverAutoria(m: MetadadosManuais): string {
  const quando = new Date(m.lancadoEm)
  const data = quando.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const hora = quando.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  const d = m.dispositivo ?? {}
  const aparelho = [d.navegador, d.sistema].filter(Boolean).join(' no ')
  const partes = [
    `Lançado à mão por ${m.lancadoPor?.email ?? 'usuário desconhecido'} em ${data} às ${hora}`,
    aparelho || null,
    d.ip ? `IP ${d.ip}` : null,
    d.id ? `dispositivo #${d.id}` : null,
  ].filter(Boolean)
  let texto = partes.join(' · ')
  if (m.restauradoEm) {
    const r = new Date(m.restauradoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
    texto += ` — restaurado em ${r}${m.restauradoPor?.email ? ` por ${m.restauradoPor.email}` : ''}`
  }
  return texto
}
