'use client'

// Conferência de saldo de UMA conta: a tabela de `/transacoes` pela data de
// caixa, com saldo corrido e fechamento do dia, partindo do saldo inicial que
// quem confere informa. A regra mora em `lib/account-ledger.ts`; ver também a
// Decisão 29 (por que o saldo volta ao app, agora com âncora).

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Landmark, Pencil, Scale, CreditCard, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/states/empty-state'
import { PartialDataBanner } from '@/components/states/partial-data-banner'
import { cn } from '@/lib/utils'
import { parseAmount } from '@/lib/format'
import { rotuloDaConta, temSaldoCorrido } from '@/lib/import-contract'
import { COLUNAS_CONFERENCIA } from '@/lib/column-widths'
import { salvarSaldoInicial, removerSaldoInicial } from '@/server/account-ledger'
import {
  TransactionsTable, formatBRL, type TxRow, type DimensionOptions, type TransactionsSearchParams,
} from '@/components/transacoes-shared/transactions-table'
import type { ResumoDoExtrato } from '@/lib/account-ledger'

interface Props {
  conta: {
    accountId: string
    nome: string | null
    tipo: string | null
    numero: string | null
    logoUrl: string | null
    badge: string | null
    conexao: string | null
  }
  extrato: {
    rows: TxRow[]
    total: number
    pages: number
    page: number
    totals: { inflow: string; outflow: string }
    resumo: ResumoDoExtrato
  }
  semConta: number
  options: DimensionOptions
  searchParams: TransactionsSearchParams
}

function dataBR(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function Cartao({ titulo, valor, detalhe, tom, acao }: {
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
      <p className={cn('mt-1 text-lg font-semibold tabular-nums',
        tom === 'positivo' && 'text-emerald-600', tom === 'negativo' && 'text-rose-600')}>
        {valor}
      </p>
      {detalhe && <p className="text-[11px] text-muted-foreground">{detalhe}</p>}
    </div>
  )
}

export default function ConferenciaClient({ conta, extrato, semConta, options, searchParams }: Props) {
  const router = useRouter()
  const r = extrato.resumo
  const ancora = r.saldoInicial
  const [editando, setEditando] = useState(false)
  const [data, setData] = useState(ancora?.data ?? '')
  const [valor, setValor] = useState(ancora ? ancora.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '')
  const [nota, setNota] = useState(ancora?.nota ?? '')
  const [salvando, startSalvar] = useTransition()

  const rotulo = rotuloDaConta({ accountName: conta.nome, accountType: conta.tipo, accountNumber: conta.numero })
    ?? conta.accountId
  const ehCartao = !temSaldoCorrido(conta.tipo)

  function abrirEdicao() {
    setData(ancora?.data ?? r.ultimaData ?? '')
    setValor(ancora ? ancora.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '')
    setNota(ancora?.nota ?? '')
    setEditando(true)
  }

  function salvar() {
    const v = parseAmount(valor)
    if (v === null) { toast.error('Valor inválido. Use o formato 1.234,56 (negativo com o sinal −).'); return }
    if (!data) { toast.error('Informe a data.'); return }
    startSalvar(async () => {
      const res = await salvarSaldoInicial(conta.accountId, { data, valor: v, nota: nota.trim() || null })
      if ('error' in res) { toast.error(res.error); return }
      toast.success('Saldo inicial salvo.')
      setEditando(false)
      router.refresh()
    })
  }

  function remover() {
    startSalvar(async () => {
      const res = await removerSaldoInicial(conta.accountId)
      if ('error' in res) { toast.error(res.error); return }
      toast.success('Saldo inicial removido.')
      setEditando(false)
      router.refresh()
    })
  }

  const cabecalho = (
    <div className="shrink-0 px-6 pt-5 pb-3 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/contas" className="text-muted-foreground hover:text-foreground" title="Voltar para Contas">
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
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <span className="truncate">{rotulo}</span>
            {conta.badge && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                {conta.badge}
              </span>
            )}
          </h1>
          <p className="text-xs text-muted-foreground">
            Conferência de saldo{conta.conexao && conta.conexao !== conta.nome ? ` · ${conta.conexao}` : ''}
            {' · '}{extrato.total} lançamento{extrato.total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {!ehCartao && (ancora ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Cartao
            titulo={`Saldo inicial · início de ${dataBR(ancora.data)}`}
            valor={formatBRL(ancora.valor)}
            detalhe={ancora.nota ?? undefined}
            tom={ancora.valor < 0 ? 'negativo' : 'neutro'}
            acao={
              <button onClick={abrirEdicao} className="text-muted-foreground hover:text-primary" title="Alterar o saldo inicial">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            }
          />
          <Cartao titulo="Entradas desde então" valor={formatBRL(r.entradas)} tom="positivo" />
          <Cartao titulo="Saídas desde então" valor={`−${formatBRL(r.saidas)}`} tom="negativo" />
          <Cartao
            titulo={`Saldo final · fim de ${dataBR(r.ultimaData)}`}
            valor={r.saldoFinal != null ? formatBRL(r.saldoFinal) : '—'}
            detalhe="Compare com o saldo do extrato do banco nesta data"
            tom={r.saldoFinal != null && r.saldoFinal < 0 ? 'negativo' : 'neutro'}
          />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <div className="flex items-start gap-3">
            <Scale className="mt-0.5 h-5 w-5 text-primary" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium">Informe o saldo inicial para conferir</p>
              <p className="text-xs text-muted-foreground">
                Pegue no extrato do banco o saldo no início de um dia (a linha &quot;saldo anterior&quot;).
                A partir dele, a coluna Saldo mostra o saldo depois de cada lançamento e o fechamento de cada dia.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={abrirEdicao}>Informar saldo inicial</Button>
        </div>
      ))}
    </div>
  )

  const avisos = (
    <>
      {ancora && r.saldosDuplicados.length > 0 && (
        <div className="shrink-0 px-6 pb-2">
          <PartialDataBanner
            variant="warning"
            message={`O saldo pode estar contado duas vezes: ${r.saldosDuplicados.map(d =>
              `"${d.descricao}" de ${dataBR(d.data)} (${formatBRL(d.valor)})`).join(', ')} ${r.saldosDuplicados.length > 1 ? 'são lançamentos' : 'é um lançamento'} de saldo de abertura, na data do saldo inicial ou depois dela. Informe o saldo inicial no dia seguinte a ${r.saldosDuplicados.length > 1 ? 'eles' : 'ele'}, ou zero no dia ${r.saldosDuplicados.length > 1 ? 'deles' : 'dele'}.`}
          />
        </div>
      )}
      {ancora && r.antesDoSaldoInicial > 0 && (
        <div className="shrink-0 px-6 pb-2">
          <PartialDataBanner
            variant="info"
            message={`${r.antesDoSaldoInicial} lançamento${r.antesDoSaldoInicial !== 1 ? 's' : ''} desta conta ${r.antesDoSaldoInicial !== 1 ? 'são anteriores' : 'é anterior'} a ${dataBR(ancora.data)} e ${r.antesDoSaldoInicial !== 1 ? 'aparecem' : 'aparece'} sem saldo. Para conferi-los, informe um saldo inicial mais antigo.`}
          />
        </div>
      )}
      {semConta > 0 && (
        <div className="shrink-0 px-6 pb-2">
          <PartialDataBanner
            variant="warning"
            dismissible
            message={`${semConta.toLocaleString('pt-BR')} lançamento${semConta !== 1 ? 's' : ''} da empresa ${semConta !== 1 ? 'não têm' : 'não tem'} conta (importados por arquivo sem a coluna Conta) e não ${semConta !== 1 ? 'entram' : 'entra'} no saldo de nenhuma conta. Se um deles for desta conta, o saldo daqui não vai bater com o banco.`}
          />
        </div>
      )}
    </>
  )

  const dialogo = (
    <Dialog open={editando} onOpenChange={setEditando}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Saldo inicial</DialogTitle>
          <DialogDescription>
            O saldo da conta no INÍCIO do dia, antes de qualquer lançamento dele — a linha &quot;saldo
            anterior&quot; do extrato do banco. Lançamentos com data de caixa anterior ficam sem saldo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="saldo-data">Data</Label>
            <Input id="saldo-data" type="date" value={data} onChange={e => setData(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="saldo-valor">Saldo no início do dia (R$)</Label>
            <Input id="saldo-valor" inputMode="decimal" placeholder="1.234,56" value={valor}
              onChange={e => setValor(e.target.value)} className="tabular-nums" />
            <p className="text-[11px] text-muted-foreground">Negativo com o sinal de menos (cheque especial).</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="saldo-nota">Observação (opcional)</Label>
            <Input id="saldo-nota" placeholder="ex.: extrato de setembro, pág. 1" value={nota}
              onChange={e => setNota(e.target.value)} maxLength={500} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {ancora ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={remover} disabled={salvando}>
              Remover
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditando(false)} disabled={salvando}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  // Cartão de crédito: o "saldo" dele é fatura — outra lógica, fora da v1.
  if (ehCartao) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {cabecalho}
        <EmptyState
          icon={<CreditCard className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Conferência de cartão ainda não disponível"
          description="Num cartão, o saldo é a fatura: compras no período e o pagamento dela. A conferência por saldo corrido vale para conta corrente, poupança e caixa."
        />
      </div>
    )
  }

  if (extrato.total === 0 && !Object.values(searchParams).some(Boolean)) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {cabecalho}
        {dialogo}
        <EmptyState
          icon={<Scale className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Esta conta ainda não tem lançamentos"
          description="Importe um extrato informando esta conta na coluna Conta, ou sincronize a conexão."
        />
      </div>
    )
  }

  return (
    <>
      <TransactionsTable
        basePath={`/contas/${encodeURIComponent(conta.accountId)}`}
        storageKey={`lure:conferencia:${conta.accountId}:filters`}
        widthsKey="conferencia"
        colunas={COLUNAS_CONFERENCIA}
        data={extrato}
        options={options}
        searchParams={searchParams}
        modoSaldo={{ temSaldoInicial: !!ancora }}
        cabecalho={cabecalho}
        antesDaTabela={avisos}
      />
      {dialogo}
    </>
  )
}
