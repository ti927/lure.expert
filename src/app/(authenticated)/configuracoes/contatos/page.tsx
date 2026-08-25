import type { Metadata } from 'next'
import { db } from '@/db'
import { contacts } from '@/db/schema'
import { getAuthContext } from '@/lib/auth-context'

export const metadata: Metadata = { title: 'Clientes e Fornecedores' }
import { eq, asc } from 'drizzle-orm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DimensionManager, type DimensionItem } from '@/components/settings/dimension-manager'
import { CsvImportButton } from '@/components/settings/csv-import-button'
import {
  createContact,
  updateContact,
  toggleContactActive,
  deleteContact,
  getContactLinkedCount,
} from '@/server/dimensions'

/** CNPJ/CPF é guardado só com dígitos; a exibição recebe a máscara de volta. */
function formatDocument(raw: string | null): string | null {
  if (!raw) return null
  if (raw.length === 14) {
    return raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  }
  if (raw.length === 11) {
    return raw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  }
  return raw
}

export default async function ContatosPage() {
  const { organizationId } = await getAuthContext()

  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.organizationId, organizationId))
    .orderBy(asc(contacts.name))

  const items: DimensionItem[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    isActive: c.isActive,
    createdAt: c.createdAt,
    extra: {
      document: formatDocument(c.document),
      email: c.email,
      phone: c.phone,
    },
    roles: { isCustomer: c.isCustomer, isSupplier: c.isSupplier },
  }))

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Clientes e fornecedores</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Quem paga e quem recebe. Um mesmo CNPJ pode ser os dois.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Contatos</CardTitle>
              <CardDescription className="mt-1.5">
                Cada lançamento pode ser atribuído a um contato, o que permite analisar quanto foi
                faturado de um cliente ou comprado de um fornecedor.
              </CardDescription>
            </div>
            <CsvImportButton kind="contatos" />
          </div>
        </CardHeader>
        <CardContent>
          <DimensionManager
            items={items}
            title="Contatos"
            singularLabel="Contato"
            extraFields={[
              { name: 'document', label: 'CNPJ / CPF', placeholder: '00.000.000/0001-00', width: 'w-44' },
              { name: 'email', label: 'E-mail', placeholder: 'contato@empresa.com.br', width: 'w-52' },
              { name: 'phone', label: 'Telefone', placeholder: '(00) 00000-0000', width: 'w-36' },
            ]}
            roleFields={[
              { name: 'isCustomer', label: 'Cliente' },
              { name: 'isSupplier', label: 'Fornecedor' },
            ]}
            onCreate={createContact}
            onUpdate={updateContact}
            onToggleActive={toggleContactActive}
            onDelete={deleteContact}
            getLinkedCount={getContactLinkedCount}
          />
        </CardContent>
      </Card>
    </div>
  )
}
