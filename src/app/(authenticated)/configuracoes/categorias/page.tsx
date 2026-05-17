import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CategoryManager } from '@/components/settings/category-manager'
import {
  getCategoriesWithTxCount,
  createCategory,
  updateCategory,
  toggleCategoryActive,
  deleteCategory,
} from '@/server/categories'

export default async function CategoriasPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const cats = await getCategoriesWithTxCount()

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Plano de contas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Categorias financeiras da sua organização — receitas, custos, despesas e demais naturezas.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Categorias</CardTitle>
          <CardDescription>
            Organize seu plano de contas. As categorias seeded são o padrão DRE — renomeie e
            complemente conforme sua realidade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CategoryManager
            categories={cats}
            onCreate={createCategory}
            onUpdate={updateCategory}
            onToggleActive={toggleCategoryActive}
            onDelete={deleteCategory}
          />
        </CardContent>
      </Card>
    </div>
  )
}
