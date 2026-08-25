'use client'

// O seletor de organização ativa, no topo da sidebar.
//
// Com UMA organização ele é um rótulo estático — sem seta, sem menu — porque
// oferecer um menu de um item só ensinaria o usuário a ignorá-lo. A troca leva
// ao dashboard (decisão em `server/organizations.ts`).

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Building2, Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { trocarOrganizacao, type OrganizacaoDoUsuario } from '@/server/organizations'
import { PAPEL_LABEL, type Papel } from '@/lib/members-types'

interface OrgSwitcherProps {
  organizacoes: OrganizacaoDoUsuario[]
  ativaId: string
  collapsed: boolean
}

export function OrgSwitcher({ organizacoes, ativaId, collapsed }: OrgSwitcherProps) {
  const [pendente, iniciar] = useTransition()
  const ativa = organizacoes.find((o) => o.id === ativaId)
  const nome = ativa?.nome ?? 'Organização'

  function trocar(id: string) {
    if (id === ativaId) return
    iniciar(async () => {
      // Sucesso redireciona para /dashboard dentro da própria action.
      const r = await trocarOrganizacao(id)
      if (r?.erro) toast.error(r.erro)
    })
  }

  if (organizacoes.length <= 1) {
    return (
      <div
        className={cn(
          'flex items-center gap-2.5 border-b border-border px-4 py-2.5',
          collapsed && 'justify-center px-0',
        )}
        title={collapsed ? nome : undefined}
      >
        <Building2 size={16} className="shrink-0 text-muted-foreground" strokeWidth={1.5} />
        {!collapsed && (
          <span className="truncate text-xs font-medium text-foreground">{nome}</span>
        )}
      </div>
    )
  }

  return (
    <div className="border-b border-border p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted',
              collapsed && 'justify-center px-0',
            )}
            title={collapsed ? nome : undefined}
            disabled={pendente}
            aria-label="Trocar de organização"
          >
            <Building2 size={16} className="shrink-0 text-muted-foreground" strokeWidth={1.5} />
            {!collapsed && (
              <>
                <span className="flex-1 truncate text-left text-xs font-medium text-foreground">
                  {pendente ? 'Trocando...' : nome}
                </span>
                <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="bottom" align="start" className="w-60">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Suas organizações
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {organizacoes.map((o) => (
            <DropdownMenuItem
              key={o.id}
              onSelect={() => trocar(o.id)}
              className="cursor-pointer gap-2"
              disabled={pendente}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{o.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {PAPEL_LABEL[o.papel as Papel] ?? o.papel}
                </p>
              </div>
              {o.id === ativaId && <Check size={14} className="shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
