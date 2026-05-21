'use client'

import { useState, useTransition, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import {
  Landmark, Plus, RefreshCw, Loader2, AlertCircle, GitCompare,
  Trash2, Check, RotateCcw, ChevronLeft, ChevronRight, Pencil,
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/states/empty-state'
import {
  generateConnectToken,
  registerPluggyItem,
  confirmPendingTransactions,
  confirmSelectedTransactions,
  disconnectBank,
  triggerManualSync,
  updateConnectionCustomization,
  setConnectionLogoPath,
  removeConnectionLogo,
} from '@/server/connections'
import { deleteTransactions } from '@/server/transactions'
import { createClient } from '@/lib/supabase/client'
import type { PendingSource, OrgConnection } from '@/server/connections'

const PluggyConnect = dynamic(
  () => import('react-pluggy-connect').then(m => m.PluggyConnect),
  { ssr: false },
)

const PAGE_SIZE = 500

interface ContasClientProps {
  connections: OrgConnection[]
  includeSandbox: boolean
  reconciliationCount: number
  pendingSources: PendingSource[]
  orgId: string
}

export function ContasClient({ connections, includeSandbox, reconciliationCount, pendingSources, orgId }: ContasClientProps) {
  const router = useRouter()
  const [connectToken, setConnectToken] = useState<string | null>(null)
  const [isWidgetOpen, setIsWidgetOpen] = useState(false)
  const [updateItemId, setUpdateItemId] = useState<string | undefined>()
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const totalPending = pendingSources.reduce((sum, s) => sum + s.count, 0)

  function handleRefresh() {
    startTransition(() => { router.refresh() })
  }

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
      const result = await registerPluggyItem(data.item.id)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Conta conectada. Clique no ícone de sincronizar para escolher a data inicial dos extratos.')
        router.refresh()
      }
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

  async function handleSync(dataSourceId: string, fromDate?: string) {
    setSyncingId(dataSourceId)
    const result = await triggerManualSync(dataSourceId, fromDate)
    if ('error' in result) {
      toast.error(result.error)
    } else {
      toast.success('Sincronização iniciada. Novos extratos aparecerão em Extrato pendente em instantes.')
      setTimeout(() => { router.refresh() }, 3000)
    }
    setSyncingId(null)
  }

  return (
    <>
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
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isPending}>
            {isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RefreshCw className="h-4 w-4" />
            }
            <span className="ml-1.5">Atualizar</span>
          </Button>
          <Button onClick={() => handleConnect()} disabled={isPending}>
            {isPending && !updateItemId
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <Plus className="h-4 w-4 mr-2" />
            }
            Conectar banco
          </Button>
        </div>
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
                  orgId={orgId}
                  onReauth={() => handleConnect(conn.externalItemId ?? undefined)}
                  isReauthing={isPending && updateItemId === conn.externalItemId}
                  isSyncing={syncingId === conn.id}
                  onSync={(fromDate) => handleSync(conn.id, fromDate)}
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
              title="Extratos em dia"
              description="Nenhum lançamento aguardando confirmação."
            />
          ) : (
            <PendingExtractTab sources={pendingSources} />
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}

// --- ConnectionCard ---

const SUBTYPE_LABEL: Record<string, string> = {
  CHECKING_ACCOUNT: 'C. Corrente',
  SAVINGS_ACCOUNT: 'Poupança',
  CREDIT_CARD: 'Cartão',
}

type ConnectionMeta = {
  institutionName?: string
  institutionImageUrl?: string
  isSandbox?: boolean
  executionStatus?: string
  lastTransactionFetchedAt?: string
  accounts?: { id: string; name: string; marketingName: string | null; type: string; subtype: string; number: string }[]
  customLabel?: string
  customBadge?: { text: string }
  customLogoPath?: string
  awaitingFirstSync?: boolean
}

function ConnectionCard({
  connection,
  orgId,
  onReauth,
  isReauthing,
  isSyncing,
  onSync,
  onDisconnect,
}: {
  connection: OrgConnection
  orgId: string
  onReauth: () => void
  isReauthing: boolean
  isSyncing: boolean
  onSync: (fromDate?: string) => void
  onDisconnect: () => void
}) {
  const [isDisconnecting, startDisconnect] = useTransition()
  const [syncOpen, setSyncOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const meta = (connection.metadata ?? {}) as ConnectionMeta
  const [syncFromDate, setSyncFromDate] = useState(() => {
    if (meta.lastTransactionFetchedAt) {
      return new Date(meta.lastTransactionFetchedAt).toISOString().split('T')[0]
    }
    const d = new Date()
    d.setDate(d.getDate() - 90)
    return d.toISOString().split('T')[0]
  })
  const isError = connection.status === 'error'
  const syncedAt = connection.lastSyncAt
    ? format(new Date(connection.lastSyncAt), "dd/MM/yy 'às' HH:mm", { locale: ptBR })
    : null
  const firstAcc = meta.accounts?.[0]
  const bankName =
    firstAcc?.marketingName?.trim()
    || firstAcc?.name?.trim()
    || meta.institutionName
    || connection.name
  const displayLabel = meta.customLabel?.trim() || bankName
  const displayBadge: { text: string; tone: 'sandbox' | 'custom' } | null =
    meta.customBadge?.text
      ? { text: meta.customBadge.text, tone: 'custom' }
      : meta.isSandbox ? { text: 'sandbox', tone: 'sandbox' } : null
  const accountSummary = (meta.accounts ?? [])
    .map(a => {
      const label = SUBTYPE_LABEL[a.subtype] ?? a.name
      return a.number ? `${label} • ${a.number}` : label
    })
    .filter(Boolean)
    .join(' · ')

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
        {(connection.customLogoUrl || meta.institutionImageUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={connection.customLogoUrl ?? meta.institutionImageUrl ?? ''}
            alt={displayLabel}
            className="h-8 w-8 rounded object-contain"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
            <Landmark className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{displayLabel}</p>
            {displayBadge && (
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                displayBadge.tone === 'custom'
                  ? 'bg-slate-100 text-slate-700 ring-slate-200'
                  : 'bg-amber-100 text-amber-700 ring-amber-200'
              }`}>
                {displayBadge.text}
              </span>
            )}
          </div>
          <p className="text-xs flex items-center gap-1">
            {isSyncing ? (
              <span className="text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Sincronizando...
              </span>
            ) : meta.awaitingFirstSync ? (
              <span className="text-amber-700">
                Pronto. Clique em sincronizar para escolher a data inicial.
              </span>
            ) : syncedAt ? (
              <span className="text-muted-foreground">Sincronizado {syncedAt}</span>
            ) : (
              <span className="text-muted-foreground">Aguardando sincronização</span>
            )}
          </p>
          {accountSummary && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">{accountSummary}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isError && (
          <Badge variant="destructive">
            <AlertCircle className="mr-1 h-3 w-3" />
            Atenção
          </Badge>
        )}

        {isError ? (
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
        ) : (
          <AlertDialog open={syncOpen} onOpenChange={setSyncOpen}>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                disabled={isSyncing}
                title="Sincronizar agora"
              >
                {isSyncing
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RotateCcw className="h-4 w-4" />
                }
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sincronizar {displayLabel}</AlertDialogTitle>
                <AlertDialogDescription>
                  Buscar transações a partir de qual data? Transações anteriores a essa data não serão importadas.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="py-2 space-y-1.5">
                <Input
                  type="date"
                  value={syncFromDate}
                  onChange={e => setSyncFromDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="h-9 text-sm"
                />
                {meta.lastTransactionFetchedAt && (
                  <p className="text-xs text-muted-foreground">
                    Último corte utilizado: {format(new Date(meta.lastTransactionFetchedAt), 'dd/MM/yyyy', { locale: ptBR })}
                  </p>
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => onSync(syncFromDate)}>
                  Sincronizar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setEditOpen(true)}
          title="Editar nome e badge"
        >
          <Pencil className="h-4 w-4" />
        </Button>

        <EditConnectionDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          dataSourceId={connection.id}
          orgId={orgId}
          initialLabel={meta.customLabel ?? ''}
          initialBadge={meta.customBadge?.text ?? ''}
          autoLabel={bankName}
          autoBadge={meta.isSandbox ? 'sandbox' : null}
          currentLogoUrl={connection.customLogoUrl ?? meta.institutionImageUrl ?? null}
          hasCustomLogo={!!meta.customLogoPath}
        />

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              disabled={isDisconnecting}
              title="Desconectar banco"
            >
              {isDisconnecting
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Trash2 className="h-4 w-4" />
              }
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Desconectar banco?</AlertDialogTitle>
              <AlertDialogDescription>
                A conexão com <strong>{displayLabel}</strong> será removida.
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

// --- EditConnectionDialog ---

const LOGO_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const LOGO_MAX_BYTES = 500 * 1024 // 500 KB

function EditConnectionDialog({
  open,
  onOpenChange,
  dataSourceId,
  orgId,
  initialLabel,
  initialBadge,
  autoLabel,
  autoBadge,
  currentLogoUrl,
  hasCustomLogo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dataSourceId: string
  orgId: string
  initialLabel: string
  initialBadge: string
  autoLabel: string
  autoBadge: string | null
  currentLogoUrl: string | null
  hasCustomLogo: boolean
}) {
  const router = useRouter()
  const [label, setLabel] = useState(initialLabel)
  const [badge, setBadge] = useState(initialBadge)
  const [isPending, startTransition] = useTransition()
  const [isUploadingLogo, setIsUploadingLogo] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reinicializa o estado quando o dialog abre
  function handleOpenChange(next: boolean) {
    if (next) {
      setLabel(initialLabel)
      setBadge(initialBadge)
    }
    onOpenChange(next)
  }

  function persist(nextLabel: string | null, nextBadge: string | null, successMsg: string) {
    startTransition(async () => {
      const result = await updateConnectionCustomization(dataSourceId, {
        customLabel: nextLabel,
        customBadge: nextBadge,
      })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success(successMsg)
      onOpenChange(false)
      router.refresh()
    })
  }

  function handleSave() {
    persist(label, badge, 'Conexão atualizada.')
  }

  function handleReset() {
    setLabel('')
    setBadge('')
    persist(null, null, 'Padrão restaurado.')
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!LOGO_ACCEPTED_TYPES.includes(file.type)) {
      toast.error('Use PNG, JPG ou WebP.')
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error('Imagem muito grande. Limite: 500 KB.')
      return
    }

    setIsUploadingLogo(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
      const uuid = crypto.randomUUID()
      const storagePath = `${orgId}/connection-logos/${dataSourceId}-${uuid}.${ext}`

      const { error: storageError } = await supabase.storage
        .from('documents')
        .upload(storagePath, file, { contentType: file.type, upsert: false })

      if (storageError) {
        toast.error(`Erro ao enviar imagem: ${storageError.message}`)
        return
      }

      const result = await setConnectionLogoPath(dataSourceId, storagePath)
      if ('error' in result) {
        // Limpa o arquivo se a server action falhou
        await supabase.storage.from('documents').remove([storagePath])
        toast.error(result.error)
        return
      }

      toast.success('Logo atualizado.')
      router.refresh()
    } finally {
      setIsUploadingLogo(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleRemoveLogo() {
    startTransition(async () => {
      const result = await removeConnectionLogo(dataSourceId)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success('Logo removido.')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar conexão</DialogTitle>
          <DialogDescription>
            Apelido, badge e logo para identificar essa conexão. Não são sobrescritos pelas próximas sincronizações.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Logo</Label>
            <div className="flex items-center gap-3">
              {currentLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentLogoUrl}
                  alt="Logo atual"
                  className="h-12 w-12 rounded border bg-muted object-contain"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded border bg-muted">
                  <Landmark className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={LOGO_ACCEPTED_TYPES.join(',')}
                  className="hidden"
                  onChange={handleLogoUpload}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingLogo || isPending}
                >
                  {isUploadingLogo ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                  Carregar imagem
                </Button>
                {hasCustomLogo && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleRemoveLogo}
                    disabled={isUploadingLogo || isPending}
                    className="text-muted-foreground"
                  >
                    Remover
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPG ou WebP — até 500 KB.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custom-label">Nome do banco</Label>
            <Input
              id="custom-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={autoLabel}
              maxLength={80}
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">
              Em branco volta ao padrão automático: <span className="font-medium">{autoLabel}</span>
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custom-badge">Badge (opcional)</Label>
            <Input
              id="custom-badge"
              value={badge}
              onChange={e => setBadge(e.target.value)}
              placeholder="ex: Pessoal, Empresa, Teste"
              maxLength={20}
              className="h-9"
            />
            {autoBadge && !badge.trim() && (
              <p className="text-xs text-muted-foreground">
                Em branco volta ao padrão automático: <span className="font-medium">{autoBadge}</span>
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isPending || isUploadingLogo || (!initialLabel && !initialBadge)}
            className="text-muted-foreground"
          >
            Restaurar nome e badge
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending || isUploadingLogo}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isPending || isUploadingLogo}>
              {isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- PendingExtractTab ---

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

function formatBRL(amount: string) {
  return Number(amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function PendingExtractTab({
  sources,
}: {
  sources: PendingSource[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [dirFilter, setDirFilter] = useState<'all' | 'inflow' | 'outflow'>('all')
  const [bankFilter, setBankFilter] = useState<string>('all')
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)

  // Aplana todas as transações de todas as fontes
  const allTransactions = useMemo(() => {
    return sources.flatMap(s => s.transactions)
  }, [sources])

  // Contas únicas filtradas pelo banco selecionado (para o select de conta)
  const allAccounts = useMemo(() => {
    const seen = new Map<string, string>()
    const txsForFilter = bankFilter !== 'all'
      ? allTransactions.filter(tx => tx.dataSourceId === bankFilter)
      : allTransactions
    for (const tx of txsForFilter) {
      const key = `${tx.accountSubtype ?? ''}::${tx.accountNumber ?? ''}`
      if (seen.has(key)) continue
      const typeLabel = tx.accountSubtype ? (SUBTYPE_LABEL[tx.accountSubtype] ?? tx.accountName ?? '') : (tx.accountName ?? '')
      const label = tx.accountNumber ? `${typeLabel} • ${tx.accountNumber}` : typeLabel
      if (label) seen.set(key, label)
    }
    return Array.from(seen.entries()).map(([key, label]) => ({ key, label }))
  }, [allTransactions, bankFilter])

  // Filtros client-side
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return allTransactions.filter(tx => {
      if (q && !tx.description.toLowerCase().includes(q)) return false
      if (dirFilter !== 'all' && tx.direction !== dirFilter) return false
      if (bankFilter !== 'all' && tx.dataSourceId !== bankFilter) return false
      if (accountFilter !== 'all') {
        const key = `${tx.accountSubtype ?? ''}::${tx.accountNumber ?? ''}`
        if (key !== accountFilter) return false
      }
      if (dateFrom && tx.date < dateFrom) return false
      if (dateTo && tx.date > dateTo) return false
      return true
    })
  }, [allTransactions, search, dirFilter, bankFilter, accountFilter, dateFrom, dateTo])

  // Paginação
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const pageIds = pageRows.map(tx => tx.id)

  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id))
  const somePageSelected = pageIds.some(id => selectedIds.has(id))

  function togglePageSelect() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allPageSelected) {
        pageIds.forEach(id => next.delete(id))
      } else {
        pageIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  function toggleRow(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleConfirmSelected() {
    const ids = Array.from(selectedIds)
    startTransition(async () => {
      const result = await confirmSelectedTransactions(ids)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success(`${result.confirmed} lançamentos confirmados e disponíveis em Transações.`)
        setSelectedIds(new Set())
        router.refresh()
      }
    })
  }

  function handleDeleteSelected() {
    const ids = Array.from(selectedIds)
    startTransition(async () => {
      const result = await deleteTransactions(ids)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success(`${result.deleted} lançamento${result.deleted !== 1 ? 's' : ''} apagado${result.deleted !== 1 ? 's' : ''}.`)
        setSelectedIds(new Set())
        router.refresh()
      }
    })
  }

  function handleConfirmAll() {
    startTransition(async () => {
      let total = 0
      for (const source of sources) {
        const result = await confirmPendingTransactions(source.dataSourceId)
        if ('confirmed' in result) total += result.confirmed
      }
      toast.success(`${total} lançamentos confirmados e disponíveis em Transações.`)
      setSelectedIds(new Set())
      router.refresh()
    })
  }

  const selectedCount = selectedIds.size
  const multiplebanks = sources.length > 1
  // Mostra coluna "Conta" se alguma transação tem accountSubtype
  const hasAccountInfo = allTransactions.some(tx => tx.accountSubtype)

  return (
    <div className="flex flex-col gap-3">
      {/* FilterBar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar descrição..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="h-8 w-48 text-sm"
        />
        <Select value={dirFilter} onValueChange={v => { setDirFilter(v as typeof dirFilter); setPage(1) }}>
          <SelectTrigger className="h-8 w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as direções</SelectItem>
            <SelectItem value="inflow">Entrada</SelectItem>
            <SelectItem value="outflow">Saída</SelectItem>
          </SelectContent>
        </Select>
        {multiplebanks && (
          <Select value={bankFilter} onValueChange={v => { setBankFilter(v); setAccountFilter('all'); setPage(1) }}>
            <SelectTrigger className="h-8 w-44 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os bancos</SelectItem>
              {sources.map(s => {
                const acctLabels = Array.from(new Set(
                  s.transactions
                    .map(t => t.accountSubtype ? (SUBTYPE_LABEL[t.accountSubtype] ?? null) : null)
                    .filter((x): x is string => x !== null)
                ))
                const suffix = acctLabels.length > 0 ? ` · ${acctLabels.join(', ')}` : ''
                return (
                  <SelectItem key={s.dataSourceId} value={s.dataSourceId}>
                    {s.dataSourceName}{suffix}{!s.dataSourceActive ? ' (desconectado)' : ''}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        )}
        {allAccounts.length > 1 && (
          <Select value={accountFilter} onValueChange={v => { setAccountFilter(v); setPage(1) }}>
            <SelectTrigger className="h-8 w-44 text-sm">
              <SelectValue placeholder="Todas as contas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as contas</SelectItem>
              {allAccounts.map(a => (
                <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          type="date"
          value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setPage(1) }}
          className="h-8 w-36 text-sm"
          title="Data inicial"
        />
        <span className="text-xs text-muted-foreground">até</span>
        <Input
          type="date"
          value={dateTo}
          onChange={e => { setDateTo(e.target.value); setPage(1) }}
          className="h-8 w-36 text-sm"
          title="Data final"
        />
        {selectedCount > 0 ? (
          <>
            <Button size="sm" variant="outline" onClick={handleConfirmSelected} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
              Confirmar {selectedCount} selecionado{selectedCount !== 1 ? 's' : ''}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={isPending} className="text-destructive hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Apagar {selectedCount} selecionado{selectedCount !== 1 ? 's' : ''}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Apagar {selectedCount} lançamento{selectedCount !== 1 ? 's' : ''}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Os lançamentos selecionados serão removidos permanentemente do extrato pendente.
                    Eles podem voltar em uma sincronização futura caso ainda estejam na janela de busca do banco.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteSelected} className="bg-destructive hover:bg-destructive/90">
                    Apagar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <Button size="sm" onClick={handleConfirmAll} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
            Confirmar todos ({filtered.length})
          </Button>
        )}
      </div>

      {/* Paginação superior */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Exibindo {Math.min((currentPage - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} de {filtered.length} lançamento{filtered.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={currentPage <= 1 || isPending} onClick={() => setPage(p => Math.max(1, p - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2 text-xs">Página {currentPage} de {totalPages}</span>
            <Button variant="outline" size="sm" disabled={currentPage >= totalPages || isPending} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="w-10 px-3 py-2 text-left">
                <Checkbox
                  checked={allPageSelected}
                  onCheckedChange={togglePageSelect}
                  aria-label="Selecionar página"
                  className={somePageSelected && !allPageSelected ? 'opacity-50' : ''}
                />
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Data</th>
              {multiplebanks && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Banco</th>}
              {hasAccountInfo && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Conta</th>}
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Descrição</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tipo</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={5 + (multiplebanks ? 1 : 0) + (hasAccountInfo ? 1 : 0)} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhum lançamento encontrado com os filtros aplicados.
                </td>
              </tr>
            ) : (
              pageRows.map(tx => {
                const isInflow = tx.direction === 'inflow'
                const isSelected = selectedIds.has(tx.id)
                const subtypeLabel = tx.accountSubtype
                  ? (SUBTYPE_LABEL[tx.accountSubtype] ?? tx.accountName ?? '')
                  : (tx.accountName ?? '')
                const accountLabel = tx.accountNumber
                  ? `${subtypeLabel} • ${tx.accountNumber}`
                  : subtypeLabel
                return (
                  <tr
                    key={tx.id}
                    className={`cursor-pointer hover:bg-muted/30 transition-colors ${isSelected ? 'bg-muted/20' : ''}`}
                    onClick={() => toggleRow(tx.id)}
                  >
                    <td className="w-10 px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleRow(tx.id)}
                        aria-label="Selecionar lançamento"
                      />
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">
                      {formatDate(tx.date)}
                    </td>
                    {multiplebanks && (
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap text-xs">
                        {tx.dataSourceName}
                      </td>
                    )}
                    {hasAccountInfo && (
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap text-xs">
                        {accountLabel}
                      </td>
                    )}
                    <td className="px-3 py-2.5 max-w-xs" title={tx.description}>
                      <div className="truncate">{tx.description}</div>
                      {tx.pluggyCategory && (
                        <div className="truncate text-xs text-muted-foreground/60">{tx.pluggyCategory}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={isInflow ? 'default' : 'secondary'} className={`text-xs ${isInflow ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' : ''}`}>
                        {isInflow ? 'Entrada' : 'Saída'}
                      </Badge>
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${isInflow ? 'text-emerald-700' : 'text-foreground'}`}>
                      {isInflow ? '+' : ''}{formatBRL(tx.amount)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Rodapé */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {selectedCount > 0
            ? `${selectedCount} selecionado${selectedCount !== 1 ? 's' : ''} · `
            : ''}
          Exibindo {Math.min((currentPage - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} de {filtered.length} lançamento{filtered.length !== 1 ? 's' : ''}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1 || isPending}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2 text-xs">Página {currentPage} de {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages || isPending}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
