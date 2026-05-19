import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: 'Configurações' }
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { memberships, organizations } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { OrgForm } from '@/components/settings/org-form'
import { Tags, Building2, Briefcase, Landmark, ChevronRight, Package, CreditCard, TrendingUp, BoxesIcon } from 'lucide-react'

const ANALYTICS_SECTIONS = [
  {
    href: '/configuracoes/categorias',
    icon: Tags,
    title: 'Plano de contas',
    description: 'Gerencie categorias financeiras — receitas, custos, despesas e demais naturezas.',
  },
  {
    href: '/configuracoes/centros-de-custo',
    icon: Building2,
    title: 'Centros de custo',
    description: 'Classifique lançamentos por departamento ou setor da empresa.',
  },
  {
    href: '/configuracoes/unidades-de-negocio',
    icon: Briefcase,
    title: 'Unidades de negócio',
    description: 'Segmente por unidade operacional — restaurante, hotel, eventos, etc.',
  },
  {
    href: '/configuracoes/entidades-juridicas',
    icon: Landmark,
    title: 'Entidades jurídicas',
    description: 'Vincule lançamentos a CNPJs — matriz, filiais ou empresas do grupo.',
  },
]

const BP_SECTIONS = [
  {
    href: '/configuracoes/imobilizado',
    icon: Package,
    title: 'Imobilizado',
    description: 'Equipamentos, veículos e móveis — Ativo Não-Circulante.',
  },
  {
    href: '/configuracoes/emprestimos',
    icon: CreditCard,
    title: 'Empréstimos e financiamentos',
    description: 'Capital de giro, CCB, BNDES, mútuos — Passivo Circulante e Não-Circulante.',
  },
  {
    href: '/configuracoes/patrimonio-liquido',
    icon: TrendingUp,
    title: 'Patrimônio Líquido',
    description: 'Aportes, retiradas e distribuição de lucros — PL no Balanço.',
  },
  {
    href: '/configuracoes/estoque',
    icon: BoxesIcon,
    title: 'Estoque',
    description: 'Snapshots periódicos do valor do estoque — Ativo Circulante.',
  },
]

export default async function ConfiguracoesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [result] = await db
    .select({ org: organizations })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
    .limit(1)

  if (!result) redirect('/onboarding')

  const { org } = result

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">Dados da empresa e classificações analíticas</p>
      </div>

      {/* Dados da empresa */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Dados da empresa</CardTitle>
          <CardDescription>
            Informações básicas da sua organização no lure.expert
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrgForm org={org} />
        </CardContent>
      </Card>

      {/* Classificações analíticas */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Classificações analíticas
        </h2>
        <div className="space-y-2">
          {ANALYTICS_SECTIONS.map(({ href, icon: Icon, title, description }) => (
            <Link key={href} href={href}>
              <div className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-muted/40 transition-colors cursor-pointer">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted shrink-0">
                  <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{description}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Balanço Patrimonial */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Balanço Patrimonial
        </h2>
        <div className="space-y-2">
          {BP_SECTIONS.map(({ href, icon: Icon, title, description }) => (
            <Link key={href} href={href}>
              <div className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-muted/40 transition-colors cursor-pointer">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted shrink-0">
                  <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{description}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
