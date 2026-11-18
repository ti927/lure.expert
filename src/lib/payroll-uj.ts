// Parâmetros de folha da unidade jurídica no formulário de /configuracoes.
//
// Puro (sem `@/db`): lê o FormData em PONTOS percentuais, valida pelo
// `unidadeJuridicaFolhaSchema` e devolve as colunas em FRAÇÃO, como o banco as
// guarda. Mora em /lib porque `server/dimensions.ts` é 'use server' (só exporta
// função async) e porque assim é exercitável sem sessão.

import {
  REGIMES, REGIME_LABELS, paraParametrosUJ, unidadeJuridicaFolhaSchema, type Regime,
} from './payroll-types'

/** Nomes dos campos no formulário — prefixados para não colidir com nome/código/CNPJ. */
export const CAMPOS_FOLHA_UJ = {
  regime: 'folha_regime',
  anexoIV: 'folha_anexo_iv',
  inss: 'folha_inss',
  ratFap: 'folha_rat_fap',
  terceiros: 'folha_terceiros',
  fgts: 'folha_fgts',
} as const

export const DICA_INSS_DESONERADA = 'Desonerada? Lei 14.973/2024: 10% em 2026, 15% em 2027, 20% em 2028.'

export const OPCOES_REGIME = [
  { value: '', label: 'Sem regime (não gera folha CLT)' },
  ...REGIMES.map(r => ({ value: r, label: REGIME_LABELS[r] })),
]

/** As colunas de `legal_entities` que a folha lê (frações, `numeric(8,6)` como texto). */
export type ColunasFolhaUJ = {
  regimeTributario: Regime | null
  simplesAnexoIv: boolean
  aliquotaInssPatronal: string
  aliquotaRatFap: string
  aliquotaTerceiros: string
  aliquotaFgts: string
}

/** Fração → texto de `numeric(8,6)`, sem o ruído do ponto flutuante (3,7035 pontos → "0.037035"). */
const fracaoParaTexto = (f: number) => f.toFixed(6)

/** "5,8" ou "5.8" → número; vazio → undefined (vale o padrão do schema); lixo → NaN. */
function lerPontos(v: FormDataEntryValue | null): number | undefined {
  if (v === null) return undefined
  const t = String(v).trim().replace(',', '.')
  if (t === '') return undefined
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
}

/**
 * Lê os campos de folha do formulário. `null` = o formulário não os trouxe
 * (outro chamador, como a importação de CSV) e nada deve ser tocado.
 * Regime que não é Simples força "Anexo IV" falso.
 */
export function lerFolhaDaUnidade(
  form: { get(name: string): FormDataEntryValue | null; has(name: string): boolean },
): { error: string } | { colunas: ColunasFolhaUJ } | null {
  if (!form.has(CAMPOS_FOLHA_UJ.regime)) return null

  const regimeBruto = String(form.get(CAMPOS_FOLHA_UJ.regime) ?? '')
  const pontos = {
    inss: lerPontos(form.get(CAMPOS_FOLHA_UJ.inss)),
    ratFap: lerPontos(form.get(CAMPOS_FOLHA_UJ.ratFap)),
    terceiros: lerPontos(form.get(CAMPOS_FOLHA_UJ.terceiros)),
    fgts: lerPontos(form.get(CAMPOS_FOLHA_UJ.fgts)),
  }
  const invalido = (Object.keys(pontos) as (keyof typeof pontos)[]).find(k => Number.isNaN(pontos[k]))
  if (invalido) return { error: 'Alíquota inválida — use só números, em pontos percentuais (ex.: 5,8).' }

  const parsed = unidadeJuridicaFolhaSchema.safeParse({
    regime: regimeBruto === '' ? null : regimeBruto,
    anexoIV: regimeBruto === 'simples' && form.get(CAMPOS_FOLHA_UJ.anexoIV) !== null,
    ...pontos,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const p = paraParametrosUJ(parsed.data)
  return {
    colunas: {
      regimeTributario: p.regime,
      simplesAnexoIv: p.regime === 'simples' ? p.anexoIV : false,
      aliquotaInssPatronal: fracaoParaTexto(p.inss),
      aliquotaRatFap: fracaoParaTexto(p.ratFap),
      aliquotaTerceiros: fracaoParaTexto(p.terceiros),
      aliquotaFgts: fracaoParaTexto(p.fgts),
    },
  }
}

/** Compara as colunas novas com as gravadas (as alíquotas numericamente). */
export function folhaMudou(
  novas: ColunasFolhaUJ,
  atuais: { regimeTributario: string | null; simplesAnexoIv: boolean; aliquotaInssPatronal: string; aliquotaRatFap: string; aliquotaTerceiros: string; aliquotaFgts: string },
): boolean {
  return novas.regimeTributario !== atuais.regimeTributario
    || novas.simplesAnexoIv !== atuais.simplesAnexoIv
    || Number(novas.aliquotaInssPatronal) !== Number(atuais.aliquotaInssPatronal)
    || Number(novas.aliquotaRatFap) !== Number(atuais.aliquotaRatFap)
    || Number(novas.aliquotaTerceiros) !== Number(atuais.aliquotaTerceiros)
    || Number(novas.aliquotaFgts) !== Number(atuais.aliquotaFgts)
}

/** Fração do banco → pontos como texto, para o formulário ("0.058000" → "5.8", "0.037035" → "3.7035"). */
const fracaoParaPontosTexto = (v: string) => String(Math.round(Number(v) * 1e6) / 1e4)

/** Os valores dos campos para preencher o formulário de edição. */
export function valoresDeFolhaParaForm(u: {
  regimeTributario: string | null; simplesAnexoIv: boolean
  aliquotaInssPatronal: string; aliquotaRatFap: string; aliquotaTerceiros: string; aliquotaFgts: string
}): Record<string, string> {
  return {
    [CAMPOS_FOLHA_UJ.regime]: u.regimeTributario ?? '',
    [CAMPOS_FOLHA_UJ.anexoIV]: u.simplesAnexoIv ? 'true' : 'false',
    [CAMPOS_FOLHA_UJ.inss]: fracaoParaPontosTexto(u.aliquotaInssPatronal),
    [CAMPOS_FOLHA_UJ.ratFap]: fracaoParaPontosTexto(u.aliquotaRatFap),
    [CAMPOS_FOLHA_UJ.terceiros]: fracaoParaPontosTexto(u.aliquotaTerceiros),
    [CAMPOS_FOLHA_UJ.fgts]: fracaoParaPontosTexto(u.aliquotaFgts),
  }
}
