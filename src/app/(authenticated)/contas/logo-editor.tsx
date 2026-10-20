'use client'

// O logo de uma conta — enviar e remover. Extraído de `EditConnectionDialog`
// quando as contas manuais ganharam edição (20/out): as duas janelas usam este,
// e as server actions já não distinguiam conexão do Pluggy de conta manual.

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Landmark, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { setConnectionLogoPath, removeConnectionLogo } from '@/server/connections'

const LOGO_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const LOGO_MAX_BYTES = 500 * 1024 // 500 KB

export function LogoEditor({
  dataSourceId, orgId, currentLogoUrl, hasCustomLogo, disabled, onBusyChange,
}: {
  dataSourceId: string
  orgId: string
  currentLogoUrl: string | null
  hasCustomLogo: boolean
  disabled?: boolean
  /** Para a janela travar os outros botões enquanto a imagem sobe. */
  onBusyChange?: (busy: boolean) => void
}) {
  const router = useRouter()
  const [isUploading, setIsUploading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  function setBusy(b: boolean) { setIsUploading(b); onBusyChange?.(b) }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!LOGO_ACCEPTED_TYPES.includes(file.type)) { toast.error('Use PNG, JPG ou WebP.'); return }
    if (file.size > LOGO_MAX_BYTES) { toast.error('Imagem muito grande. Limite: 500 KB.'); return }

    setBusy(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
      const storagePath = `${orgId}/connection-logos/${dataSourceId}-${crypto.randomUUID()}.${ext}`

      const { error: storageError } = await supabase.storage
        .from('documents')
        .upload(storagePath, file, { contentType: file.type, upsert: false })
      if (storageError) { toast.error(`Erro ao enviar imagem: ${storageError.message}`); return }

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
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await removeConnectionLogo(dataSourceId)
      if ('error' in result) { toast.error(result.error); return }
      toast.success('Logo removido.')
      router.refresh()
    })
  }

  const travado = disabled || isUploading || isPending

  return (
    <div className="space-y-1.5">
      <Label>Logo</Label>
      <div className="flex items-center gap-3">
        {currentLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentLogoUrl} alt="Logo atual" className="h-12 w-12 rounded border bg-muted object-contain" />
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
            onChange={handleUpload}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={travado}>
            {isUploading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Carregar imagem
          </Button>
          {hasCustomLogo && (
            <Button type="button" size="sm" variant="ghost" onClick={handleRemove} disabled={travado} className="text-muted-foreground">
              Remover
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">PNG, JPG ou WebP — até 500 KB.</p>
    </div>
  )
}
