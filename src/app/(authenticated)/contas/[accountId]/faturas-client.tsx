'use client'

// Cartão de crédito: a conferência é por FATURA, não por saldo corrido (ver
// `lerFaturasDaConta` e a Decisão 30). Uma linha por vencimento — compras,
// pagamentos, diferença e o saldo devedor acumulado —, e cada linha abre os
// lançamentos daquela fatura.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CreditCard, ChevronRight } from 'lucide-react'
import { EmptyState } from '@/components/states/empty-state'
import { PartialDataBanner } from '@/components/states/partial-data-banner'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/components/transacoes-shared/transactions-table'
import type { Fatura } from '@/lib/account-ledger'
import type { ContaNaTela } from '@/server/account-ledger'
import { CabecalhoDaConta, Cartao, dataBR } from './cabecalho-da-conta'
import { LancarManual, ManuaisApagados } from './lancamento-manual'
import type { Category } from '@/db/schema/categories'

export default function FaturasClient({ conta, faturas, categories }: { conta: ContaNaTela; faturas: Fatura[]; categories: Category[] }) {
  const router = useRouter()
  const base = `/contas/${encodeURIComponent(conta.accountId)}`
  const ultima = faturas[faturas.length - 1]
  const semVencimento = faturas.filter(f => f.semVencimento)
  const comprasSemVencimento = semVencimento.reduce((s, f) => s + f.compras, 0)
  const totalCompras = faturas.reduce((s, f) => s + f.valorCompras, 0)
  const totalCreditos = faturas.reduce((s, f) => s + f.valorCreditos, 0)
  // Mais recente primeiro: é a fatura que se confere hoje.
  const linhas = [...faturas].reverse()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <CabecalhoDaConta conta={conta} contexto={`Conferência por fatura · ${faturas.length} vencimento${faturas.length !== 1 ? 's' : ''}`}
      acoes={conta.manual ? <><ManuaisApagados accountId={conta.accountId} /><LancarManual accountId={conta.accountId} categories={categories} /></> : undefined}>
        {faturas.length > 0 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Cartao titulo="Compras no período" valor={formatBRL(totalCompras)} tom="negativo" />
            <Cartao titulo="Pagamentos e créditos" valor={formatBRL(totalCreditos)} tom="positivo" />
            <Cartao
              titulo={`Saldo devedor · após ${dataBR(ultima?.vencimento)}`}
              valor={formatBRL(ultima?.saldoDevedor ?? 0)}
              detalhe="Compras − pagamentos acumulados. Zero = tudo pago"
              tom={(ultima?.saldoDevedor ?? 0) > 0 ? 'negativo' : 'neutro'}
            />
            <Cartao
              titulo={`Última fatura · ${dataBR(ultima?.vencimento)}`}
              valor={formatBRL(ultima?.valorCompras ?? 0)}
              detalhe="Compare com o total da fatura do banco"
            />
          </div>
        )}
      </CabecalhoDaConta>

      {comprasSemVencimento > 0 && (
        <div className="shrink-0 px-6 pb-2">
          <PartialDataBanner
            variant="warning"
            message={`${comprasSemVencimento} compra${comprasSemVencimento !== 1 ? 's' : ''} sem vencimento: a data de caixa é a própria data da compra, então ${comprasSemVencimento !== 1 ? 'caíram' : 'caiu'} em ${semVencimento.length} "fatura${semVencimento.length !== 1 ? 's' : ''}" de um dia só (marcadas abaixo). Reimporte com a coluna Data de caixa = vencimento da fatura para agrupá-las.`}
          />
        </div>
      )}

      {faturas.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Este cartão ainda não tem lançamentos"
          description="Importe a fatura informando este cartão na coluna Conta e o vencimento na coluna Data de caixa."
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden px-6 pb-4">
          <div className="h-full overflow-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted border-b text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Vencimento</th>
                  <th className="px-3 py-2 text-left font-medium">Compras de … até</th>
                  <th className="px-3 py-2 text-right font-medium">Compras</th>
                  <th className="px-3 py-2 text-right font-medium">Pagamentos e créditos</th>
                  <th className="px-3 py-2 text-right font-medium" title="Compras − pagamentos desta fatura">Diferença</th>
                  <th className="px-3 py-2 text-right font-medium" title="O que se deve depois desta fatura">Saldo devedor</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {linhas.map(f => {
                  const href = `${base}/fatura/${f.vencimento}`
                  return (
                    <tr key={f.vencimento} onClick={() => router.push(href)}
                      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                        <Link href={href} className="font-medium hover:text-primary" onClick={e => e.stopPropagation()}>
                          {dataBR(f.vencimento)}
                        </Link>
                        {f.semVencimento && (
                          <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-800"
                            title="As compras deste grupo não têm vencimento: a data de caixa é a da compra">
                            sem vencimento
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {f.primeiraCompra ? `${dataBR(f.primeiraCompra)} a ${dataBR(f.ultimaCompra)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        <span className="text-rose-600">{f.valorCompras ? formatBRL(f.valorCompras) : '—'}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground">({f.compras})</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        <span className="text-emerald-600">{f.valorCreditos ? formatBRL(f.valorCreditos) : '—'}</span>
                        {f.creditos > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({f.creditos})</span>}
                      </td>
                      <td className={cn('px-3 py-2 text-right tabular-nums whitespace-nowrap',
                        f.diferenca === 0 ? 'text-muted-foreground' : 'text-amber-700 font-medium')}>
                        {f.diferenca === 0 ? 'paga' : formatBRL(f.diferenca)}
                      </td>
                      <td className={cn('px-3 py-2 text-right tabular-nums whitespace-nowrap font-semibold',
                        f.saldoDevedor > 0 ? 'text-rose-600' : 'text-foreground')}>
                        {formatBRL(f.saldoDevedor)}
                      </td>
                      <td className="px-2 text-muted-foreground"><ChevronRight className="h-4 w-4" /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
