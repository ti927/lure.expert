import type { SefazConnection } from '@/db/schema'
import { decryptApiKey } from '@/server/sefaz'

// ─────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────

export type NFeItem = {
  chaveAcesso: string          // 44 dígitos
  numeroNf: string | null
  serie: string | null
  tipo: 'saida' | 'entrada'
  emitenteCnpj: string
  emitenteNome: string | null
  destinatarioCnpj: string | null
  destinatarioNome: string | null
  dataEmissao: string          // YYYY-MM-DD
  dataSaidaEntrada: string | null
  totalNf: string              // numeric string
  totalImpostos: string | null
  xmlContent: string | null
}

// ─────────────────────────────────────────
// Interface genérica do provedor
// ─────────────────────────────────────────

export interface SefazProvider {
  fetchNFeSaida(cnpj: string, fromDate: string): Promise<NFeItem[]>
  fetchNFeEntrada(cnpj: string, fromDate: string): Promise<NFeItem[]>
  manifestar(chaveAcesso: string, tipo: 'ciencia' | 'confirmacao'): Promise<void>
}

// ─────────────────────────────────────────
// Provedor abstrato (stub de desenvolvimento)
// Retorna arrays vazios — permite testar o pipeline sem credenciais SEFAZ reais
// ─────────────────────────────────────────

export class AbstractSefazProvider implements SefazProvider {
  async fetchNFeSaida(_cnpj: string, _fromDate: string): Promise<NFeItem[]> {
    return []
  }

  async fetchNFeEntrada(_cnpj: string, _fromDate: string): Promise<NFeItem[]> {
    return []
  }

  async manifestar(_chaveAcesso: string, _tipo: 'ciencia' | 'confirmacao'): Promise<void> {
    // stub — sem operação
  }
}

// ─────────────────────────────────────────
// Focus NF-e provider (estrutura para integração futura)
// Documentação: https://focusnfe.com.br/doc/
// ─────────────────────────────────────────

export class FocusNFeProvider implements SefazProvider {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(apiKey: string, environment: 'producao' | 'homologacao') {
    this.apiKey = apiKey
    this.baseUrl = environment === 'producao'
      ? 'https://api.focusnfe.com.br/v2'
      : 'https://homologacao.focusnfe.com.br/v2'
  }

  async fetchNFeSaida(cnpj: string, fromDate: string): Promise<NFeItem[]> {
    const url = new URL(`${this.baseUrl}/nfe`)
    url.searchParams.set('cnpj_emitente', cnpj)
    url.searchParams.set('data_emissao_inicio', fromDate)

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}` },
    })

    if (!response.ok) {
      throw new Error(`Focus NF-e saída: HTTP ${response.status}`)
    }

    const data = await response.json() as unknown[]
    return this._mapItems(data, 'saida')
  }

  async fetchNFeEntrada(cnpj: string, fromDate: string): Promise<NFeItem[]> {
    const url = new URL(`${this.baseUrl}/nfe`)
    url.searchParams.set('cnpj_destinatario', cnpj)
    url.searchParams.set('data_emissao_inicio', fromDate)

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}` },
    })

    if (!response.ok) {
      throw new Error(`Focus NF-e entrada: HTTP ${response.status}`)
    }

    const data = await response.json() as unknown[]
    return this._mapItems(data, 'entrada')
  }

  async manifestar(chaveAcesso: string, tipo: 'ciencia' | 'confirmacao'): Promise<void> {
    const tipoMap = {
      ciencia: 'ciencia_da_operacao',
      confirmacao: 'confirmacao_da_operacao',
    }
    const url = `${this.baseUrl}/nfe/${chaveAcesso}/manifestacao`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tipo: tipoMap[tipo] }),
    })

    if (!response.ok) {
      throw new Error(`Focus NF-e manifestação: HTTP ${response.status}`)
    }
  }

  private _mapItems(data: unknown[], tipo: 'saida' | 'entrada'): NFeItem[] {
    if (!Array.isArray(data)) return []

    return data.map((item: unknown) => {
      const it = item as Record<string, unknown>
      return {
        chaveAcesso: String(it['chave_nfe'] ?? ''),
        numeroNf: it['numero'] ? String(it['numero']) : null,
        serie: it['serie'] ? String(it['serie']) : null,
        tipo,
        emitenteCnpj: String(it['cnpj_emitente'] ?? ''),
        emitenteNome: it['nome_emitente'] ? String(it['nome_emitente']) : null,
        destinatarioCnpj: it['cnpj_destinatario'] ? String(it['cnpj_destinatario']) : null,
        destinatarioNome: it['nome_destinatario'] ? String(it['nome_destinatario']) : null,
        dataEmissao: String(it['data_emissao'] ?? '').slice(0, 10),
        dataSaidaEntrada: it['data_saida_entrada'] ? String(it['data_saida_entrada']).slice(0, 10) : null,
        totalNf: String(it['valor_total'] ?? '0'),
        totalImpostos: it['valor_total_tributos'] ? String(it['valor_total_tributos']) : null,
        xmlContent: it['xml'] ? String(it['xml']) : null,
      }
    }).filter(item => item.chaveAcesso.length === 44 && item.dataEmissao.length === 10)
  }
}

// ─────────────────────────────────────────
// Factory — retorna a implementação correta baseada em connection.provider
// ─────────────────────────────────────────

export function createSefazProvider(connection: Pick<SefazConnection, 'provider' | 'apiKeyEncrypted' | 'environment'>): SefazProvider {
  const apiKey = connection.apiKeyEncrypted ? decryptApiKey(connection.apiKeyEncrypted) : ''
  const env = connection.environment as 'producao' | 'homologacao'

  switch (connection.provider) {
    case 'focus_nfe':
      return new FocusNFeProvider(apiKey, env)

    case 'nfeio':
    case 'tecnospeed':
    case 'abstract':
    default:
      return new AbstractSefazProvider()
  }
}
