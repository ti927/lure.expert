// O destino dos links de e-mail do Supabase Auth (convite, recuperação de
// senha, confirmação de troca de e-mail).
//
// PRÉ-REQUISITO NO PAINEL DO SUPABASE: o template do e-mail precisa apontar o
// link para cá com o token em query — para o convite:
//
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/convite/definir-senha
//
// Sem isso o template padrão usa `{{ .ConfirmationURL }}`, que redireciona com
// os tokens no FRAGMENTO da URL (`#access_token=...`) — e fragmento nunca
// chega ao servidor, então nenhum route handler consegue criar a sessão.
// Com `token_hash`, o `verifyOtp` roda aqui no servidor e grava os cookies
// pela mesma via do login.
//
// Rota HUMANA (regra da 3.1): passa pelo middleware, autentica por cookie ao
// FIM (o verifyOtp é quem cria o cookie), e pode redirecionar.

import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { destinoSeguro } from '@/lib/redirect-seguro'

const TIPOS: readonly EmailOtpType[] = ['invite', 'recovery', 'email', 'signup', 'magiclink', 'email_change']

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const tipo = url.searchParams.get('type') as EmailOtpType | null
  const next = destinoSeguro(url.searchParams.get('next'))

  const paraLogin = (erro: string) => {
    const destino = new URL('/login', url.origin)
    destino.searchParams.set('error', erro)
    return NextResponse.redirect(destino)
  }

  if (!tokenHash || !tipo || !TIPOS.includes(tipo)) {
    return paraLogin('Link inválido. Peça um novo convite ou entre com e-mail e senha.')
  }

  const supabase = createClient()
  const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash })
  if (error) {
    // Link vencido ou já usado — o texto diz o que fazer, não o código do erro.
    return paraLogin('Este link expirou ou já foi usado. Peça um novo convite.')
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
