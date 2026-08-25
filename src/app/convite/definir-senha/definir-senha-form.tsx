'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { concluirConvite } from '@/server/members'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function DefinirSenhaForm({ email, empresas }: { email: string; empresas: string[] }) {
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)

    if (senha.length < 8) {
      setErro('A senha precisa de ao menos 8 caracteres.')
      return
    }
    if (senha !== confirmacao) {
      setErro('As senhas não conferem.')
      return
    }

    setSalvando(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) {
      setErro(`Não foi possível salvar a senha: ${error.message}`)
      setSalvando(false)
      return
    }

    await concluirConvite()
    // Navegação completa, não client-side: o layout autenticado precisa
    // recarregar com a membership recém-aceita.
    window.location.assign('/dashboard')
  }

  return (
    <Card className="w-full max-w-md shadow-md">
      <CardHeader className="space-y-1">
        <div className="mb-2 text-2xl font-bold text-primary">lure.expert</div>
        <CardTitle className="text-xl">Defina sua senha</CardTitle>
        <CardDescription>
          {empresas.length > 0
            ? `Você foi convidado para ${empresas.join(', ')}. Crie a senha da sua conta para entrar.`
            : 'Crie a senha da sua conta para entrar.'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={enviar} className="space-y-4">
          {erro && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {erro}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" value={email} disabled autoComplete="username" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="senha">Senha</Label>
            <Input
              id="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="new-password"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmacao">Confirme a senha</Label>
            <Input
              id="confirmacao"
              type="password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar senha e entrar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
