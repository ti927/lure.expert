'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Landmark, Plus, RefreshCw, Loader2, AlertCircle, GitCompare, Trash2, Check } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/states/empty-state'
import { generateConnectToken, registerPluggyItem, confirmPendingTransactions, disconnectBank } from '@/server/connections'
import type { DataSource } from '@/db/schema'
import type { PendingSource } from '@/server/connections'

// Widget Pluggy: carregado apenas no browser (usa iframe/zoid, incompatível com SSR)
const PluggyConnect = dynamic(
  () => import('react-pluggy-connect').then(m => m.PluggyConnect),
  { ssr: false },
)

interface ContasClientProps {
  connections: DataSource[]
  includeSandbox: boolean
  reconciliationCount: number
  pendingSources: PendingSource[]
}

export function ContasClient({ connections, includeSandbox, reconciliationCount, pendingSources }: ContasClientProps) {
  const router = useRouter()
  const [connectToken, setConnectToken] = useState<string | null>(null)
  const [isWidgetOpen, setIsWidgetOpen] = useState(false)
  const [updateItemId, setUpdateItemId] = useState<string | undefined>()
  const [isPending, startTransition] = useTransition()

  const totalPending = pendingSources.reduce((sum, s) => sum + s.count, 0)

  function handleConnect(itemId?: string) {
    setUpdateItemId(itemId)
    startTransition(async () => {
      try {
        const result = await generateConnectToken(itemId)
        setConnectToken(result.accessToken)
        setIsWidgetOpen(true)
      } catch {
        toast.error('Não foi possível iniciar a conexão. Verifique as configurações do Pluggy.')
      }
    })
  }

  function handleClose() {
    setIsWidgetOpen(false)
    setConnectToken(null)
    setUpdateItemId(undefined)
  }

  async function handleSuccess(data: { item: { id: string } }) {
    try {
      await registerPluggyItem(data.item.id)
      toast.success('Banco conectado com sucesso.')
      router.refresh()
    } catch {
      toast.error('Banco autenticado, mas não foi possível salvar a conexão. Tente novamente.')
    } finally {
      handleClose()
    }
  }

  function handleError(error: { message: string }) {
    toast.error(`Erro ao conectar: ${error.message}`)
    handleClose()
  }

  return (
    <>
      {/* Widget Pluggy (montado apenas com token ativo) */}
      {isWidgetOpen && connectToken && (
        <PluggyConnect
          connectToken={connectToken}
          includeSandbox={includeSandbox}
          updateItem={updateItemId}
          onSuccess={handleSuccess}
          onError={handleError}
          onClose={handleClose}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Contas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bancos e cartões conectados via Open Finance
          </p>
        </div>
        <Button onClick={() => handleConnect()} disabled={isPending}>
          {isPending && !updateItemId ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 mr-2" />
          )}
          Conectar banco
        </Button>
      </div>

      <Tabs defaultValue={totalPending > 0 ? 'pendente' : 'contas'}>
        <TabsList>
          <TabsTrigger value="contas">Contas</TabsTrigger>
          <TabsTrigger value="pendente">
            Extrato pendente
            {totalPending > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white tabular-nums">
                {totalPending}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Aba: Contas conectadas */}
        <TabsContent value="contas" className="mt-4 space-y-3">
          {/* Banner de reconciliação pendente */}
          {reconciliationCount > 0 && (
            <a
              href="/transacoes/reconciliacao"
              className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm hover:bg-amber-100 transition-colors"
            >
              <GitCompare className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="text-amber-800">
                O expert identificou{' '}
                <span className="font-semibold">{reconciliationCount} par{reconciliationCount !== 1 ? 'es' : ''}</span>{' '}
                de possíveis duplicatas entre importações e banco conectado.
              </span>
              <span className="ml-auto text-amber-600 font-medium whitespace-nowrap">Revisar →</span>
            </a>
          )}

          {connections.length === 0 ? (
            <EmptyState
              icon={<Landmark className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
              title="Nenhuma conta conectada"
              description="Conecte seu banco via Open Finance para sincronizar extratos automaticamente."
            />
          ) : (
            <div className="grid gap-3">
              {connections.map(conn => (
                <ConnectionCard
                  key={conn.id}
                  connection={conn}
                  onReauth={() => handleConnect(conn.externalItemId ?? undefined)}
                  isReauthing={isPending && updateItemId === conn.externalItemId}
                  onDisconnect={() => router.refresh()}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Aba: Extrato pendente */}
        <TabsContent value="pendente" className="mt-4">
          {totalPending === 0 ? (
            <EmptyState
              icon={<Check className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
              title="Nenhum extrato pendente"
              description="Todos os lançamentos sincronizados já foram confirmados."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {pendingSources.map(source => (
                <PendingSourceCard
                  key={source.dataSourceId}
                  source={source}
                  onConfirmed={() => router.refresh()}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}

// --- ConnectionCard ---

type ConnectionMeta = {
  institutionName?: string
  institutionImageUrl?: string
  executionStatus?: string
}

function ConnectionCard({
  connection,
  onReauth,
  isReauthing,
  onDisconnect,
}: {
  connection: DataSource
  onReauth: () => void
  isReauthing: boolean
  onDisconnect: () => void
}) {
  const [isDisconnecting, startDisconnect] = useTransition()
  const meta = (connection.metadata ?? {}) as ConnectionMeta
  const isError = connection.status === 'error'
  const syncedAt = connection.lastSyncAt
    ? format(new Date(connection.lastSyncAt), "dd/MM/yy 'às' HH:mm", { locale: ptBR })
    : null

  function handleDisconnect() {
    startDisconnect(async () => {
      const result = await disconnectBank(connection.id)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Banco desconectado. Os lançamentos já confirmados foram mantidos.')
        onDisconnect()
      }
    })
  }

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        {meta.institutionImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meta.institutionImageUrl}
            alt={meta.institutionName ?? ''}
            className="h-8 w-8 rounded object-contain"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
            <Landmark className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          </div>
        )}
        <div>
          <p className="text-sm font-medium">{meta.institutionName ?? connection.name}</p>
          <p className="text-xs text-muted-foreground">
            {syncedAt ? `Sincronizado ${syncedAt}` : 'Nunca sincronizado'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isError && (
          <Badge variant="destructive">
            <AlertCircle className="mr-1 h-3 w-3" />
            Atenção
          </Badge>
        )}
        {isError && (
          <Button size="sm" variant="outline" onClick={onReauth} disabled={isReauthing}>
            {isReauthing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                Reautenticar
              </>
            )}
          </Button>
        )}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={isDisconnecting}>
              {isDisconnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Desconectar banco?</AlertDialogTitle>
              <AlertDialogDescription>
                A conexão com <strong>{meta.institutionName ?? connection.name}</strong> será removida.
                Os lançamentos já confirmados serão mantidos em Transações.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDisconnect} className="bg-destructive hover:bg-destructive/90">
                Desconectar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

// --- PendingSourceCard ---

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

function formatBRL(amount: string) {
  return Number(amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function PendingSourceCard({
  source,
  onConfirmed,
}: {
  source: PendingSource
  onConfirmed: () => void
}) {
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    startTransition(async () => {
      const result = await confirmPendingTransactions(source.dataSourceId)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success(`${result.confirmed} lançamentos confirmados e disponíveis em Transações.`)
        onConfirmed()
      }
    })
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <p className="text-sm font-medium">{source.dataSourceName}</p>
          <p className="text-xs text-muted-foreground">{source.count} lançamentos aguardando confirmação</p>
        </div>
        <Button size="sm" onClick={handleConfirm} disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Confirmar {source.count} lançamentos
            </>
          )}
        </Button>
      </div>

      <div className="divide-y">
        {source.transactions.slice(0, 50).map(tx => {
          const isInflow = tx.direction === 'inflow'
          return (
            <div key={tx.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatDate(tx.date)}</span>
                <span className="text-foreground truncate">{tx.description}</span>
              </div>
              <span className={`ml-4 tabular-nums font-medium shrink-0 ${isInflow ? 'text-emerald-700' : 'text-foreground'}`}>
                {isInflow ? '+' : ''}{formatBRL(tx.amount)}
              </span>
            </div>
          )
        })}
        {source.count > 50 && (
          <p className="px-4 py-2 text-xs text-muted-foreground">
            … e mais {source.count - 50} lançamentos
          </p>
        )}
      </div>
    </div>
  )
}
