'use client'

// Agrupamentos de fornecedor: "descrição contém X" → um fornecedor só, na tela
// /fornecedores. Para o que a regra genérica não alcança — a folha paga em TED de
// lote, o câmbio pago a uma corretora antes de virar fornecedor. Ver Decisão 33.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/states/empty-state'
import { normalizarDescricao } from '@/lib/descricao-normalizada'
import type { Agrupamento } from '@/lib/fornecedores-types'
import { saveAgrupamento, deleteAgrupamento } from '@/server/fornecedores'

type Opcao = { id: string; nome: string }
interface Form { nome: string; padrao: string; naturezaPaiId: string; contactId: string; sobrepoeContato: boolean; isActive: boolean }
const VAZIO: Form = { nome: '', padrao: '', naturezaPaiId: '', contactId: '', sobrepoeContato: false, isActive: true }

export function AgrupamentosClient({ inicial, podeEditar, naturezasPai, contatos }: {
  inicial: Agrupamento[]; podeEditar: boolean; naturezasPai: Opcao[]; contatos: Opcao[]
}) {
  const [lista, setLista] = useState(inicial)
  const [editando, setEditando] = useState<string | 'novo' | null>(null)
  const [form, setForm] = useState<Form>(VAZIO)
  const [confirmarApagar, setConfirmarApagar] = useState<string | null>(null)
  const [pendente, start] = useTransition()

  const nomeNat = new Map(naturezasPai.map((n) => [n.id, n.nome]))
  const nomeCont = new Map(contatos.map((c) => [c.id, c.nome]))

  function abrir(g?: Agrupamento) {
    setEditando(g ? g.id : 'novo')
    setForm(g ? { nome: g.nome, padrao: g.padrao, naturezaPaiId: g.naturezaPaiId ?? '', contactId: g.contactId ?? '', sobrepoeContato: g.sobrepoeContato, isActive: g.isActive } : VAZIO)
  }

  function salvar() {
    const id = editando && editando !== 'novo' ? editando : undefined
    start(async () => {
      const r = await saveAgrupamento({
        nome: form.nome, padrao: form.padrao, isActive: form.isActive, sobrepoeContato: form.sobrepoeContato,
        naturezaPaiId: form.naturezaPaiId || null, contactId: form.contactId || null,
      }, id)
      if ('error' in r) { toast.error(r.error); return }
      const padrao = normalizarDescricao(form.padrao) ?? ''
      const novo: Agrupamento = {
        id: r.id, nome: form.nome.trim(), padrao, naturezaPaiId: form.naturezaPaiId || null, contactId: form.contactId || null, sobrepoeContato: form.sobrepoeContato,
        ordem: lista.find((g) => g.id === r.id)?.ordem ?? (Math.max(0, ...lista.map((g) => g.ordem)) + 1), isActive: form.isActive,
      }
      setLista((l) => (id ? l.map((g) => (g.id === id ? novo : g)) : [...l, novo]))
      setEditando(null)
      toast.success('Agrupamento salvo.')
    })
  }

  function apagar(id: string) {
    start(async () => {
      const r = await deleteAgrupamento(id)
      if ('error' in r) { toast.error(r.error); return }
      setLista((l) => l.filter((g) => g.id !== id))
      setConfirmarApagar(null)
      toast.success('Agrupamento apagado.')
    })
  }

  const previa = normalizarDescricao(form.padrao) ?? ''

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/configuracoes" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3 w-3" /> Configurações
        </Link>
        <h1 className="text-lg font-semibold">Agrupamentos de fornecedor</h1>
        <p className="text-sm text-muted-foreground">
          Na tela de Fornecedores, todo lançamento cuja descrição contém o trecho vira um fornecedor só. Serve para o que o
          cadastro de contatos não resolve, como a folha paga em lote ou um câmbio pago antes de virar fornecedor. Vale o
          primeiro agrupamento da lista que casar. Por padrão ele só pega lançamentos sem contato (e os do contato ligado a ele); marque “vale mesmo com contato” quando o trecho deve vencer o cadastro.
        </p>
        {!podeEditar && <p className="text-xs text-amber-700">Só administradores e o proprietário alteram os agrupamentos.</p>}
      </div>

      {podeEditar && editando === null && <Button size="sm" onClick={() => abrir()}>Novo agrupamento</Button>}

      {editando !== null && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Nome do fornecedor agrupado</span>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Folha de pagamento (TEDs em lote)" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">A descrição contém</span>
              <Input value={form.padrao} onChange={(e) => setForm({ ...form, padrao: e.target.value })} placeholder="ted pagamento fornecedor" />
              <span className="block text-xs text-muted-foreground">Comparado sem acento, sem números e em minúsculas{previa ? `: "${previa}"` : ''}.</span>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Só nesta Natureza Pai (opcional)</span>
              <select value={form.naturezaPaiId} onChange={(e) => setForm({ ...form, naturezaPaiId: e.target.value })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="">Qualquer natureza</option>
                {naturezasPai.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Também os lançamentos deste contato (opcional)</span>
              <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="">Nenhum</option>
                {contatos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={form.sobrepoeContato} onChange={(e) => setForm({ ...form, sobrepoeContato: e.target.checked })} />
            <span>Vale mesmo quando o lançamento já tem contato<span className="block text-xs text-muted-foreground">Use para a folha em lote, cujas partes apontam para o banco ou para cada pessoa. Deixe desmarcado para o câmbio, onde o fornecedor final já identificado deve continuar com o próprio nome.</span></span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Ativo
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={salvar} disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar'}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditando(null)} disabled={pendente}>Cancelar</Button>
          </div>
        </div>
      )}

      {lista.length === 0 ? (
        <EmptyState title="Nenhum agrupamento" description="Sem agrupamentos, a tela de Fornecedores usa só o cadastro de contatos, o CNPJ e a descrição do extrato." />
      ) : (
        <div className="overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2">Fornecedor agrupado</th><th className="px-3 py-2">Descrição contém</th><th className="px-3 py-2">Natureza Pai</th><th className="px-3 py-2">Contato</th><th className="px-3 py-2">Situação</th><th /></tr>
            </thead>
            <tbody>
              {lista.map((g) => (
                <tr key={g.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{g.nome}</td>
                  <td className="px-3 py-2 font-mono text-xs">{g.padrao}</td>
                  <td className="px-3 py-2 text-xs">{g.naturezaPaiId ? nomeNat.get(g.naturezaPaiId) ?? '(apagada)' : 'Qualquer'}</td>
                  <td className="px-3 py-2 text-xs">{g.contactId ? nomeCont.get(g.contactId) ?? '(inativo)' : '—'}</td>
                  <td className="px-3 py-2 text-xs">{g.isActive ? 'Ativo' : 'Inativo'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {podeEditar && (confirmarApagar === g.id ? (
                      <span className="inline-flex items-center gap-2 text-xs">
                        Apagar?
                        <Button size="sm" variant="destructive" onClick={() => apagar(g.id)} disabled={pendente}>Apagar</Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmarApagar(null)}>Não</Button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => abrir(g)} aria-label={`Editar ${g.nome}`}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setConfirmarApagar(g.id)} aria-label={`Apagar ${g.nome}`}><Trash2 className="h-4 w-4" /></Button>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
