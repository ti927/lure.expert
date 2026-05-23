import type { AcquirerConnection } from '@/db/schema'

// ─────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────

export type AcquirerSale = {
  externalId: string           // ID único da venda no provedor
  merchantId: string           // Código do estabelecimento
  saleDate: string             // YYYY-MM-DD (data da venda)
  settlementDate: string | null // YYYY-MM-DD (data prevista de liquidação)
  grossAmount: string          // Valor bruto (numeric string)
  netAmount: string            // Valor líquido após MDR (numeric string)
  mdrRate: string | null       // Taxa MDR aplicada (ex: "0.0199")
  cardBrand: string | null     // 'visa' | 'mastercard' | 'elo' | 'amex' | ...
  cardType: string | null      // 'credit' | 'debit' | 'voucher'
  installments: number | null  // Número de parcelas
  authorizationCode: string | null
  nsu: string | null           // Número Sequencial Único
  description: string | null   // Descrição ou nome do produto
  metadata: Record<string, unknown>
}

export type AcquirerSyncResult = {
  sales: AcquirerSale[]
  hasMore: boolean
  nextCursor: string | null
}

// ─────────────────────────────────────────
// Interface genérica do provedor
// ─────────────────────────────────────────

export interface AcquirerProvider {
  fetchSales(
    merchantId: string,
    fromDate: string,  // YYYY-MM-DD
    toDate: string,    // YYYY-MM-DD
    cursor?: string,
  ): Promise<AcquirerSyncResult>
}

// ─────────────────────────────────────────
// Provedor abstrato (stub de desenvolvimento)
// Retorna arrays vazios — permite testar o pipeline sem credenciais reais
// ─────────────────────────────────────────

export class AbstractAcquirerProvider implements AcquirerProvider {
  async fetchSales(
    _merchantId: string,
    _fromDate: string,
    _toDate: string,
    _cursor?: string,
  ): Promise<AcquirerSyncResult> {
    return { sales: [], hasMore: false, nextCursor: null }
  }
}

// ─────────────────────────────────────────
// Stone provider (estrutura para integração — Sessão 8.1)
// Documentação: https://docs.stone.com.br/
// ─────────────────────────────────────────

export class StoneProvider implements AcquirerProvider {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(apiKey: string, environment: 'producao' | 'sandbox') {
    this.apiKey = apiKey
    this.baseUrl = environment === 'producao'
      ? 'https://api.openbank.stone.com.br'
      : 'https://sandbox-api.openbank.stone.com.br'
  }

  async fetchSales(
    _merchantId: string,
    _fromDate: string,
    _toDate: string,
    _cursor?: string,
  ): Promise<AcquirerSyncResult> {
    // TODO Sessão 8.1: implementar autenticação OAuth2 + paginação Stone
    void this.apiKey
    void this.baseUrl
    return { sales: [], hasMore: false, nextCursor: null }
  }
}

// ─────────────────────────────────────────
// Cielo provider (estrutura para integração — Sessão 8.3)
// Documentação: https://developer.cielo.com.br/
// ─────────────────────────────────────────

export class CieloProvider implements AcquirerProvider {
  private readonly apiKey: string
  private readonly merchantKey: string
  private readonly baseUrl: string

  constructor(apiKey: string, merchantKey: string, environment: 'producao' | 'sandbox') {
    this.apiKey = apiKey
    this.merchantKey = merchantKey
    this.baseUrl = environment === 'producao'
      ? 'https://api.braspag.com.br'
      : 'https://apisandbox.braspag.com.br'
  }

  async fetchSales(
    _merchantId: string,
    _fromDate: string,
    _toDate: string,
    _cursor?: string,
  ): Promise<AcquirerSyncResult> {
    // TODO Sessão 8.3: implementar autenticação Cielo + paginação
    void this.apiKey
    void this.merchantKey
    void this.baseUrl
    return { sales: [], hasMore: false, nextCursor: null }
  }
}

// ─────────────────────────────────────────
// Rede provider (estrutura para integração futura)
// ─────────────────────────────────────────

export class RedeProvider implements AcquirerProvider {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(apiKey: string, environment: 'producao' | 'sandbox') {
    this.apiKey = apiKey
    this.baseUrl = environment === 'producao'
      ? 'https://api.userede.com.br'
      : 'https://sandbox.userede.com.br'
  }

  async fetchSales(
    _merchantId: string,
    _fromDate: string,
    _toDate: string,
    _cursor?: string,
  ): Promise<AcquirerSyncResult> {
    void this.apiKey
    void this.baseUrl
    return { sales: [], hasMore: false, nextCursor: null }
  }
}

// ─────────────────────────────────────────
// PagBank provider (estrutura para integração futura)
// ─────────────────────────────────────────

export class PagBankProvider implements AcquirerProvider {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(apiKey: string, environment: 'producao' | 'sandbox') {
    this.apiKey = apiKey
    this.baseUrl = environment === 'producao'
      ? 'https://api.pagseguro.com'
      : 'https://sandbox.api.pagseguro.com'
  }

  async fetchSales(
    _merchantId: string,
    _fromDate: string,
    _toDate: string,
    _cursor?: string,
  ): Promise<AcquirerSyncResult> {
    void this.apiKey
    void this.baseUrl
    return { sales: [], hasMore: false, nextCursor: null }
  }
}

// ─────────────────────────────────────────
// Factory — retorna a implementação correta baseada em connection.provider
// ─────────────────────────────────────────

function decodeBase64(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf-8')
}

export function createAcquirerProvider(
  connection: Pick<AcquirerConnection, 'provider' | 'apiKeyEncrypted' | 'apiSecretEncrypted' | 'environment'>
): AcquirerProvider {
  const apiKey = connection.apiKeyEncrypted ? decodeBase64(connection.apiKeyEncrypted) : ''
  const apiSecret = connection.apiSecretEncrypted ? decodeBase64(connection.apiSecretEncrypted) : ''
  const env = (connection.environment ?? 'producao') as 'producao' | 'sandbox'

  switch (connection.provider) {
    case 'stone':
      return new StoneProvider(apiKey, env)
    case 'cielo':
      return new CieloProvider(apiKey, apiSecret, env)
    case 'rede':
      return new RedeProvider(apiKey, env)
    case 'pagbank':
      return new PagBankProvider(apiKey, env)
    case 'abstract':
    default:
      return new AbstractAcquirerProvider()
  }
}
