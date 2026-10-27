import Link from 'next/link'
import { ArrowLeft, Landmark } from 'lucide-react'
import { rotuloDaConta } from '@/lib/import-contract'
import type { ContaNaTela } from '@/server/account-ledger'

/**
 * O topo das telas de uma conta (conferência de saldo, faturas, fatura aberta):
 * voltar, logo, rótulo, badge e uma linha de contexto. `voltarPara` muda o
 * destino da seta — da fatura aberta, volta para a lista de faturas.
 */
export function CabecalhoDaConta({ conta, contexto, voltarPara = '/contas', acoes, children }: {
  conta: ContaNaTela
  contexto: string
  voltarPara?: string
  /** Botões à direita do título (lançar, apagados). */
  acoes?: React.ReactNode
  children?: React.ReactNode
}) {
  const rotulo = rotuloDaConta({ accountName: conta.nome, accountType: conta.tipo, accountNumber: conta.numero })
    ?? conta.accountId
  return (
    <div className="shrink-0 px-6 pt-5 pb-3 space-y-4">
      <div className="flex items-center gap-3">
        <Link href={voltarPara} className="text-muted-foreground hover:text-foreground" title="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {conta.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={conta.logoUrl} alt="" className="h-8 w-8 rounded object-contain" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
            <Landmark className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <span className="truncate">{rotulo}</span>
            {conta.badge && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                {conta.badge}
              </span>
            )}
          </h1>
          <p className="text-xs text-muted-foreground">
            {contexto}{conta.conexao && conta.conexao !== conta.nome ? ` · ${conta.conexao}` : ''}
          </p>
        </div>
        {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
      </div>
      {children}
    </div>
  )
}

/** Um cartão de número do topo (saldo, faturas). */
export function Cartao({ titulo, valor, detalhe, tom, acao }: {
  titulo: string
  valor: string
  detalhe?: string
  tom?: 'positivo' | 'negativo' | 'neutro'
  acao?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        {acao}
      </div>
      <p className={[
        'mt-1 text-lg font-semibold tabular-nums',
        tom === 'positivo' ? 'text-emerald-600' : tom === 'negativo' ? 'text-rose-600' : '',
      ].join(' ')}>
        {valor}
      </p>
      {detalhe && <p className="text-[11px] text-muted-foreground">{detalhe}</p>}
    </div>
  )
}

export function dataBR(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}
