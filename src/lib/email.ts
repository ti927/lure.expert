// E-mail transacional enviado PELO APP, via API do Resend.
//
// Existe porque o Supabase Auth só envia e-mail para conta que ELE está
// criando — convite para e-mail já cadastrado é recusado pelo
// `inviteUserByEmail`, e não há endpoint de "avisar usuário existente". O
// primeiro consumidor é o aviso de convite da Fase 4.A; alertas futuros do
// agente proativo (Fase 11) passam por aqui também.
//
// A MESMA chave do Resend serve para o SMTP do Supabase e para esta API — o
// que muda é quem disca: lá é o Supabase, aqui somos nós.
//
// Recusa é descritiva (`{ erro }`), nunca exceção — quem chama decide se o
// e-mail era essencial. No convite, não é: o convite existe sem o aviso, e a
// tela diz que o aviso não saiu.

import { sanitizeKey } from '@/lib/anthropic'

// Remetente decidido com Julio em 25/ago/2026. Precisa ser do domínio
// verificado no Resend; `EMAIL_REMETENTE` sobrepõe sem mexer em código.
const REMETENTE_PADRAO = 'lure.expert <ti@lureconsultoria.com.br>'

export function escapeHtml(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** O aviso para quem JÁ tem conta e foi convidado a outra organização. Puro — testável. */
export function emailAvisoDeConvite(args: { empresa: string; url: string }): { assunto: string; html: string } {
  const empresa = escapeHtml(args.empresa)
  const url = escapeHtml(args.url)
  return {
    assunto: `Você foi convidado para ${args.empresa} no lure.expert`,
    html: [
      '<h2>Você foi convidado</h2>',
      `<p>A empresa <strong>${empresa}</strong> convidou você para acessá-la no lure.expert, usando a conta que você já tem.</p>`,
      `<p><a href="${url}">Entrar e aceitar o convite</a></p>`,
      '<p>Ao entrar, o convite aparece em Configurações, com os botões para aceitar ou recusar.</p>',
      '<p>Se você não esperava este convite, ignore este e-mail.</p>',
    ].join('\n'),
  }
}

export async function enviarEmail(args: {
  para: string
  assunto: string
  html: string
}): Promise<{ erro?: string }> {
  const chave = sanitizeKey(process.env.RESEND_API_KEY)
  if (!chave) {
    return { erro: 'RESEND_API_KEY não está configurada — o aviso por e-mail não pôde ser enviado.' }
  }

  const remetente = process.env.EMAIL_REMETENTE?.trim() || REMETENTE_PADRAO

  try {
    const resposta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: remetente,
        to: [args.para],
        subject: args.assunto,
        html: args.html,
      }),
    })

    if (!resposta.ok) {
      const corpo = (await resposta.json().catch(() => null)) as { message?: string } | null
      return { erro: `O Resend recusou o envio: ${corpo?.message ?? `HTTP ${resposta.status}`}` }
    }
    return {}
  } catch (err) {
    return { erro: `Falha de rede ao enviar o e-mail: ${(err as Error).message}` }
  }
}
