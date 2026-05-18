'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Landmark, Plus, RefreshCw, Loader2, AlertCircle, GitCompare } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/states/empty-state'
import { generateConnectToken, registerPluggyItem } from '@/server/connections'
import type { DataSource } from '@/db/schema'

// Widget Pluggy: carregado apenas no browser (usa iframe/zoid, incompatível com SSR)
const PluggyConnect = dynamic(
  () => import('react-pluggy-connect').then(m => m.PluggyConnect),
  { ssr: false },
)

interface ContasClientProps {
  connections: DataSource[]
  includeSandbox: boolean
  reconciliationCount: number
}

export function ContasClient({ connections, includeSandbox, reconciliationCount }: ContasClientProps) {
  const router = useRouter()
  const [connectToken, setConnectToken] = useState<string | null>(null)
  const [isWidgetOpen, setIsWidgetOpen] = useState(false)
  const [updateItemId, setUpdateItemId] = useState<string | undefined>()
  const [isPending, startTransition] = useTransition()

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

      {/* Lista */}
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
            />
          ))}
        </div>
      )}
    </>
  )
}

type ConnectionMeta = {
  institutionName?: string
  institutionImageUrl?: string
  executionStatus?: string
}

function ConnectionCard({
  connection,
  onReauth,
  isReauthing,
}: {
  connection: DataSource
  onReauth: () => void
  isReauthing: boolean
}) {
  const meta = (connection.metadata ?? {}) as ConnectionMeta
  const isError = connection.status === 'error'
  const syncedAt = connection.lastSyncAt
    ? format(new Date(connection.lastSyncAt), "dd/MM/yy 'às' HH:mm", { locale: ptBR })
    : null

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
      </div>
    </div>
  )
}
