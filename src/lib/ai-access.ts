// "Esta organização pode chamar a IA agora, e com qual chave?"
//
// Um funil só, pelas mesmas razões do `QueryScope`: chave e teto são duas
// perguntas que sempre andam juntas, e resolvê-las em lugares diferentes é como
// nasce o caminho que gasta sem conferir o limite.
//
// DEGRADA, NÃO QUEBRA. Sem chave ou acima do teto, a resposta é uma recusa
// descritiva, não uma exceção. Quem chama já sabe seguir sem IA — a
// categorização cai para as camadas 0 a 2 (CSV, regras, recorrência) e o
// lançamento vai para a fila de revisão, que é exatamente o que já acontece
// quando o modelo falha. A exceção é o PDF, que não tem plano B.

import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/db'
import { organizationAiSettings } from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { decryptSecret, CryptoConfigError } from './crypto'
import { anthropicDaPlataforma } from './anthropic'

/**
 * Executor de banco. Recebe `db` por padrão e a transação quando quem chama
 * está dentro de uma — é o mesmo contrato de `budget-scope.ts`, e é o que torna
 * estas funções exercitáveis num teste que termina em ROLLBACK.
 */
type Executor = Pick<typeof db, 'select' | 'update' | 'execute'>

export type MotivoRecusa =
  | 'sem_chave'
  | 'chave_invalida'
  | 'teto_estourado'
  | 'plataforma_indisponivel'

export interface AcessoConcedido {
  ok:     true
  client: Anthropic
  origem: 'own' | 'platform'
}

export interface AcessoNegado {
  ok:      false
  motivo:  MotivoRecusa
  /** Texto pronto para aparecer em tela — em português, sem jargão. */
  mensagem: string
  gastoUsd?: number
  tetoUsd?:  number
}

export type AcessoIa = AcessoConcedido | AcessoNegado

/**
 * Cache do client por organização.
 *
 * Construir o client é barato, mas decifrar a chave a cada lançamento de um
 * lote de 7.762 não é. A chave do cache inclui `updatedAt`, então trocar a
 * chave na tela invalida sozinho — sem TTL para adivinhar e sem invalidação
 * manual para esquecer.
 */
const cache = new Map<string, Anthropic>()

function clientDe(organizationId: string, updatedAt: Date, apiKey: string): Anthropic {
  const chave = `${organizationId}:${updatedAt.getTime()}`
  const existente = cache.get(chave)
  if (existente) return existente

  const novo = new Anthropic({ apiKey })
  // Só a entrada corrente desta organização interessa.
  for (const k of Array.from(cache.keys())) if (k.startsWith(`${organizationId}:`)) cache.delete(k)
  cache.set(chave, novo)
  return novo
}

/** Quanto a organização já gastou no mês corrente, em dólar. */
export async function gastoDoMes(organizationId: string, exec: Executor = db): Promise<number> {
  const [linha] = await exec.execute<{ usd: string }>(sql`
    SELECT COALESCE(SUM(cost_usd), 0)::text AS usd
    FROM agent_events
    WHERE organization_id = ${organizationId}::uuid
      AND cost_usd IS NOT NULL
      AND created_at >= DATE_TRUNC('month', now())`)
  return Number(linha?.usd ?? 0)
}

/**
 * Resolve chave e teto.
 *
 * O teto é conferido AQUI, e quem chama deve chamar isto uma vez por LOTE, não
 * por lançamento: somar `agent_events` a cada uma das 7.762 chamadas de um
 * "Categorizar agora" custaria mais que o problema que resolve. O job já divide
 * em blocos de 50 — é ali que a pergunta cabe.
 */
export async function resolverAcessoIa(organizationId: string, exec: Executor = db): Promise<AcessoIa> {
  const [cfg] = await exec
    .select()
    .from(organizationAiSettings)
    .where(eq(organizationAiSettings.organizationId, organizationId))
    .limit(1)

  // Organização sem linha de configuração: trata como plataforma. É o mesmo
  // que a migration 0029 fez com as existentes — desligar a IA de quem nunca
  // configurou seria quebrar importação em produção sem aviso.
  const origem = (cfg?.keySource ?? 'platform') as 'own' | 'platform'

  // ── Teto, antes da chave: estourado, nem a chave própria roda ─────────────
  const teto = cfg?.monthlyLimitUsd ? Number(cfg.monthlyLimitUsd) : null
  if (teto !== null) {
    const gasto = await gastoDoMes(organizationId, exec)
    if (gasto >= teto) {
      return {
        ok: false,
        motivo: 'teto_estourado',
        mensagem:
          `O limite de US$ ${teto.toFixed(2)} deste mês foi atingido (US$ ${gasto.toFixed(2)} gastos). ` +
          'A classificação automática segue funcionando pelas regras e pelo histórico; ' +
          'o que o expert não conseguir resolver vai para a fila de revisão.',
        gastoUsd: gasto,
        tetoUsd: teto,
      }
    }
  }

  // ── Chave ────────────────────────────────────────────────────────────────
  if (origem === 'platform') {
    const plataforma = anthropicDaPlataforma()
    if (!plataforma) {
      return {
        ok: false,
        motivo: 'plataforma_indisponivel',
        mensagem: 'A chave de IA da plataforma não está configurada no servidor.',
      }
    }
    return { ok: true, client: plataforma, origem: 'platform' }
  }

  if (!cfg?.apiKeyEncrypted) {
    return {
      ok: false,
      motivo: 'sem_chave',
      mensagem:
        'Esta organização ainda não cadastrou uma chave de IA. ' +
        'Cadastre em Configurações › Consumo de IA para o expert voltar a classificar e a ler extratos em PDF.',
    }
  }

  try {
    const claro = decryptSecret(cfg.apiKeyEncrypted)
    return { ok: true, client: clientDe(organizationId, cfg.updatedAt, claro), origem: 'own' }
  } catch (e) {
    // Chave adulterada no banco, ou ENCRYPTION_KEY trocada sem migrar os
    // segredos. Nos dois casos o cliente precisa recadastrar.
    const cfgErr = e instanceof CryptoConfigError
    console.error('[ai-access] falha ao decifrar a chave', { organizationId, cfgErr, erro: (e as Error).message })
    return {
      ok: false,
      motivo: 'chave_invalida',
      mensagem: 'Não foi possível ler a chave de IA cadastrada. Cadastre-a novamente em Configurações › Consumo de IA.',
    }
  }
}

/**
 * Passou do limite de alerta e ainda não avisou neste mês?
 *
 * Devolve o que avisar, e marca o mês para não repetir a cada bloco de 50 do
 * job. Só marca quando devolve algo — assim um erro no envio não consome o
 * aviso.
 */
export async function verificarAlertaDeConsumo(
  organizationId: string,
  exec: Executor = db,
): Promise<
  { avisar: false } | { avisar: true; gastoUsd: number; tetoUsd: number; percentual: number }
> {
  const [cfg] = await exec
    .select()
    .from(organizationAiSettings)
    .where(eq(organizationAiSettings.organizationId, organizationId))
    .limit(1)

  const teto = cfg?.monthlyLimitUsd ? Number(cfg.monthlyLimitUsd) : null
  if (!cfg || teto === null || teto === 0) return { avisar: false }

  const mesCorrente = new Date().toISOString().slice(0, 7)
  if (cfg.alertedMonth === mesCorrente) return { avisar: false }

  const gasto = await gastoDoMes(organizationId, exec)
  const percentual = (gasto / teto) * 100
  if (percentual < Number(cfg.alertThreshold)) return { avisar: false }

  // Marca com condição no próprio UPDATE: dois blocos do job rodando em
  // paralelo não podem avisar duas vezes.
  const marcado = await exec
    .update(organizationAiSettings)
    .set({ alertedMonth: mesCorrente })
    .where(and(
      eq(organizationAiSettings.organizationId, organizationId),
      sql`(alerted_month IS DISTINCT FROM ${mesCorrente})`,
    ))
    .returning({ organizationId: organizationAiSettings.organizationId })

  if (marcado.length === 0) return { avisar: false }
  return { avisar: true, gastoUsd: gasto, tetoUsd: teto, percentual }
}

/** Só para o script de verificação não precisar reiniciar o processo. */
export function limparCacheDeClients() {
  cache.clear()
}
