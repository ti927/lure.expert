'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  ArrowLeftRight,
  BarChart3,
  TrendingUp,
  Landmark,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
  LogOut,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { signOut } from '@/server/auth'
import type { AppUser } from './app-shell'

const NAV = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Visão Geral' },
  { href: '/transacoes', icon: ArrowLeftRight, label: 'Transações' },
  { href: '/dre', icon: BarChart3, label: 'DRE' },
  { href: '/fluxo', icon: TrendingUp, label: 'Fluxo de Caixa' },
  { href: '/contas', icon: Landmark, label: 'Contas' },
]

const BOTTOM_NAV = [{ href: '/configuracoes', icon: Settings, label: 'Configurações' }]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  mobileOpen: boolean
  onMobileClose: () => void
  user: AppUser
}

function getInitials(email: string): string {
  const local = email.split('@')[0]
  const parts = local.split(/[._-]/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return local.slice(0, 2).toUpperCase()
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose, user }: SidebarProps) {
  const pathname = usePathname()
  const initials = getInitials(user.email)

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onMobileClose}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-sidebar transition-all duration-200',
          collapsed ? 'w-16' : 'w-60',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            'flex h-14 items-center border-b border-border px-4',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? (
            <span className="text-lg font-bold text-primary">L</span>
          ) : (
            <span className="text-base font-bold tracking-tight text-primary">lure.expert</span>
          )}
          {mobileOpen && (
            <button
              onClick={onMobileClose}
              className="ml-auto text-muted-foreground hover:text-foreground md:hidden"
              aria-label="Fechar menu"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Nav principal */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {NAV.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={isActive(item.href)}
              collapsed={collapsed}
            />
          ))}
        </nav>

        {/* Nav inferior */}
        <div className="border-t border-border p-2">
          {BOTTOM_NAV.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={isActive(item.href)}
              collapsed={collapsed}
            />
          ))}
        </div>

        {/* Avatar do usuário */}
        <div className="border-t border-border p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted',
                  collapsed && 'justify-center px-0',
                )}
                title={collapsed ? user.email : undefined}
              >
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <span className="flex-1 truncate text-left text-xs text-muted-foreground">
                    {user.email}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent side="top" align="start" className="w-56">
              <div className="px-2 py-1.5">
                <p className="text-xs font-medium">{user.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => window.location.href = '/configuracoes'} className="cursor-pointer gap-2">
                <Settings size={14} />
                Configurações
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <form action={signOut}>
                <DropdownMenuItem asChild>
                  <button type="submit" className="w-full cursor-pointer gap-2 text-destructive">
                    <LogOut size={14} />
                    Sair
                  </button>
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Botão collapse — apenas desktop */}
        <div className="hidden border-t border-border p-2 md:block">
          <button
            onClick={onToggle}
            className="flex w-full items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>
    </>
  )
}

function NavLink({
  href,
  icon: Icon,
  label,
  active,
  collapsed,
}: {
  href: string
  icon: React.ElementType
  label: string
  active: boolean
  collapsed: boolean
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon size={18} className="shrink-0" />
      {!collapsed && <span>{label}</span>}
    </Link>
  )
}
