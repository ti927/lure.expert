'use client'

import { useState, useEffect, useRef } from 'react'
import {
  getOrCreateConversation,
  sendExpertMessage,
  startNewConversation,
} from '@/server/expert'
import type { ChatMessage } from '@/server/expert'
import { Send, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ExpertChat() {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [initializing, setInitializing] = useState(true)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    getOrCreateConversation().then(({ conversationId: id, history }) => {
      setConversationId(id)
      setMsgs(history)
      setInitializing(false)
    })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, sending])

  async function handleSend() {
    if (!input.trim() || !conversationId || sending) return
    const userContent = input.trim()
    setInput('')
    textareaRef.current?.focus()

    const optimistic: ChatMessage = {
      id:        crypto.randomUUID(),
      role:      'user',
      content:   userContent,
      createdAt: new Date().toISOString(),
    }
    setMsgs(prev => [...prev, optimistic])
    setSending(true)

    try {
      const reply = await sendExpertMessage(conversationId, userContent)
      setMsgs(prev => [
        ...prev,
        {
          id:        crypto.randomUUID(),
          role:      'assistant',
          content:   reply,
          createdAt: new Date().toISOString(),
        },
      ])
    } catch {
      setMsgs(prev => [
        ...prev,
        {
          id:        crypto.randomUUID(),
          role:      'assistant',
          content:   'Não foi possível processar a mensagem. Verifique sua conexão e tente novamente.',
          createdAt: new Date().toISOString(),
        },
      ])
    } finally {
      setSending(false)
    }
  }

  async function handleNewConversation() {
    if (sending) return
    setSending(true)
    try {
      const { conversationId: newId } = await startNewConversation()
      setConversationId(newId)
      setMsgs([])
    } finally {
      setSending(false)
    }
  }

  if (initializing) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground animate-pulse">expert está analisando...</p>
      </div>
    )
  }

  return (
    <>
      {msgs.length > 0 && (
        <div className="flex justify-end px-4 py-1.5 border-b border-border">
          <button
            onClick={handleNewConversation}
            disabled={sending}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <Plus size={13} />
            Nova conversa
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {msgs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12 text-center">
            <p className="text-sm font-medium text-foreground">Como posso ajudar?</p>
            <p className="text-xs text-muted-foreground max-w-[220px]">
              Pergunte sobre receitas, despesas, margem ou qualquer indicador do mês.
            </p>
          </div>
        )}

        {msgs.map(msg => (
          <div
            key={msg.id}
            className={cn(
              'max-w-[85%] rounded-lg px-3 py-2 text-sm',
              msg.role === 'user'
                ? 'ml-auto bg-primary text-primary-foreground'
                : 'mr-auto bg-muted text-foreground',
            )}
          >
            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
          </div>
        ))}

        {sending && (
          <div className="mr-auto bg-muted rounded-lg px-3 py-2 max-w-[85%]">
            <p className="text-xs text-muted-foreground animate-pulse">
              expert está analisando...
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[40px] max-h-[120px] disabled:opacity-50"
            placeholder="Pergunte sobre as finanças..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={1}
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="flex-shrink-0 h-9 w-9 flex items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            <Send size={15} />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-1.5">
          Enter para enviar · Shift+Enter para nova linha
        </p>
      </div>
    </>
  )
}
