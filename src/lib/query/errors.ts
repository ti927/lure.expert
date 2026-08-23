/**
 * Erro de consulta com mensagem que o modelo consegue agir em cima.
 *
 * O motor é consumido por uma IA externa via MCP, e "invalid input" faz o
 * modelo tentar de novo às cegas. Dizer *o que* não existe e *o que* existe no
 * lugar faz ele se corrigir na primeira tentativa — por exemplo, ao pedir NF-e
 * agrupada por centro de custo, que é uma dimensão que `invoices` não tem.
 */
export class QueryValidationError extends Error {
  readonly campo: string
  readonly alternativas: string[]

  constructor(campo: string, mensagem: string, alternativas: string[] = []) {
    const sufixo = alternativas.length > 0
      ? ` Disponíveis nesta fonte: ${alternativas.join(', ')}.`
      : ''
    super(`${mensagem}${sufixo}`)
    this.name = 'QueryValidationError'
    this.campo = campo
    this.alternativas = alternativas
  }
}

/**
 * Escopo pedido não confere com o vínculo do usuário.
 *
 * Separado do erro de validação de propósito: falha de autorização vira 403 no
 * MCP, e nunca resultado vazio — devolver zero linhas ensinaria o chamador que
 * a organização não tem dados, quando na verdade ele não pode vê-la.
 */
export class ScopeDeniedError extends Error {
  constructor(mensagem = 'Sem acesso a esta organização.') {
    super(mensagem)
    this.name = 'ScopeDeniedError'
  }
}
