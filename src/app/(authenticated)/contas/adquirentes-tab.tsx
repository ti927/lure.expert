'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CreditCard, Plus, RotateCcw, Loader2, Trash2, Pencil, RefreshCw, AlertCircle,
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
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
import {
  createAcquirerConnection,
  updateAcquirerConnection,
  deleteAcquirerConnection,
  triggerAcquirerSync,
  type AcquirerConnectionWithEntity,
} from '@/server/acquirer-connections'
import { ACQUIRER_PROVIDERS, type AcquirerProviderKey } from '@/lib/acquirer-types'

const PROVIDER_COLORS: Record<string, string> = {
  stone: 'bg-emerald-100 text-emerald-700',
  cielo: 'bg-blue-100 text-blue-700',
  rede: 'bg-red-100 text-red-700',
  pagbank: 'bg-yellow-100 text-yellow-700',
  abstract: 'bg-slate-100 text-slate-600',
}

// ─────────────────────────────────────────
// Tab principal
// ─────────────────────────────────────────

interface AdquirentesTabProps {
  connections: AcquirerConnectionWithEntity[]
}

export function AdquirentesTab({ connections }: AdquirentesTabProps) {
  const router = useRouter()
  const [addOpen, setAddOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleRefresh() {
    startTransition(() => { router.refresh() })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isPending}>
            {isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RefreshCw className="h-4 w-4" />
            }
            <span className="ml-1.5">Atualizar</span>
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Adicionar adquirente
          </Button>
        </div>
      </div>

      {connections.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Nenhum adquirente conectado"
          description="Conecte Stone, Cielo, Rede ou PagBank para importar vendas em cartão detalhadas."
          action={{ label: 'Adicionar adquirente', onClick: () => setAddOpen(true) }}
        />
      ) : (
        <div className="grid gap-3">
          {connections.map(conn => (
            <AcquirerCard
              key={conn.id}
              connection={conn}
              onUpdated={() => router.refresh()}
            />
          ))}
        </div>
      )}

      <AddAcquirerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => { setAddOpen(false); router.refresh() }}
      />
    </div>
  )
}

// ─────────────────────────────────────────
// Card de conexão de adquirente
// ─────────────────────────────────────────

function AcquirerCard({
  connection,
  onUpdated,
}: {
  connection: AcquirerConnectionWithEntity
  onUpdated: () => void
}) {
  const [isSyncing, setIsSyncing] = useState(false)
  const [isDeleting, startDelete] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncFromDate, setSyncFromDate] = useState(() => {
    const meta = (connection.metadata ?? {}) as { lastFetchedAt?: string }
    if (meta.lastFetchedAt) return new Date(meta.lastFetchedAt).toISOString().split('T')[0]
    const d = new Date()
    d.setDate(d.getDate() - 90)
    return d.toISOString().split('T')[0]
  })

  const providerLabel = ACQUIRER_PROVIDERS.find(p => p.value === connection.provider)?.label ?? connection.provider
  const displayName = connection.displayName?.trim() || `${providerLabel} • ${connection.merchantId}`
  const syncedAt = connection.lastSyncAt
    ? format(new Date(connection.lastSyncAt), "dd/MM/yy 'às' HH:mm", { locale: ptBR })
    : null
  const isError = connection.status === 'error'
  const meta = (connection.metadata ?? {}) as { awaitingFirstSync?: boolean }

  async function handleSync() {
    setSyncOpen(false)
    setIsSyncing(true)
    const result = await triggerAcquirerSync(connection.id, syncFromDate)
    if ('error' in result) {
      toast.error(result.error)
    } else {
      toast.success('Sincronização iniciada. Vendas aparecerão em /transacoes em instantes.')
    }
    setIsSyncing(false)
  }

  function handleDelete() {
    startDelete(async () => {
      const result = await deleteAcquirerConnection(connection.id)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Conexão removida.')
        onUpdated()
      }
    })
  }

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded font-bold text-xs ${PROVIDER_COLORS[connection.provider] ?? 'bg-slate-100 text-slate-600'}`}>
          {providerLabel.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{displayName}</p>
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${PROVIDER_COLORS[connection.provider] ?? 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
              {providerLabel}
            </span>
            {connection.environment === 'sandbox' && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset bg-amber-100 text-amber-700 ring-amber-200">
                sandbox
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {isSyncing ? (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Sincronizando...
              </span>
            ) : meta.awaitingFirstSync ? (
              <span className="text-amber-700">Pronto. Clique em sincronizar para escolher a data inicial.</span>
            ) : syncedAt ? (
              `Sincronizado ${syncedAt}`
            ) : (
              'Aguardando sincronização'
            )}
          </p>
          {connection.legalEntityName && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">{connection.legalEntityName}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isError && (
          <Badge variant="destructive">
            <AlertCircle className="mr-1 h-3 w-3" />
            Erro
          </Badge>
        )}

        {/* Sync */}
        <AlertDialog open={syncOpen} onOpenChange={setSyncOpen}>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={isSyncing} title="Sincronizar">
              {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sincronizar {displayName}</AlertDialogTitle>
              <AlertDialogDescription>
                Buscar vendas a partir de qual data?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-2">
              <Input
                type="date"
                value={syncFromDate}
                onChange={e => setSyncFromDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="h-9 text-sm"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleSync}>Sincronizar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Editar */}
        <Button size="sm" variant="ghost" className="text-muted-foreground" title="Editar" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4" />
        </Button>

        {/* Remover */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" title="Remover" disabled={isDeleting}>
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover conexão</AlertDialogTitle>
              <AlertDialogDescription>
                A conexão com {displayName} será removida. Os lançamentos já importados serão mantidos.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Remover
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <EditAcquirerDialog
        connection={connection}
        open={editOpen}
        onOpenChange={setEditOpen}
        onUpdated={() => { setEditOpen(false); onUpdated() }}
      />
    </div>
  )
}

// ─────────────────────────────────────────
// Dialog: Adicionar adquirente
// ─────────────────────────────────────────

function AddAcquirerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
}) {
  const [isSaving, startSave] = useTransition()
  const [provider, setProvider] = useState<AcquirerProviderKey>('stone')
  const [merchantId, setMerchantId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [environment, setEnvironment] = useState<'producao' | 'sandbox'>('producao')

  function handleClose() {
    if (isSaving) return
    setProvider('stone')
    setMerchantId('')
    setDisplayName('')
    setApiKey('')
    setApiSecret('')
    setEnvironment('producao')
    onOpenChange(false)
  }

  function handleSubmit() {
    if (!merchantId.trim()) {
      toast.error('Informe o Merchant ID.')
      return
    }
    startSave(async () => {
      const result = await createAcquirerConnection({
        provider,
        merchantId: merchantId.trim(),
        displayName: displayName.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        apiSecret: apiSecret.trim() || undefined,
        environment,
      })
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Adquirente conectado. Clique em sincronizar para escolher a data inicial.')
        onCreated()
      }
    })
  }

  const needsSecret = provider === 'cielo'

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar adquirente</DialogTitle>
          <DialogDescription>
            Conecte um adquirente para importar vendas em cartão detalhadas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Provedor</Label>
            <Select value={provider} onValueChange={v => setProvider(v as AcquirerProviderKey)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACQUIRER_PROVIDERS.map(p => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>
              {provider === 'stone' ? 'Stone Code' : provider === 'cielo' ? 'Merchant ID' : 'Código do estabelecimento'}
            </Label>
            <Input
              placeholder="Ex: 12345678"
              value={merchantId}
              onChange={e => setMerchantId(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Nome amigável <span className="text-muted-foreground">(opcional)</span></Label>
            <Input
              placeholder={`Ex: ${ACQUIRER_PROVIDERS.find(p => p.value === provider)?.label} Loja Centro`}
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              {provider === 'stone' ? 'Access Token' : 'API Key'}
              {' '}<span className="text-muted-foreground">(opcional agora)</span>
            </Label>
            <Input
              type="password"
              placeholder="Cole a chave de API"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              className="h-9"
            />
          </div>

          {needsSecret && (
            <div className="space-y-1.5">
              <Label>Merchant Key <span className="text-muted-foreground">(opcional agora)</span></Label>
              <Input
                type="password"
                placeholder="Cole a merchant key"
                value={apiSecret}
                onChange={e => setApiSecret(e.target.value)}
                className="h-9"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Ambiente</Label>
            <Select value={environment} onValueChange={v => setEnvironment(v as 'producao' | 'sandbox')}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="producao">Produção</SelectItem>
                <SelectItem value="sandbox">Sandbox (testes)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={isSaving || !merchantId.trim()}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────
// Dialog: Editar adquirente
// ─────────────────────────────────────────

function EditAcquirerDialog({
  connection,
  open,
  onOpenChange,
  onUpdated,
}: {
  connection: AcquirerConnectionWithEntity
  open: boolean
  onOpenChange: (v: boolean) => void
  onUpdated: () => void
}) {
  const [isSaving, startSave] = useTransition()
  const [displayName, setDisplayName] = useState(connection.displayName ?? '')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [environment, setEnvironment] = useState<'producao' | 'sandbox'>(
    (connection.environment ?? 'producao') as 'producao' | 'sandbox'
  )
  const [mdrRate, setMdrRate] = useState(
    connection.mdrRate ? String(parseFloat(String(connection.mdrRate)) * 100) : ''
  )

  const providerLabel = ACQUIRER_PROVIDERS.find(p => p.value === connection.provider)?.label ?? connection.provider
  const needsSecret = connection.provider === 'cielo'

  function handleSubmit() {
    startSave(async () => {
      const parsedMdr = mdrRate ? parseFloat(mdrRate.replace(',', '.')) / 100 : undefined
      const result = await updateAcquirerConnection(connection.id, {
        displayName: displayName.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        apiSecret: apiSecret.trim() || undefined,
        environment,
        mdrRate: parsedMdr ?? null,
      })
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Conexão atualizada.')
        onUpdated()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar {providerLabel} • {connection.merchantId}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Nome amigável</Label>
            <Input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              {connection.provider === 'stone' ? 'Access Token' : 'API Key'}
              {' '}<span className="text-muted-foreground">(deixe em branco para manter)</span>
            </Label>
            <Input
              type="password"
              placeholder="Nova chave de API"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              className="h-9"
            />
          </div>

          {needsSecret && (
            <div className="space-y-1.5">
              <Label>Merchant Key <span className="text-muted-foreground">(deixe em branco para manter)</span></Label>
              <Input
                type="password"
                placeholder="Nova merchant key"
                value={apiSecret}
                onChange={e => setApiSecret(e.target.value)}
                className="h-9"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>MDR médio (%) <span className="text-muted-foreground">(opcional — usado na reconciliação)</span></Label>
            <Input
              type="number"
              min="0"
              max="10"
              step="0.01"
              placeholder="Ex: 1.99"
              value={mdrRate}
              onChange={e => setMdrRate(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Ambiente</Label>
            <Select value={environment} onValueChange={v => setEnvironment(v as 'producao' | 'sandbox')}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="producao">Produção</SelectItem>
                <SelectItem value="sandbox">Sandbox (testes)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
