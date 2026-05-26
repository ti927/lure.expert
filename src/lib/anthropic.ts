import Anthropic from '@anthropic-ai/sdk'

// Strip BOM (U+FEFF), zero-width chars e whitespace que o painel da Vercel
// às vezes deixa passar quando a chave foi copiada de um editor com BOM ou
// de uma página web. undici rejeita non-ASCII em headers, então um BOM na
// ANTHROPIC_API_KEY quebra TODAS as chamadas com TypeError de ByteString —
// o erro fica difícil de rastrear porque o caller (parser/categorizer) só
// vê o stack do SDK Anthropic dentro do build minificado.
function sanitizeKey(raw: string | undefined): string {
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

export const anthropic = new Anthropic({
  apiKey: sanitizeKey(process.env.ANTHROPIC_API_KEY),
})
