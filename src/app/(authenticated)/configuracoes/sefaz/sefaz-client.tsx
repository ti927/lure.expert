'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { format, differenceInDays, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Building2, Plus, RefreshCw, Trash2, AlertTriangle,
  CheckCircle2, XCircle, Clock, Shield, ChevronLeft,
  Settings,
} from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

import type { SefazConnectionWithEntity } from '@/server/sefaz'
import {
  createSefazConnection, deleteSefazConnection, triggerSefazSync,
} from '@/server/sefaz'

// ─────────────────────────────────────────
// Tipos auxiliares
// ─────────────────────────────────────────
type EntityOption = {
  id: string
  name: string
  cnpj: string | null
  alreadyConnected: boolean
}

interface Props {
  connections: SefazConnectionWithEntity[]
  entities: EntityOption[]
}

// ─────────────────────────────────────────
// Badge de status da conexão
// ─────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  if (status === 'active') {
    return (
      <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-600/30 bg-emerald-50">
        <CheckCircle2 className="h-3 w-3" /> Ativo
      </Badge>
    )
  }
  if (status === 'pending') {
    return (
      <Badge variant="outline" className="gap-1 text-amber-600 border-amber-600/30 bg-amber-50">
        <Clock className="h-3 w-3" /> Aguardando sync inicial
      </Badge>
    )
  }
  if (status === 'error') {
    return (
      <Badge variant="outline" className="gap-1 text-rose-600 border-rose-600/30 bg-rose-50">
        <XCircle className="h-3 w-3" /> Erro de sync
      </Badge>
    )
  }
  if (status === 'expired') {
    return (
      <Badge variant="outline" className="gap-1 text-rose-600 border-rose-600/30 bg-rose-50">
        <Shield className="h-3 w-3" /> Certificado expirado
      </Badge>
    )
  }
  return <Badge variant="outline">{status}</Badge>
}

// ─────────────────────────────────────────
// Formatação de CNPJ
// ─────────────────────────────────────────
function formatCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

// ─────────────────────────────────────────
// Card de uma conexão
// ─────────────────────────────────────────
function ConnectionCard({
  conn,
  onSync,
  onDelete,
}: {
  conn: SefazConnectionWithEntity
  onSync: (conn: SefazConnectionWithEntity) => void
  onDelete: (conn: SefazConnectionWithEntity) => void
}) {
  const certExpiry = conn.certificateExpiry ? parseISO(conn.certificateExpiry) : null
  const daysToExpiry = certExpiry ? differenceInDays(certExpiry, new Date()) : null
  const expiryWarning = daysToExpiry !== null && daysToExpiry <= 30

  return (
    <Card className="shadow-sm">
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          {/* Ícone */}
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted shrink-0">
            <Building2 className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
          </div>

          {/* Dados */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground">{conn.legalEntityName}</span>
              <StatusBadge status={conn.status} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              {formatCnpj(conn.cnpj)}
            </p>

            <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
              <span className="capitalize">{conn.provider.replace('_', ' ')}</span>
              <span>·</span>
              <span className="capitalize">{conn.environment}</span>
              {conn.pullSaida && <span>· NF saída</span>}
              {conn.pullEntrada && <span>· NF entrada</span>}
            </div>

            {conn.lastSyncAt && (
              <p className="text-xs text-muted-foreground mt-1">
                Última sync: {format(new Date(conn.lastSyncAt), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
              </p>
            )}

            {conn.lastSyncError && (
              <p className="text-xs text-rose-500 mt-1 truncate">{conn.lastSyncError}</p>
            )}

            {expiryWarning && certExpiry && (
              <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                Certificado expira em {daysToExpiry! <= 0 ? 'hoje' : `${daysToExpiry} dias`}
                {' '}({format(certExpiry, 'dd/MM/yyyy')})
              </div>
            )}
          </div>

          {/* Ações */}
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              title="Sincronizar NFs"
              onClick={() => onSync(conn)}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-600"
              title="Remover conexão"
              onClick={() => onDelete(conn)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────
// Formulário de nova conexão
// ─────────────────────────────────────────
function CreateDialog({
  open,
  onClose,
  entities,
}: {
  open: boolean
  onClose: () => void
  entities: EntityOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [legalEntityId, setLegalEntityId] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [provider, setProvider] = useState<'focus_nfe' | 'nfeio' | 'tecnospeed' | 'abstract'>('focus_nfe')
  const [providerCompanyId, setProviderCompanyId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [certExpiry, setCertExpiry] = useState('')
  const [environment, setEnvironment] = useState<'producao' | 'homologacao'>('producao')
  const [pullSaida, setPullSaida] = useState(true)
  const [pullEntrada, setPullEntrada] = useState(true)
  const [autoManifest, setAutoManifest] = useState(true)

  // Quando a entidade muda, preenche o CNPJ dela automaticamente
  function handleEntityChange(id: string) {
    setLegalEntityId(id)
    const entity = entities.find(e => e.id === id)
    if (entity?.cnpj) setCnpj(entity.cnpj)
    else setCnpj('')
  }

  // Normaliza CNPJ (remove máscara)
  function normalizeCnpj(v: string): string {
    return v.replace(/\D/g, '').slice(0, 14)
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await createSefazConnection({
        legalEntityId,
        cnpj: normalizeCnpj(cnpj),
        provider,
        providerCompanyId: providerCompanyId || undefined,
        apiKey: apiKey || undefined,
        certificateExpiry: certExpiry || null,
        environment,
        pullSaida,
        pullEntrada,
        autoManifest,
      })

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      toast.success('Conexão SEFAZ criada. Clique em sincronizar para escolher a data de corte.')
      onClose()
      router.refresh()
    })
  }

  const canSubmit = legalEntityId && normalizeCnpj(cnpj).length === 14 && !pending

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar CNPJ ao SEFAZ</DialogTitle>
          <DialogDescription>
            Configure a conexão com o provedor SEFAZ para uma Entidade Jurídica.
            O certificado A1 deve ser cadastrado no dashboard do provedor escolhido.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Entidade */}
          <div className="space-y-1.5">
            <Label>Entidade jurídica</Label>
            <Select value={legalEntityId} onValueChange={handleEntityChange}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {entities.map(e => (
                  <SelectItem key={e.id} value={e.id} disabled={e.alreadyConnected}>
                    {e.name}
                    {e.cnpj ? ` — ${formatCnpj(e.cnpj)}` : ''}
                    {e.alreadyConnected ? ' (já conectada)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* CNPJ */}
          <div className="space-y-1.5">
            <Label>CNPJ (14 dígitos, sem máscara)</Label>
            <Input
              placeholder="00000000000000"
              value={cnpj}
              onChange={e => setCnpj(normalizeCnpj(e.target.value))}
              maxLength={18}
              className="font-mono"
            />
          </div>

          {/* Provedor */}
          <div className="space-y-1.5">
            <Label>Provedor</Label>
            <Select value={provider} onValueChange={v => setProvider(v as typeof provider)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="focus_nfe">Focus NF-e (Migrate)</SelectItem>
                <SelectItem value="nfeio">NFE.io</SelectItem>
                <SelectItem value="tecnospeed">Tecnospeed</SelectItem>
                <SelectItem value="abstract">Modo desenvolvimento (stub)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ID da empresa no provedor */}
          <div className="space-y-1.5">
            <Label>ID da empresa no provedor <span className="text-muted-foreground">(opcional)</span></Label>
            <Input
              placeholder="company_id ou referência"
              value={providerCompanyId}
              onChange={e => setProviderCompanyId(e.target.value)}
            />
          </div>

          {/* API key */}
          <div className="space-y-1.5">
            <Label>API key do provedor <span className="text-muted-foreground">(opcional agora)</span></Label>
            <Input
              type="password"
              placeholder="sk_live_..."
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
            />
          </div>

          {/* Validade do certificado */}
          <div className="space-y-1.5">
            <Label>Validade do certificado A1 <span className="text-muted-foreground">(para alertas)</span></Label>
            <Input
              type="date"
              value={certExpiry}
              onChange={e => setCertExpiry(e.target.value)}
            />
          </div>

          {/* Ambiente */}
          <div className="space-y-1.5">
            <Label>Ambiente</Label>
            <Select value={environment} onValueChange={v => setEnvironment(v as typeof environment)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="producao">Produção</SelectItem>
                <SelectItem value="homologacao">Homologação (testes)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Toggles */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <Label className="font-normal">Puxar NF-e de saída (faturamento)</Label>
              <Switch checked={pullSaida} onCheckedChange={setPullSaida} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="font-normal">Puxar NF-e de entrada (compras/custos)</Label>
              <Switch checked={pullEntrada} onCheckedChange={setPullEntrada} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="font-normal">Manifestar automaticamente NF-e de entrada</Label>
              <Switch checked={autoManifest} onCheckedChange={setAutoManifest} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {pending ? 'Salvando...' : 'Conectar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────
// Dialog de sync com data de corte (padrão Pluggy)
// ─────────────────────────────────────────
function SyncDialog({
  conn,
  onClose,
}: {
  conn: SefazConnectionWithEntity | null
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // Default: 90 dias atrás
  const defaultFrom = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 90)
    return d.toISOString().split('T')[0]
  })()
  const [fromDate, setFromDate] = useState(defaultFrom)

  function handleSync() {
    if (!conn) return
    startTransition(async () => {
      const result = await triggerSefazSync(conn.id, fromDate)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success('Sincronização iniciada. As NFs aparecerão em /nfe em instantes.')
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open={!!conn} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sincronizar NFs</DialogTitle>
          <DialogDescription>
            Escolha a data de corte. Só serão puxadas NFs emitidas a partir dessa data.
          </DialogDescription>
        </DialogHeader>

        {conn && (
          <div className="space-y-4 py-2">
            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">{conn.legalEntityName}</p>
              <p className="font-mono">{formatCnpj(conn.cnpj)}</p>
            </div>

            <div className="space-y-1.5">
              <Label>Puxar NFs a partir de</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
              />
              <p className="text-xs text-muted-foreground">
                O SEFAZ mantém histórico de NF-e de entrada dos últimos 3 meses sem manifestação prévia.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button onClick={handleSync} disabled={!fromDate || pending}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            {pending ? 'Iniciando...' : 'Sincronizar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────
export function SefazClient({ connections, entities }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [createOpen, setCreateOpen] = useState(false)
  const [syncTarget, setSyncTarget] = useState<SefazConnectionWithEntity | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SefazConnectionWithEntity | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    startTransition(async () => {
      const result = await deleteSefazConnection(deleteTarget.id)
      setIsDeleting(false)
      setDeleteTarget(null)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success('Conexão removida.')
      router.refresh()
    })
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Navegação de volta */}
      <Link href="/configuracoes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="h-4 w-4" />
        Configurações
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Conexões SEFAZ / NF-e</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Conecte CNPJs ao SEFAZ para puxar NF-e de saída (faturamento) e de entrada (compras) automaticamente.
            Cada entidade jurídica tem sua própria conexão e certificado.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm" className="shrink-0">
          <Plus className="h-4 w-4 mr-1.5" />
          Conectar CNPJ
        </Button>
      </div>

      {/* Aviso sobre certificado */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-1">
        <div className="flex items-center gap-2 font-medium">
          <Shield className="h-4 w-4 shrink-0" />
          Como funciona a integração
        </div>
        <p className="text-xs leading-relaxed">
          O certificado digital A1 deve ser cadastrado no dashboard do provedor escolhido (Focus NF-e, NFE.io, etc.).
          O lure.expert armazena apenas a API key do provedor — zero upload de arquivo .pfx aqui.
          Após conectar, clique em sincronizar para escolher a data de corte.
        </p>
      </div>

      {/* Lista de conexões */}
      {connections.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-12">
            <div className="text-center space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mx-auto">
                <Building2 className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Nenhum CNPJ conectado ao SEFAZ</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Conecte uma Entidade Jurídica para começar a puxar NFs automaticamente.
                </p>
              </div>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Conectar primeiro CNPJ
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {connections.map(conn => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              onSync={setSyncTarget}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* Link para /nfe */}
      {connections.length > 0 && (
        <Link href="/nfe">
          <div className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-muted/40 transition-colors cursor-pointer">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted shrink-0">
              <Settings className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Painel de NFs</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Visualize NFs casadas com transações, a receber e a pagar.
              </p>
            </div>
          </div>
        </Link>
      )}

      {/* Dialogs */}
      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        entities={entities}
      />

      <SyncDialog
        conn={syncTarget}
        onClose={() => setSyncTarget(null)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover conexão SEFAZ?</AlertDialogTitle>
            <AlertDialogDescription>
              O CNPJ <strong>{deleteTarget ? formatCnpj(deleteTarget.cnpj) : ''}</strong> ({deleteTarget?.legalEntityName}) não será mais monitorado.
              As NFs já importadas são preservadas. Esta ação pode ser desfeita reconectando o CNPJ.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {isDeleting ? 'Removendo...' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
