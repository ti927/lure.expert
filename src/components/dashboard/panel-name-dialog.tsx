'use client'

// Criar e renomear painel — o mesmo diálogo nos dois modos, porque a diferença
// é só o texto e o valor inicial.

import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function NomeDoPainelDialog({
  modo, nomeAtual, onFechar, onConfirmar,
}: {
  modo: 'criar' | 'renomear' | null
  nomeAtual: string
  onFechar: () => void
  onConfirmar: (nome: string) => void
}) {
  const [nome, setNome] = useState('')

  useEffect(() => {
    if (modo === 'renomear') setNome(nomeAtual)
    if (modo === 'criar') setNome('')
  }, [modo, nomeAtual])

  const valido = nome.trim().length > 0 && nome.trim().length <= 80

  return (
    <Dialog open={modo !== null} onOpenChange={o => { if (!o) onFechar() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{modo === 'criar' ? 'Novo painel' : 'Renomear painel'}</DialogTitle>
          <DialogDescription>
            {modo === 'criar'
              ? 'O painel nasce vazio. Peça os blocos ao expert pelo claude.ai.'
              : 'O endereço do painel não muda ao renomear.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="nome-painel">Nome</Label>
          <Input
            id="nome-painel"
            value={nome}
            maxLength={80}
            placeholder="Conselho, Operação, Banco..."
            onChange={e => setNome(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && valido) onConfirmar(nome.trim()) }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button disabled={!valido} onClick={() => onConfirmar(nome.trim())}>
            {modo === 'criar' ? 'Criar' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
