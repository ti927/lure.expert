// Cliente HTTP para a API de adquirência Stone
// Auth: OAuth2 client_credentials (client_id + client_secret)
// Documentação: https://docs.stone.com.br/

type StoneTokenResponse = {
  access_token: string
  expires_in: number
}

export type StoneSaleItem = {
  id: string
  amount: number              // em centavos
  net_amount: number          // em centavos após MDR
  mdr_fee: number             // em centavos
  mdr_rate: number            // ex: 0.019 (1.9%)
  brand: string | null        // 'visa' | 'mastercard' | 'elo' | 'amex' | ...
  type: string | null         // 'credit' | 'debit' | 'voucher'
  installments: number
  authorization_code: string | null
  nsu: string | null
  description: string | null
  created_at: string          // ISO 8601 (data da venda)
  settlement_date: string | null  // YYYY-MM-DD (data prevista de liquidação)
  status: string              // 'approved' | 'cancelled' | 'chargeback'
}

export type StoneSalesPage = {
  items: StoneSaleItem[]
  cursor: string | null
  has_more: boolean
}

export class StoneClient {
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly baseUrl: string
  private readonly authUrl: string
  private cachedToken: string | null = null
  private tokenExpiresAt = 0

  constructor(clientId: string, clientSecret: string, environment: 'producao' | 'sandbox') {
    this.clientId = clientId
    this.clientSecret = clientSecret
    if (environment === 'sandbox') {
      this.baseUrl = 'https://sandbox-api.openbank.stone.com.br'
      this.authUrl = 'https://sandbox-accounts.openbank.stone.com.br/auth/realms/stone_bank/protocol/openid-connect/token'
    } else {
      this.baseUrl = 'https://api.openbank.stone.com.br'
      this.authUrl = 'https://accounts.openbank.stone.com.br/auth/realms/stone_bank/protocol/openid-connect/token'
    }
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - 30_000) {
      return this.cachedToken
    }

    const res = await fetch(this.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Stone auth falhou (${res.status}): ${text.slice(0, 200)}`)
    }

    const data = await res.json() as StoneTokenResponse
    this.cachedToken = data.access_token
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000
    return this.cachedToken
  }

  async fetchSales(
    merchantId: string,
    fromDate: string,    // YYYY-MM-DD
    toDate: string,      // YYYY-MM-DD
    cursor?: string,
  ): Promise<StoneSalesPage> {
    const token = await this.getToken()

    const params = new URLSearchParams({
      merchant_id: merchantId,
      begin_date: fromDate,
      end_date: toDate,
      page_size: '100',
      ...(cursor ? { cursor } : {}),
    })

    const res = await fetch(`${this.baseUrl}/api/v1/transactions?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Stone fetchSales falhou (${res.status}): ${text.slice(0, 200)}`)
    }

    return res.json() as Promise<StoneSalesPage>
  }
}
