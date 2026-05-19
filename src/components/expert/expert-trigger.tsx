'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { MessageCircle, X } from 'lucide-react'
import { LoadingState } from '@/components/states/loading-state'

interface ExpertTriggerProps {
  collapsed: boolean
}

export function ExpertTrigger({ collapsed }: ExpertTriggerProps) {
  const [open, setOpen] = useState(false)

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

      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Painel do expert */}
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
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <LoadingState variant="thinking" />
          <p className="text-xs text-muted-foreground">
            Chat com o expert disponível na Fase 5.
          </p>
        </div>
      </div>
    </>
  )
}
