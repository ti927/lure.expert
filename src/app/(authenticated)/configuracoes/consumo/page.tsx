import type { Metadata } from 'next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/states/empty-state'
import { Activity } from 'lucide-react'
import { getConsumoIa } from '@/server/ai-consumption'
import { getAiSettings } from '@/server/ai-settings'
import { AiKeyManager } from '@/components/settings/ai-key-manager'
import { ROTULOS_USO_IA } from '@/lib/ai-usage'
import { monthLabel } from '@/lib/format'

export const metadata: Metadata = { title: 'Consumo de IA' }

const fmtUsd = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtBrl = (v: number, taxa: number) =>
  (v * taxa).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtInt = (v: number) => v.toLocaleString('pt-BR')

export default async function ConsumoPage() {
  const [c, ai] = await Promise.all([getConsumoIa(), getAiSettings()])

  const semDados = c.meses.length === 0 && c.totalUsd === 0

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Consumo de IA</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Quanto o expert processou nesta organização, e o que isso custou.
        </p>
      </div>

      <AiKeyManager inicial={ai} taxaUsdBrl={c.taxaUsdBrl} />

      {semDados ? (
        <EmptyState
          icon={<Activity className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
          title="Nenhum consumo registrado"
          description="A classificação de lançamentos e a leitura de extratos aparecem aqui assim que acontecerem. Importações resolvidas por regra, recorrência ou pelas colunas do próprio arquivo não consomem IA."
        />
      ) : (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="shadow-sm">
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground">Mês atual</p>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  US$ {fmtUsd(c.mesAtual?.custoUsd ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                  R$ {fmtBrl(c.mesAtual?.custoUsd ?? 0, c.taxaUsdBrl)} ·{' '}
                  {fmtInt(c.mesAtual?.chamadas ?? 0)} chamada{(c.mesAtual?.chamadas ?? 0) !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground">Total acumulado</p>
                <p className="text-2xl font-semibold tabular-nums mt-1">US$ {fmtUsd(c.totalUsd)}</p>
                <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                  R$ {fmtBrl(c.totalUsd, c.taxaUsdBrl)}
                  {c.primeiroRegistro && ` · desde ${c.primeiroRegistro.split('-').reverse().join('/')}`}
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground">Câmbio usado</p>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {c.taxaUsdBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  O custo é cobrado em dólar; o real é conversão de exibição.
                </p>
              </CardContent>
            </Card>
          </div>

          {c.temPrecoDesconhecido && (
            <p className="text-xs text-amber-600">
              Alguma chamada usou um modelo que não está na tabela de preços, e entrou no total
              valendo zero. O valor acima está subestimado até a tabela ser atualizada.
            </p>
          )}

          {/* Por origem, no mês */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Por origem, neste mês</CardTitle>
              <CardDescription className="mt-1.5">
                Só aparece o que passou pelo expert. Lançamento classificado por regra,
                recorrência ou pelas colunas do próprio arquivo não custa nada e não entra aqui.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {c.porTipo.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nada consumido neste mês.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">Origem</th>
                      <th className="px-2 py-1.5 font-medium text-right w-24">Chamadas</th>
                      <th className="px-2 py-1.5 font-medium text-right w-32">Tokens</th>
                      <th className="px-2 py-1.5 font-medium text-right w-28">Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.porTipo.map(t => (
                      <tr key={t.tipo} className="border-b last:border-0">
                        <td className="px-2 py-1.5">{ROTULOS_USO_IA[t.tipo] ?? t.tipo}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtInt(t.chamadas)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {fmtInt(t.tokensIn + t.tokensOut)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">US$ {fmtUsd(t.custoUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* Histórico mensal */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Histórico</CardTitle>
              <CardDescription className="mt-1.5">Últimos 12 meses.</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1.5 font-medium">Mês</th>
                    <th className="px-2 py-1.5 font-medium text-right w-24">Chamadas</th>
                    <th className="px-2 py-1.5 font-medium text-right w-32">Tokens</th>
                    <th className="px-2 py-1.5 font-medium text-right w-28">US$</th>
                    <th className="px-2 py-1.5 font-medium text-right w-28">R$</th>
                  </tr>
                </thead>
                <tbody>
                  {c.meses.map(m => (
                    <tr key={m.mes} className="border-b last:border-0">
                      <td className="px-2 py-1.5">{monthLabel(m.mes)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtInt(m.chamadas)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {fmtInt(m.tokensIn + m.tokensOut)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtUsd(m.custoUsd)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {fmtBrl(m.custoUsd, c.taxaUsdBrl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
