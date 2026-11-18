'use client'

// A prévia ao vivo do diálogo da pessoa: o mês típico e o custo do ano por
// componente, calculados no navegador pelo MESMO `calcularPessoa` que a geração
// usa no servidor. Não é uma estimativa paralela — é o mesmo código.

import { useMemo } from 'react'
import { calcularPessoa, custoAnual, RegimeAusente } from '@/lib/payroll-calc'
import {
  paraPessoaCalc, pessoaSchema, ROTULO_COMPONENTE,
  type LinhaCalculada, type ParametrosUJ, type ParametrosVersaoCalc, type PessoaInput,
} from '@/lib/payroll-types'
import { fmtCentavos } from './folha-format'

type Grupo = { rotulo: string; tipico: number; meses: number; ano: number }

/** Uma linha por componente (benefício por nome); mês típico = o valor mensal mais frequente. */
function agrupar(linhas: LinhaCalculada[]): Grupo[] {
  const ordem: string[] = []
  const porGrupo = new Map<string, { rotulo: string; porMes: Map<string, number> }>()
  for (const l of linhas) {
    const chave = l.beneficio ? `beneficio:${l.beneficio.nome}` : l.componente
    const rotulo = l.beneficio ? `Benefício · ${l.beneficio.nome}` : ROTULO_COMPONENTE[l.componente]
    if (!porGrupo.has(chave)) { porGrupo.set(chave, { rotulo, porMes: new Map() }); ordem.push(chave) }
    const g = porGrupo.get(chave)!
    g.porMes.set(l.competencia, (g.porMes.get(l.competencia) ?? 0) + l.centavos)
  }
  return ordem.map(k => {
    const g = porGrupo.get(k)!
    const valores = Array.from(g.porMes.values())
    const freq = new Map<number, number>()
    for (const v of valores) freq.set(v, (freq.get(v) ?? 0) + 1)
    let tipico = valores[0] ?? 0
    for (const [v, n] of Array.from(freq.entries())) if (n > (freq.get(tipico) ?? 0)) tipico = v
    return { rotulo: g.rotulo, tipico, meses: valores.length, ano: valores.reduce((s, v) => s + v, 0) }
  })
}

export function PessoaPrevia({
  input, versao, uj, exercicio,
}: {
  input: PessoaInput
  versao: ParametrosVersaoCalc
  uj: ParametrosUJ | null
  exercicio: number
}) {
  const r = useMemo((): { erro: string } | { grupos: Grupo[]; total: number } => {
    const parsed = pessoaSchema.safeParse(input)
    if (!parsed.success) return { erro: parsed.error.issues[0].message }
    try {
      const linhas = calcularPessoa(paraPessoaCalc(parsed.data), versao, uj, exercicio)
      return { grupos: agrupar(linhas), total: custoAnual(linhas) }
    } catch (e) {
      if (e instanceof RegimeAusente) {
        return { erro: 'A unidade jurídica escolhida não tem regime tributário. Informe o regime em Configurações › Entidades jurídicas para calcular os encargos.' }
      }
      throw e
    }
  }, [input, versao, uj, exercicio])

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
      <p className="text-xs font-medium">Prévia do custo</p>
      {'erro' in r ? (
        <p className="text-[11px] text-muted-foreground leading-snug">{r.erro}</p>
      ) : r.grupos.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Nenhum lançamento no exercício.</p>
      ) : (
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-muted-foreground border-b border-border/40">
              <th className="text-left font-medium py-1">Componente</th>
              <th className="text-right font-medium py-1">Mês típico</th>
              <th className="text-right font-medium py-1">Ano</th>
            </tr>
          </thead>
          <tbody>
            {r.grupos.map(g => (
              <tr key={g.rotulo} className="border-b border-border/30">
                <td className="py-1 pr-2">{g.rotulo}</td>
                <td className="py-1 text-right tabular-nums whitespace-nowrap">
                  {fmtCentavos(g.tipico)}
                  <span className="text-muted-foreground"> × {g.meses}</span>
                </td>
                <td className="py-1 text-right tabular-nums">{fmtCentavos(g.ano)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1.5">Custo do ano</td>
              <td />
              <td className="py-1.5 text-right tabular-nums">{fmtCentavos(r.total)}</td>
            </tr>
          </tbody>
        </table>
      )}
      <p className="text-[10px] text-muted-foreground leading-snug">
        {versao.modoProvisao === 'provisao'
          ? '13º e 1/3 de férias provisionados mês a mês; o último mês ativo recebe o complemento.'
          : '13º em dezembro e 1/3 de férias no mês de férias.'}
        {' '}O custo do ano é o mesmo nos dois modos.
      </p>
    </div>
  )
}
