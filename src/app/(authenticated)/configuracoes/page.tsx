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
import { AutoCategorizeToggle } from '@/components/settings/auto-categorize-toggle'
import { getAutoCategorize } from '@/server/settings'
import { Tags, Building2, Briefcase, Landmark, Users, ChevronRight, Zap, FileText, Split, Activity } from 'lucide-react'

const NAV_SECTIONS = [
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
  {
    href: '/configuracoes/contatos',
    icon: Users,
    title: 'Clientes e fornecedores',
    description: 'Saiba quanto foi faturado de cada cliente e comprado de cada fornecedor.',
  },
  {
    href: '/configuracoes/modelos-de-rateio',
    icon: Split,
    title: 'Modelos de rateio',
    description: 'Divisões que você repete — 60% Comercial, 40% Administrativo — salvas para reaplicar em um clique.',
  },
]

export default async function ConfiguracoesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [[result], autoCategorize] = await Promise.all([
    db
      .select({ org: organizations })
      .from(memberships)
      .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
      .where(and(eq(memberships.userId, user.id), isNotNull(memberships.acceptedAt)))
      .limit(1),
    getAutoCategorize(),
  ])

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

      {/* Automação */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Automação</CardTitle>
          <CardDescription>
            Controle como o expert processa os lançamentos ao importar ou sincronizar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AutoCategorizeToggle initialValue={autoCategorize} />

          <Link href="/configuracoes/regras">
            <div className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-muted/40 transition-colors cursor-pointer">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted shrink-0">
                <Zap className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Regras de categorização</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  Veja, edite ou apague regras que o expert aprendeu com suas classificações.
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </Link>

          <Link href="/configuracoes/consumo">
            <div className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-muted/40 transition-colors cursor-pointer">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted shrink-0">
                <Activity className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Consumo de IA</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  Quanto o expert processou nesta organização, por mês e por origem, e o que custou.
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </Link>

          <Link href="/configuracoes/sefaz">
            <div className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-muted/40 transition-colors cursor-pointer">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted shrink-0">
                <FileText className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Conexões SEFAZ / NF-e</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  Conecte CNPJs das entidades jurídicas para puxar NF-e de saída e entrada automaticamente.
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </Link>
        </CardContent>
      </Card>

      {/* Classificações analíticas */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Classificações analíticas
        </h2>
        <div className="space-y-2">
          {NAV_SECTIONS.map(({ href, icon: Icon, title, description }) => (
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
