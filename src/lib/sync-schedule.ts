// A agenda de sincronização dos bancos, escolhida pela organização.
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE ESTA AGENDA GOVERNA — E O QUE ELA NÃO GOVERNA
//
// Ela decide quando o lure.expert **relê** o que a Pluggy já tem. Não decide
// quando a Pluggy vai ao banco: isso é o ciclo dela (~24h, visível em
// `nextAutoSyncAt` do item), e quando termina ela dispara o webhook
// `item/updated`, que já roda o sync na hora. Medido em 1/set nos 4 itens da
// Quick Aviação: todos com atualização automática marcada para +24h.
//
// Forçar a Pluggy a consultar o banco seria `client.updateItem(itemId)`, que
// **nenhum ponto do app chama** — nem o cron, nem o botão "Atualizar" de
// `/contas`. Se um dia isso mudar, esta agenda passa a significar outra coisa,
// e o texto da tela precisa mudar junto.
//
// ─────────────────────────────────────────────────────────────────────────────
// FORA DE `'use server'` DE PROPÓSITO
//
// A regra é aritmética pura, e o cron depende dela para escolher quem despachar
// — um erro aqui não levanta exceção, só faz uma organização parar de
// sincronizar em silêncio. Aqui ela pode ser exercitada nas 24 horas do dia por
// um script, sem sessão HTTP.

import { z } from 'zod'

/** De quantas em quantas horas. 24 = uma vez por dia, no horário escolhido. */
export const FREQUENCIAS_DE_SYNC = [24, 12, 8, 6, 4, 3, 2] as const
export type FrequenciaDeSync = (typeof FREQUENCIAS_DE_SYNC)[number]

export const agendaDeSyncSchema = z.object({
  /** Hora cheia, 0–23, no horário de Brasília. */
  horaInicial: z.number().int().min(0).max(23),
  aCada: z.number().int().refine(
    (n): n is FrequenciaDeSync => (FREQUENCIAS_DE_SYNC as readonly number[]).includes(n),
    { message: `Frequência inválida. Use uma de: ${FREQUENCIAS_DE_SYNC.join(', ')}.` },
  ),
})

export type AgendaDeSync = z.infer<typeof agendaDeSyncSchema>

/**
 * O padrão é **exatamente o comportamento de antes desta configuração existir**:
 * uma vez por dia, às 03:00 de Brasília (o cron era `0 6 * * *` em UTC).
 *
 * Organização que nunca escolher nada não pode mudar de comportamento por causa
 * da tela nova — e é isso que a asserção do teste prende.
 */
export const AGENDA_PADRAO: AgendaDeSync = { horaInicial: 3, aCada: 24 }

/** A chave dentro de `organizations.settings` (jsonb). */
export const CHAVE_DE_AGENDA = 'syncBancos'

/**
 * Lê a agenda do `settings` da organização, caindo no padrão em qualquer dúvida.
 *
 * **Tolerante de propósito.** Este código roda dentro do cron que serve TODAS as
 * organizações: um `settings` corrompido numa delas não pode derrubar o
 * despacho das outras. Valor inválido vira o padrão, não exceção.
 */
export function lerAgenda(settings: unknown): AgendaDeSync {
  const s = (settings ?? {}) as Record<string, unknown>
  const parsed = agendaDeSyncSchema.safeParse(s[CHAVE_DE_AGENDA])
  return parsed.success ? parsed.data : AGENDA_PADRAO
}

/**
 * A hora cheia em Brasília.
 *
 * Via `Intl`, e **não** por `−3` fixo: o código antigo assumia UTC−3 num
 * comentário ("Brasil não usa horário de verão"), o que é verdade desde 2019 e
 * pode deixar de ser. Um deslocamento fixo erraria por uma hora sem levantar
 * erro nenhum — a organização simplesmente sincronizaria no horário errado, e
 * ninguém perceberia.
 */
export function horaEmBrasilia(quando: Date = new Date()): number {
  const texto = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(quando)
  return Number(texto) % 24
}

/**
 * Esta hora é uma das horas da agenda?
 *
 * A conta é cíclica a partir da hora inicial, então "a partir das 22:00, a cada
 * 6h" inclui 04:00 e 10:00 do dia seguinte — que é como a pessoa lê a frase.
 */
export function deveRodarAgora(agenda: AgendaDeSync, hora: number): boolean {
  const delta = hora - agenda.horaInicial
  return ((delta % agenda.aCada) + agenda.aCada) % agenda.aCada === 0
}

/** Todas as horas do dia em que a agenda roda, em ordem crescente. */
export function horariosDoDia(agenda: AgendaDeSync): number[] {
  const horas: number[] = []
  for (let h = 0; h < 24; h++) if (deveRodarAgora(agenda, h)) horas.push(h)
  return horas
}

export function formatarHora(hora: number): string {
  return `${String(hora).padStart(2, '0')}:00`
}

export function rotuloDeFrequencia(aCada: FrequenciaDeSync): string {
  if (aCada === 24) return '1× por dia'
  return `a cada ${aCada} horas`
}

/**
 * A frase que a tela mostra — e a mesma que o teste afirma.
 *
 * Escrever o horário duas vezes (uma na tela, outra na regra) é como o texto
 * passa a mentir depois de qualquer mudança na aritmética.
 */
export function descreverAgenda(agenda: AgendaDeSync): string {
  if (agenda.aCada === 24) return `todo dia às ${formatarHora(agenda.horaInicial)}`
  // A lista começa na hora escolhida e vira o dia — "a partir das 22:00 … (22:00,
  // 04:00, 10:00, 16:00)". Em ordem crescente ela abriria em 04:00, logo depois
  // de a frase dizer "a partir das 22:00", e leria como erro.
  const horas = Array.from(
    { length: 24 / agenda.aCada },
    (_, i) => formatarHora((agenda.horaInicial + i * agenda.aCada) % 24),
  ).join(', ')
  return `a partir das ${formatarHora(agenda.horaInicial)}, a cada ${agenda.aCada} horas (${horas})`
}
