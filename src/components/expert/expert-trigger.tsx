'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { MessageCircle, X, GripHorizontal } from 'lucide-react'
import { ExpertChat } from './expert-chat'

interface ExpertTriggerProps {
  collapsed: boolean
}

const LS_POS_KEY = 'lure:expert:pos'
const WINDOW_W = 384  // max-w-sm = 24rem = 384px
const WINDOW_H = 560  // altura estimada da janela
const MARGIN = 12     // margem mínima das bordas do viewport

function clampPos(x: number, y: number): { x: number; y: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    x: Math.max(MARGIN, Math.min(x, vw - WINDOW_W - MARGIN)),
    y: Math.max(MARGIN, Math.min(y, vh - WINDOW_H - MARGIN)),
  }
}

function loadPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(LS_POS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as { x: number; y: number }
  } catch { return null }
}

function savePos(pos: { x: number; y: number }) {
  try { localStorage.setItem(LS_POS_KEY, JSON.stringify(pos)) } catch { /* */ }
}

function defaultPos(): { x: number; y: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  return { x: vw - WINDOW_W - MARGIN, y: vh - WINDOW_H - MARGIN }
}

export function ExpertTrigger({ collapsed }: ExpertTriggerProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const posRef = useRef(pos)
  posRef.current = pos

  useEffect(() => {
    setMounted(true)
    const saved = loadPos()
    setPos(saved ? clampPos(saved.x, saved.y) : defaultPos())
  }, [])

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return
    const next = clampPos(e.clientX - dragOffset.current.x, e.clientY - dragOffset.current.y)
    setPos(next)
  }, [])

  const onMouseUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    savePos(posRef.current)
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }, [onMouseMove])

  function onDragStart(e: React.MouseEvent) {
    e.preventDefault()
    dragging.current = true
    dragOffset.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const window_ = (
    <div
      style={{ left: pos.x, top: pos.y, width: WINDOW_W, height: WINDOW_H }}
      className={cn(
        'fixed z-50 flex flex-col rounded-xl border border-border bg-background shadow-2xl transition-opacity duration-200',
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
      )}
      aria-label="Expert"
    >
      {/* Barra de título — arrastável */}
      <div
        onMouseDown={onDragStart}
        className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4 rounded-t-xl select-none cursor-grab active:cursor-grabbing bg-muted/40"
      >
        <div className="flex items-center gap-2">
          <GripHorizontal size={14} className="text-muted-foreground/60" />
          <span className="text-sm font-medium text-foreground">expert</span>
        </div>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setOpen(false)}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Fechar"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-col flex-1 min-h-0 rounded-b-xl overflow-hidden">
        <ExpertChat />
      </div>
    </div>
  )

  return (
    <>
      {/* Botão na sidebar */}
      <button
        onClick={() => setOpen(v => !v)}
        title={collapsed ? 'Expert' : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          collapsed && 'justify-center px-0',
          open
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <MessageCircle size={18} className="shrink-0" />
        {!collapsed && <span>Expert</span>}
      </button>

      {mounted && createPortal(window_, document.body)}
    </>
  )
}
