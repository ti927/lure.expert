'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/db'
import { memberships, organizationAiSettings } from '@/db/schema'
import { eq, and, isNotNull, asc } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { encryptSecret, ultimos4, cryptoDisponivel } from '@/lib/crypto'
import { registrarUsoDeIa } from '@/lib/ai-usage'
import { testarChaveAnthropic, MODELO_TESTE } from '@/lib/ai-key-test'
import { gastoDoMes } from '@/lib/ai-access'

async function getAuthContext() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .orderBy(asc(memberships.createdAt), asc(memberships.organizationId))
    .limit(1)
  if (!membership) redirect('/onboarding')

  return { userId: user.id, organizationId: membership.organizationId }
}

export interface AiSettingsView {
  /** 'own' = chave da organização · 'platform' = chave da Lure. */
  origem:        'own' | 'platform'
  /** Só os 4 últimos. A chave em si NUNCA volta ao cliente. */
  ultimos4:      string | null
  validadaEm:    string | null
  erro:          string | null
  tetoUsd:       number | null
  limiarAlerta:  number
  gastoMesUsd:   number
  /** `ENCRYPTION_KEY` está configurada no servidor? Sem ela nada é cadastrável. */
  cryptoPronta:  boolean
}

export async function getAiSettings(): Promise<AiSettingsView> {
  const { organizationId } = await getAuthContext()

  const [cfg] = await db
    .select()
    .from(organizationAiSettings)
    .where(eq(organizationAiSettings.organizationId, organizationId))
    .limit(1)

  return {
    origem:       (cfg?.keySource ?? 'platform') as 'own' | 'platform',
    ultimos4:     cfg?.apiKeyLast4 ?? null,
    validadaEm:   cfg?.apiKeyValidatedAt?.toISOString() ?? null,
    erro:         cfg?.apiKeyError ?? null,
    tetoUsd:      cfg?.monthlyLimitUsd ? Number(cfg.monthlyLimitUsd) : null,
    limiarAlerta: cfg ? Number(cfg.alertThreshold) : 80,
    gastoMesUsd:  await gastoDoMes(organizationId),
    cryptoPronta: cryptoDisponivel(),
  }
}

const chaveSchema = z.string().trim()
  .min(20, 'A chave parece curta demais.')
  .max(300, 'A chave parece longa demais.')
  .regex(/^sk-ant-/, 'Chaves da Anthropic começam com "sk-ant-". Confira se copiou a chave certa.')

/**
 * Cadastra a chave da organização.
 *
 * TESTA ANTES DE GRAVAR. Uma chave errada gravada em silêncio só apareceria no
 * próximo upload, como falha sem explicação — e o cliente não teria como ligar
 * uma coisa à outra. A chamada de teste é de 1 token e é registrada em
 * `agent_events` como qualquer outra: o que não é medido não entra em teto.
 *
 * Gravar a chave **muda a origem para `own` automaticamente**. Não existe
 * caminho no app para o cliente se marcar como `platform` — se existisse, ele
 * voltaria a gastar a chave da Lure, que é exatamente o que esta fase resolve.
 */
export async function saveAiKey(chaveBruta: string) {
  const { organizationId } = await getAuthContext()

  if (!cryptoDisponivel()) {
    return { error: 'O servidor não está configurado para guardar chaves com segurança (ENCRYPTION_KEY ausente). Avise o suporte.' }
  }

  const parsed = chaveSchema.safeParse(chaveBruta)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const chave = parsed.data

  // Teste real contra a API. É a única forma de saber se a chave vale — validar
  // o formato só pegaria erro de digitação.
  const teste = await testarChaveAnthropic(chave)
  if (!teste.ok) return { error: teste.mensagem }

  await registrarUsoDeIa({
    organizationId,
    kind:  'key_validation',
    model: MODELO_TESTE,
    usage: teste.usage,
    payload: { ultimos4: ultimos4(chave) },
  })

  await db
    .insert(organizationAiSettings)
    .values({
      organizationId,
      keySource:         'own',
      apiKeyEncrypted:   encryptSecret(chave),
      apiKeyLast4:       ultimos4(chave),
      apiKeyValidatedAt: new Date(),
      apiKeyError:       null,
    })
    .onConflictDoUpdate({
      target: organizationAiSettings.organizationId,
      set: {
        keySource:         'own',
        apiKeyEncrypted:   encryptSecret(chave),
        apiKeyLast4:       ultimos4(chave),
        apiKeyValidatedAt: new Date(),
        apiKeyError:       null,
        updatedAt:         new Date(),
      },
    })

  revalidatePath('/configuracoes/consumo')
  return { success: true, ultimos4: ultimos4(chave) }
}

/**
 * Remove a chave. **Isto desliga a IA da organização**, e a tela avisa antes.
 *
 * A origem continua `own` de propósito: remover a chave não devolve ninguém à
 * chave da Lure.
 */
export async function removeAiKey() {
  const { organizationId } = await getAuthContext()

  await db
    .update(organizationAiSettings)
    .set({
      apiKeyEncrypted:   null,
      apiKeyLast4:       null,
      apiKeyValidatedAt: null,
      apiKeyError:       null,
      updatedAt:         new Date(),
    })
    .where(eq(organizationAiSettings.organizationId, organizationId))

  revalidatePath('/configuracoes/consumo')
  return { success: true }
}

const limiteSchema = z.object({
  // O menor teto possível é US$ 0,01: a coluna é numeric(10,2). Zero é válido e
  // significa "sem IA" — a tela diz isso em vez de deixar descobrir na prática.
  tetoUsd:      z.number().min(0).max(99_999_999).nullable(),
  limiarAlerta: z.number().min(1).max(100),
})

export async function saveAiLimit(input: { tetoUsd: number | null; limiarAlerta: number }) {
  const { organizationId } = await getAuthContext()

  const parsed = limiteSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  await db
    .insert(organizationAiSettings)
    .values({
      organizationId,
      monthlyLimitUsd: parsed.data.tetoUsd === null ? null : parsed.data.tetoUsd.toFixed(2),
      alertThreshold:  parsed.data.limiarAlerta.toFixed(2),
      // Trocar o teto zera o aviso do mês: o limiar mudou, o aviso anterior não
      // vale mais.
      alertedMonth:    null,
    })
    .onConflictDoUpdate({
      target: organizationAiSettings.organizationId,
      set: {
        monthlyLimitUsd: parsed.data.tetoUsd === null ? null : parsed.data.tetoUsd.toFixed(2),
        alertThreshold:  parsed.data.limiarAlerta.toFixed(2),
        alertedMonth:    null,
        updatedAt:       new Date(),
      },
    })

  revalidatePath('/configuracoes/consumo')
  return { success: true }
}
