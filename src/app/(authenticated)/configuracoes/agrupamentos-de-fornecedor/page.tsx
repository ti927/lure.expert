import type { Metadata } from 'next'
import { getAgrupamentos } from '@/server/fornecedores'
import { getCategories } from '@/server/categories'
import { getContactOptions } from '@/server/dimensions'
import { AgrupamentosClient } from './agrupamentos-client'

export const metadata: Metadata = { title: 'Agrupamentos de fornecedor' }

export default async function AgrupamentosPage() {
  const [{ agrupamentos, podeEditar }, cats, contatos] = await Promise.all([
    getAgrupamentos(),
    getCategories(),
    getContactOptions(),
  ])
  // Natureza Pai = categoria sem pai (o Tipo é coluna, não categoria)
  const naturezasPai = cats.filter((c) => !c.parentId && c.isActive).map((c) => ({ id: c.id, nome: `${c.code} ${c.name}` }))

  return (
    <div className="mx-auto max-w-4xl p-6">
      <AgrupamentosClient
        inicial={agrupamentos}
        podeEditar={podeEditar}
        naturezasPai={naturezasPai}
        contatos={contatos.map((c) => ({ id: c.id, nome: c.name }))}
      />
    </div>
  )
}
