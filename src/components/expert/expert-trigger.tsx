'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { MessageCircle, X } from 'lucide-react'
import { ExpertChat } from './expert-chat'

interface ExpertTriggerProps {
  collapsed: boolean
}

export function ExpertTrigger({ collapsed }: ExpertTriggerProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const drawer = (
    <>
      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Painel do expert — renderizado via portal fora da sidebar para evitar
          conflito com o transform CSS da sidebar (fixed dentro de transform
          fica relativo ao ancestral, não ao viewport) */}
      <div
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-border bg-background shadow-xl transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        aria-label="Expert"
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <span className="text-sm font-medium text-foreground">expert</span>
          <button
            onClick={() => setOpen(false)}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        <ExpertChat />
      </div>
    </>
  )

  return (
    <>
      {/* Botão na sidebar */}
      <button
        onClick={() => setOpen(true)}
        title={collapsed ? 'Expert' : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          collapsed && 'justify-center px-0',
          'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <MessageCircle size={18} className="shrink-0" />
        {!collapsed && <span>Expert</span>}
      </button>

      {mounted && createPortal(drawer, document.body)}
    </>
  )
}
