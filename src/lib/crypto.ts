// Criptografia simétrica para segredos que precisam VOLTAR ao texto claro.
//
// A chave da Anthropic do cliente é o caso: para usá-la, é preciso decifrá-la.
// Isso é diferente de senha ou token de acesso, onde hash basta — e é por isso
// que este arquivo existe em vez de reaproveitar o que já havia.
//
// ⚠️ NÃO copiar `encryptApiKey` de `sefaz.ts` / `acquirer-connections.ts`. Aquilo
// é `Buffer.toString('base64')`: o nome mente, e qualquer um que leia o banco lê
// a chave. Aqueles dois deveriam se chamar `encodeApiKey` enquanto não forem
// criptografia de verdade.
//
// AES-256-GCM: cifra e autentica na mesma passada. Sem a autenticação, um
// atacante com acesso de escrita ao banco poderia alterar o texto cifrado e o
// sistema decifraria lixo sem perceber.

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto'

const ALGORITMO = 'aes-256-gcm'
const TAMANHO_IV = 12          // 96 bits, o recomendado para GCM
const VERSAO = 'v1'

export class CryptoConfigError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'CryptoConfigError'
  }
}

/**
 * A chave-mestra, de 32 bytes, vinda de `ENCRYPTION_KEY`.
 *
 * Aceita hex (64 caracteres) ou base64. Recusa qualquer outra coisa em vez de
 * derivar uma chave de um texto curto: derivar aceitaria "senha123" em silêncio
 * e daria uma sensação de segurança que não existe.
 *
 * Gerar com:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
function chaveMestra(): Buffer {
  const bruta = process.env.ENCRYPTION_KEY?.trim()
  if (!bruta) {
    throw new CryptoConfigError(
      'ENCRYPTION_KEY não está definida. Sem ela não é possível guardar nem ler chaves de IA. ' +
      'Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    )
  }

  if (/^[0-9a-fA-F]{64}$/.test(bruta)) return Buffer.from(bruta, 'hex')

  const b64 = Buffer.from(bruta, 'base64')
  if (b64.length === 32) return b64

  throw new CryptoConfigError(
    `ENCRYPTION_KEY precisa ter 32 bytes, em hex (64 caracteres) ou base64. ` +
    `Recebi ${bruta.length} caracteres, que não são nenhum dos dois.`,
  )
}

/**
 * Cifra um segredo.
 *
 * Formato: `v1.<iv>.<tag>.<cifrado>`, tudo em base64url. A versão no começo é o
 * que torna a rotação possível — trocar o algoritmo depois não invalida o que
 * já está gravado.
 */
export function encryptSecret(claro: string): string {
  const iv = randomBytes(TAMANHO_IV)
  const cipher = createCipheriv(ALGORITMO, chaveMestra(), iv)
  const cifrado = Buffer.concat([cipher.update(claro, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    VERSAO,
    iv.toString('base64url'),
    tag.toString('base64url'),
    cifrado.toString('base64url'),
  ].join('.')
}

/**
 * Decifra. Lança se o texto foi adulterado — a tag de autenticação do GCM é
 * verificada pelo próprio `final()`.
 */
export function decryptSecret(guardado: string): string {
  const partes = guardado.split('.')
  if (partes.length !== 4 || partes[0] !== VERSAO) {
    throw new CryptoConfigError(`Segredo em formato desconhecido (esperava "${VERSAO}.iv.tag.dados").`)
  }
  const [, ivB64, tagB64, dadosB64] = partes

  const decipher = createDecipheriv(ALGORITMO, chaveMestra(), Buffer.from(ivB64, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(dadosB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** `ENCRYPTION_KEY` está configurada e válida? Para a tela avisar antes de tentar. */
export function cryptoDisponivel(): boolean {
  try { chaveMestra(); return true } catch { return false }
}

/**
 * Os últimos 4 caracteres, para a tela identificar a chave sem exibi-la.
 *
 * É o único fragmento que pode aparecer em qualquer lugar — tela, log, resposta
 * de server action.
 */
export function ultimos4(claro: string): string {
  return claro.trim().slice(-4)
}

/** Comparação em tempo constante, para quando houver segredo a conferir. */
export function segredosIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
