'use client'

/**
 * A conta deste arquivo.
 *
 * É de ARQUIVO e não de linha: um extrato é de uma conta só, e tipo e número
 * nunca variam entre linhas do mesmo documento. Quatro campos editáveis por
 * linha em 7.762 linhas seria trabalho inventado.
 *
 * Preencher aqui **cria a conta**. Não existe cadastro de conta no app — o que
 * existe é cadastro de CONEXÃO (`data_sources` com `provider='pluggy'`), e as
 * contas de uma conexão são um array JSON que só o sync do Pluggy escreve. Por
 * isso conta caixa, ou conta corrente que o Open Finance não alcança, não tinha
 * como existir. Aqui ela nasce como `data_sources` com `provider='manual'`.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Landmark, Pencil, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setDocumentAccount } from '@/server/staging'
import { TIPOS_DE_CONTA, ROTULO_DE_CONTA, type TipoDeConta } from '@/lib/import-contract'

export interface ContaDoArquivo {
  nome: string
  tipo: string | null
  numero: string | null
}

interface Props {
  documentId: string
  conta: ContaDoArquivo | null
  contasExistentes: { nome: string; rotulo: string }[]
  totalLinhas: number
  readOnly: boolean
}

export function AccountHeader({ documentId, conta, contasExistentes, totalLinhas, readOnly }: Props) {
  const router = useRouter()
  const [editando, setEditando] = useState(false)
  const [nome, setNome] = useState(conta?.nome ?? '')
  const [tipo, setTipo] = useState<TipoDeConta>((conta?.tipo as TipoDeConta) ?? 'CHECKING_ACCOUNT')
  const [numero, setNumero] = useState(conta?.numero ?? '')
  const [salvando, startSalvar] = useTransition()

  function salvar(limpar = false) {
    startSalvar(async () => {
      const result = await setDocumentAccount(
        documentId,
        limpar ? null : { nome: nome.trim(), tipo, numero: numero.trim() || null },
      )
      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }
      setEditando(false)
      toast.success(limpar ? 'Conta removida deste arquivo.' : 'Conta salva.')
      router.refresh()
    })
  }

  if (!editando) {
    const rotulo = conta
      ? [conta.nome, conta.tipo ? ROTULO_DE_CONTA[conta.tipo as TipoDeConta] : null, conta.numero]
          .filter(Boolean).join(' · ')
      : null

    return (
      <div className="shrink-0 mx-6 mb-3 flex items-center gap-2.5 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
        <Landmark size={14} className="shrink-0 text-muted-foreground" />
        {rotulo ? (
          <>
            <span className="font-medium text-foreground">{rotulo}</span>
            <span className="text-xs text-muted-foreground">
              vale para {totalLinhas === 1 ? 'a linha' : `as ${totalLinhas} linhas`} deste arquivo
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            Sem conta —{' '}
            <span className="text-xs">
              os lançamentos entram sem banco/cartão, e a regra de categorização nasce global.
            </span>
          </span>
        )}
        {!readOnly && (
          <Button
            size="sm" variant="ghost"
            className="ml-auto h-7 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setEditando(true)}
          >
            <Pencil size={12} className="mr-1" />{conta ? 'Alterar' : 'Informar conta'}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="shrink-0 mx-6 mb-3 rounded-lg border bg-muted/20 px-3 py-3 space-y-2.5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Landmark size={14} className="text-muted-foreground" />
        Conta deste arquivo
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="conta-nome" className="text-xs text-muted-foreground">Nome</label>
          <Input
            id="conta-nome" list="contas-existentes" value={nome}
            onChange={e => setNome(e.target.value)}
            placeholder="Itaú PJ, Caixa, Cartão BTG…"
            className="h-8 w-56 text-sm" autoFocus
          />
          {/* Oferece as que já existem, mas aceita nome novo: é assim que uma
              conta que nunca foi conectada passa a existir. */}
          <datalist id="contas-existentes">
            {contasExistentes.map(c => <option key={c.nome} value={c.nome}>{c.rotulo}</option>)}
          </datalist>
        </div>

        <div className="space-y-1">
          <label htmlFor="conta-tipo" className="text-xs text-muted-foreground">Tipo</label>
          <select
            id="conta-tipo" value={tipo}
            onChange={e => setTipo(e.target.value as TipoDeConta)}
            className="h-8 w-36 rounded-md border border-input bg-background px-2 text-sm"
          >
            {TIPOS_DE_CONTA.map(t => <option key={t} value={t}>{ROTULO_DE_CONTA[t]}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="conta-numero" className="text-xs text-muted-foreground">Número <span className="opacity-60">(opcional)</span></label>
          <Input
            id="conta-numero" value={numero} onChange={e => setNumero(e.target.value)}
            placeholder="12345-6" className="h-8 w-32 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" className="h-8" disabled={salvando || !nome.trim()} onClick={() => salvar()}>
            <Check size={13} className="mr-1" />Salvar
          </Button>
          {conta && (
            <Button size="sm" variant="outline" className="h-8" disabled={salvando} onClick={() => salvar(true)}>
              Remover
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => setEditando(false)}>
            <X size={13} />
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Vale para {totalLinhas === 1 ? 'a linha' : `as ${totalLinhas} linhas`} deste arquivo. A conta
        passa a aparecer em Contas e no filtro de Transações. Se ela já existe, escolha da lista em
        vez de digitar de novo — grafias diferentes viram contas diferentes.
      </p>
    </div>
  )
}
