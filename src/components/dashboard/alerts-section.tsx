'use client'

// A tira de alertas — extraída de `dashboard-client.tsx` na 5.C. O dismiss por
// mês em `localStorage` é herança da Fase 6 e continua aqui: alerta dispensado
// em março tem de voltar quando o usuário olha abril.

import Link from 'next/link'
import { AlertTriangle, X } from 'lucide-react'
import type { DashboardAlert } from '@/lib/dashboard/alerts'

export function AlertsSection({
  alerts,
  dismissedIds,
  onDismiss,
}: {
  alerts:       DashboardAlert[]
  dismissedIds: string[]
  onDismiss:    (id: string) => void
}) {
  const visible = alerts.filter(a => !dismissedIds.includes(a.id))
  if (visible.length === 0) return null

  return (
    <div className="space-y-2">
      {visible.map(alert => (
        <div
          key={alert.id}
          className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${
            alert.severity === 'critical'
              ? 'border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30'
              : 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30'
          }`}
        >
          <AlertTriangle
            className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
              alert.severity === 'critical' ? 'text-rose-600' : 'text-amber-600'
            }`}
            strokeWidth={1.75}
          />
          <p className={`flex-1 leading-snug ${
            alert.severity === 'critical'
              ? 'text-rose-800 dark:text-rose-200'
              : 'text-amber-800 dark:text-amber-200'
          }`}>
            {alert.message}
          </p>
          <div className="flex items-center gap-3 flex-shrink-0">
            {alert.action && (
              <Link
                href={alert.action.href}
                className="text-xs underline underline-offset-2 hover:no-underline text-muted-foreground"
              >
                {alert.action.label}
              </Link>
            )}
            <button
              type="button"
              onClick={() => onDismiss(alert.id)}
              aria-label="Dispensar alerta"
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
