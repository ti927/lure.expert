// Para onde ir depois de entrar (ou de confirmar um link de e-mail).
//
// Só caminho interno. `//evil.com` e `/\evil.com` são lidos pelo navegador como
// endereço ABSOLUTO — sem esta checagem, `?next=` viraria um redirecionador
// aberto hospedado no nosso domínio, que é exatamente o que a tela de
// consentimento do OAuth existe para não ser.
//
// Extraído de `app/login/actions.ts` na Fase 4: a rota `/auth/confirm` (links
// de convite e de e-mail em geral) precisa da mesma regra, e `'use server'`
// não deixa o arquivo do login exportar função síncrona.
export function destinoSeguro(next: unknown, padrao = '/dashboard'): string {
  const bruto = typeof next === 'string' ? next : ''
  if (!bruto.startsWith('/')) return padrao
  if (bruto.startsWith('//') || bruto.startsWith('/\\')) return padrao
  return bruto
}
