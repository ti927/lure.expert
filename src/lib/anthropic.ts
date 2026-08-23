import Anthropic from '@anthropic-ai/sdk'

// Strip BOM (U+FEFF), zero-width chars e whitespace que o painel da Vercel
// às vezes deixa passar quando a chave foi copiada de um editor com BOM ou
// de uma página web. undici rejeita non-ASCII em headers, então um BOM na
// ANTHROPIC_API_KEY quebra TODAS as chamadas com TypeError de ByteString —
// o erro fica difícil de rastrear porque o caller (parser/categorizer) só
// vê o stack do SDK Anthropic dentro do build minificado.
export function sanitizeKey(raw: string | undefined): string {
  if (!raw) return ''
  let s = raw
  // Remove qualquer caractere de controle Unicode/invisível no INÍCIO da string
  // (BOM U+FEFF, zero-width space U+200B, etc).
  while (s.length > 0) {
    const code = s.charCodeAt(0)
    if (code === 0xFEFF || code === 0x200B || code <= 0x20) {
      s = s.slice(1)
    } else break
  }
  return s.trim()
}

let plataforma: Anthropic | null | undefined

/**
 * O client da chave da LURE.
 *
 * A partir da Fase 2 ele deixou de ser o caminho único: cada organização pode
 * trazer a própria chave, e quem resolve qual usar é `resolverAcessoIa` em
 * `src/lib/ai-access.ts`. Este aqui só atende as organizações marcadas como
 * `key_source = 'platform'` — as de teste e, se houver, o período de trial.
 *
 * Devolve `null` em vez de lançar quando `ANTHROPIC_API_KEY` não existe: com
 * chave por organização, a chave da plataforma passou a ser opcional, e um
 * `throw` na importação do módulo derrubaria o app inteiro por causa dela.
 */
export function anthropicDaPlataforma(): Anthropic | null {
  if (plataforma !== undefined) return plataforma
  const chave = sanitizeKey(process.env.ANTHROPIC_API_KEY)
  plataforma = chave ? new Anthropic({ apiKey: chave }) : null
  return plataforma
}
