'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Sidebar } from './sidebar'
import { Menu } from 'lucide-react'

const STORAGE_KEY = 'sidebar-collapsed'

export type AppUser = { id: string; email: string }

interface AppShellProps {
  children: React.ReactNode
  user: AppUser
}

export function AppShell({ children, user }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) setCollapsed(stored === 'true')
  }, [])

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }

  return (
    <div className="h-screen overflow-hidden bg-background">
      <Sidebar
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        user={user}
      />

      <div
        className={cn(
          'flex h-screen flex-col transition-all duration-200',
          collapsed ? 'md:pl-16' : 'md:pl-60',
        )}
      >
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Abrir menu"
          >
            <Menu size={22} />
          </button>
          <span className="text-base font-bold tracking-tight text-primary">lure.expert</span>
        </header>

        <main className="flex-1 overflow-y-auto min-h-0">{children}</main>
      </div>
    </div>
  )
}
