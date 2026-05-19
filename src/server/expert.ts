'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  memberships,
  conversations,
  messages,
  organizations,
} from '@/db/schema'
import { eq, and, isNotNull, isNull, desc, asc } from 'drizzle-orm'
import { anthropic } from '@/lib/anthropic'
import { getDashboardKPIs } from './dashboard'

async function getAuthContext() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)
  if (!membership) redirect('/onboarding')

  return { userId: user.id, organizationId: membership.organizationId }
}

export type ChatMessage = {
  id: string
  role: string
  content: string
  createdAt: string
}

export async function getOrCreateConversation(): Promise<{
  conversationId: string
  history: ChatMessage[]
}> {
  const { userId, organizationId } = await getAuthContext()

  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.userId, userId),
        isNull(conversations.archivedAt),
      )
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(1)

  let conversationId: string

  if (existing) {
    conversationId = existing.id
  } else {
    const [created] = await db
      .insert(conversations)
      .values({ organizationId, userId })
      .returning({ id: conversations.id })
    conversationId = created.id
  }

  const history = await db
    .select({
      id:        messages.id,
      role:      messages.role,
      content:   messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(50)

  return {
    conversationId,
    history: history.map(m => ({
      id:        m.id,
      role:      m.role,
      content:   m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  }
}

export async function startNewConversation(): Promise<{ conversationId: string }> {
  const { userId, organizationId } = await getAuthContext()

  const [created] = await db
    .insert(conversations)
    .values({ organizationId, userId })
    .returning({ id: conversations.id })

  return { conversationId: created.id }
}

export async function sendExpertMessage(
  conversationId: string,
  userContent: string,
): Promise<string> {
  const { organizationId } = await getAuthContext()

  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, organizationId),
      )
    )
    .limit(1)
  if (!conv) throw new Error('Conversa não encontrada')

  await db.insert(messages).values({
    conversationId,
    role:    'user',
    content: userContent,
  })

  const [history, kpis, orgRow] = await Promise.all([
    db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .limit(40),
    getDashboardKPIs(),
    db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1),
  ])

  const brl = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

  const pct = (d: number | null) =>
    d !== null ? ` (${d > 0 ? '+' : ''}${d.toFixed(1)}% vs. mês anterior)` : ''

  const orgName = orgRow[0]?.name ?? 'do cliente'

  const systemPrompt = `Você é o expert da lure.expert, consultor financeiro virtual da empresa ${orgName}.

Tom e estilo: profissional direto, número antes do contexto, sem emojis, sem hedge ("talvez", "possivelmente"), sem auto-referência ("como expert...", "deixa eu explicar"). Máximo 4 frases por parágrafo sem quebra estrutural. Segunda pessoa singular ("você"). Idioma: português brasileiro.

Proibições: nunca diga "tokens", "modelo", "LLM", "IA", "assistente". Quando houver incerteza, cite o dado que falta: "para responder com precisão precisaria ver as transações categorizadas de X".

Contexto financeiro — mês vigente:
- Receita: ${brl(kpis.receita.current)}${pct(kpis.receita.delta)}
- Despesas: ${brl(kpis.despesas.current)}${pct(kpis.despesas.delta)}
- Lucro líquido: ${brl(kpis.lucroLiquido.current)}${pct(kpis.lucroLiquido.delta)}
- Saldo em caixa (acumulado): ${brl(kpis.saldoCaixa)}

Quando citar um número, indique a origem: "considerando as transações categorizadas do mês", "com base no saldo acumulado", etc. Se a pergunta exigir dados não disponíveis acima (categorias específicas, fornecedores, datas anteriores), indique qual tela o cliente pode consultar para ver o detalhe.`

  const apiMessages = history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1024,
    system:     systemPrompt,
    messages:   apiMessages,
  })

  const assistantContent =
    response.content[0]?.type === 'text' ? response.content[0].text : ''

  await db.insert(messages).values({
    conversationId,
    role:          'assistant',
    content:       assistantContent,
    modelUsed:     'claude-sonnet-4-6',
    tokensInput:   response.usage.input_tokens,
    tokensOutput:  response.usage.output_tokens,
  })

  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))

  return assistantContent
}
