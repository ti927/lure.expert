'use client'

// Conferência de saldo de UMA conta: a tabela de `/transacoes` pela data de
// caixa, com saldo corrido e fechamento do dia, partindo do saldo inicial que
// quem confere informa. A regra mora em `lib/account-ledger.ts`; ver também a
// Decisão 29 (por que o saldo volta ao app, agora com âncora).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, Scale, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/states/empty-state'
import { PartialDataBanner } from '@/components/states/partial-data-banner'
import { parseAmount } from '@/lib/format'
import { COLUNAS_CONFERENCIA } from '@/lib/column-widths'
import { salvarSaldoInicial, removerSaldoInicial, type ContaNaTela } from '@/server/account-ledger'
import {
  TransactionsTable, formatBRL, type TxRow, type DimensionOptions, type TransactionsSearchParams,
} from '@/components/transacoes-shared/transactions-table'
import type { ResumoDoExtrato } from '@/lib/account-ledger'
import { CabecalhoDaConta, Cartao, dataBR } from './cabecalho-da-conta'
import { LancarManual, ManuaisApagados } from './lancamento-manual'

interface Props {
  conta: ContaNaTela
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

export default function ConferenciaClient({ conta, extrato, semConta, options, searchParams }: Props) {
  const router = useRouter()
  const r = extrato.resumo
  const ancora = r.saldoInicial
  const [editando, setEditando] = useState(false)
  const [data, setData] = useState(ancora?.data ?? '')
  const [valor, setValor] = useState(ancora ? ancora.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '')
  const [nota, setNota] = useState(ancora?.nota ?? '')
  const [salvando, startSalvar] = useTransition()

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
    <CabecalhoDaConta conta={conta} contexto={`Conferência de saldo · ${extrato.total} lançamento${extrato.total !== 1 ? 's' : ''}`}
      acoes={conta.manual ? <><ManuaisApagados accountId={conta.accountId} /><LancarManual accountId={conta.accountId} categories={options.categories} /></> : undefined}>
      {ancora ? (
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
      )}
    </CabecalhoDaConta>
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
