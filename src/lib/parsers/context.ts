/**
 * Quem está pagando por esta leitura.
 *
 * Os parsers chamam a Anthropic e até a Fase 0 não recebiam nada que dissesse a
 * qual organização atribuir o custo — o que os tornava invisíveis na medição.
 * O contexto entra como parâmetro em vez de ser deduzido de sessão porque os
 * parsers rodam dentro de job Inngest, onde não existe cookie.
 *
 * A Fase 2 (chave de IA por organização) usa exatamente este `organizationId`
 * para resolver qual chave usar — por isso é objeto e não string solta.
 */
export interface ParseContext {
  organizationId: string
  /** Documento de origem, para o consumo ficar rastreável até o arquivo. */
  documentId?: string | null
}
