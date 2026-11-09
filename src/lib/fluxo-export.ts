// A exportação do /fluxo para Excel.
//
// Duas abas:
//
// - "Lançamentos": uma linha por lançamento — ou por PARTE, quando rateado,
//   que é como o /fluxo soma (lê `transaction_lines`). Entram também os
//   lançamentos que a tela deixa de fora no período (sem natureza, natureza de
//   Balanço, natureza oculta no Fluxo, pendente/duplicado), marcados na coluna
//   "Entra no fluxo?" com o motivo. Filtrando por "Sim", soma o que a tela soma.
// - "Fluxo de caixa": a tabela da tela remontada com SOMASES sobre a primeira
//   aba, para quem quer ver (e repetir) como o fluxo é montado.
//
// O período e os filtros de dimensão são os da tela. A regra de "entra no
// fluxo" é a de `getFluxoMensalData` (server/fluxo-mensal.ts); se uma mudar, a
// outra tem de mudar junto — `scripts/verify-fluxo-export.ts` concilia as duas.
//
// Fora de `'use server'` para ser exercitável por script, como o resto de /lib.

import { sql } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { db } from '@/db'
import { BP_TYPES, DRE_TYPE_LABELS, type DreFilters } from '@/lib/dre-types'
import { BP_TYPE_LABELS } from '@/lib/bp-types'
import { dimensionFilters, colunasDoRateioSql } from '@/lib/sql-dimensions'
import { rotuloDaConta } from '@/lib/import-contract'
import { generateMonthRange } from '@/lib/dre-calc'

type Exec = Pick<typeof db, 'execute'>

// ─── Leitura ──────────────────────────────────────────────────────────────────

export interface LinhaExportada {
  transactionId:   string
  dataCaixa:       string        // YYYY-MM-DD
  mesCaixa:        string        // YYYY-MM
  dataCompetencia: string        // YYYY-MM-DD
  descricao:       string
  conta:           string | null
  sentido:         'Entrada' | 'Saída'
  valor:           number        // positivo
  valorNoFluxo:    number        // + entrada, − saída
  tipo:            string | null
  codigoPai:       string | null
  naturezaPai:     string | null // "código – nome"
  codigoNatureza:  string | null
  natureza:        string | null // "código – nome", a chave do SOMASES
  secao:           'OPEX' | 'CAPEX' | null
  centroDeCusto:   string | null
  unidadeDeNegocio: string | null
  entidadeJuridica: string | null
  contato:         string | null
  rateio:          string | null // "2/3"
  valorDoLancamento: number | null // o valor inteiro, só no rateado
  entraNoFluxo:    boolean
  motivo:          string | null
  status:          string
}

const MOTIVO_STATUS: Record<string, string> = {
  pending:   'Pendente no banco',
  duplicate: 'Duplicado',
}

const TIPO_LABEL: Record<string, string> = { ...DRE_TYPE_LABELS, ...BP_TYPE_LABELS }

const comCodigo = (codigo: string | null, nome: string | null) =>
  nome == null ? null : codigo ? `${codigo} – ${nome}` : nome

/**
 * Os lançamentos do período pela data de CAIXA, com os filtros de dimensão da
 * tela. Uma linha por parte de rateio.
 */
export async function lerLinhasParaExportar(
  organizationId: string,
  filters: DreFilters,
  exec: Exec = db,
): Promise<LinhaExportada[]> {
  type Row = {
    transaction_id: string
    data_caixa: string
    data_competencia: string
    description: string | null
    account_name: string | null
    account_type: string | null
    account_number: string | null
    direction: string
    amount: string
    status: string
    cat_id: string | null
    cat_code: string | null
    cat_name: string | null
    cat_type: string | null
    cat_parent_id: string | null
    cat_hide: boolean | null
    pai_code: string | null
    pai_name: string | null
    pai_hide: boolean | null
    pai_opex_capex: string | null
    cc_name: string | null
    bu_name: string | null
    le_name: string | null
    contato: string | null
    allocation_sequence: number | null
    allocation_count: string | number | null
    transaction_amount: string | null
  }

  const result = await exec.execute<Row>(sql`
    SELECT
      t.transaction_id::text                                  AS transaction_id,
      COALESCE(t.effective_date, t.date)::date::text           AS data_caixa,
      t.date::date::text                                       AS data_competencia,
      t.description,
      t.account_name, t.account_type, t.account_number,
      t.direction,
      t.amount::text                                           AS amount,
      t.status,
      c.id::text            AS cat_id,
      c.code                AS cat_code,
      c.name                AS cat_name,
      c.type                AS cat_type,
      c.parent_id::text     AS cat_parent_id,
      c.hide_in_cashflow    AS cat_hide,
      p.code                AS pai_code,
      p.name                AS pai_name,
      p.hide_in_cashflow    AS pai_hide,
      p.opex_capex          AS pai_opex_capex,
      cc.name               AS cc_name,
      bu.name               AS bu_name,
      le.name               AS le_name,
      COALESCE(NULLIF(ct.trade_name, ''), ct.name) AS contato,
      ${colunasDoRateioSql()}
    FROM transaction_lines t
    LEFT JOIN categories     c  ON c.id  = t.category_id
    LEFT JOIN categories     p  ON p.id  = c.parent_id
    LEFT JOIN cost_centers   cc ON cc.id = t.cost_center_id
    LEFT JOIN business_units bu ON bu.id = t.business_unit_id
    LEFT JOIN legal_entities le ON le.id = t.legal_entity_id
    LEFT JOIN contacts       ct ON ct.id = t.contact_id
    WHERE t.organization_id = ${organizationId}::uuid
      AND COALESCE(t.effective_date, t.date)::date >= ${filters.from}::date
      AND COALESCE(t.effective_date, t.date)::date <= ${filters.to}::date
      ${dimensionFilters('t', filters)}
    ORDER BY COALESCE(t.effective_date, t.date), t.date, t.description, t.transaction_id, t.sequence
  `)

  const bp = new Set<string>(BP_TYPES)

  return result.map(r => {
    // A mesma regra, na mesma ordem de perguntas, de getFluxoMensalData.
    let motivo: string | null = null
    if (r.status === 'pending' || r.status === 'duplicate') motivo = MOTIVO_STATUS[r.status]
    else if (!r.cat_id)                     motivo = 'Sem natureza'
    else if (r.cat_type && bp.has(r.cat_type)) motivo = 'Natureza de Balanço'
    else if (!r.cat_parent_id || !r.pai_code) motivo = 'Natureza sem natureza pai'
    else if (r.cat_hide)                    motivo = 'Natureza oculta no Fluxo'
    else if (r.pai_hide)                    motivo = 'Natureza pai oculta no Fluxo'

    const valor = Number(r.amount)
    const entrada = r.direction === 'inflow'
    const count = r.allocation_count == null ? null : Number(r.allocation_count)

    return {
      transactionId:   r.transaction_id,
      dataCaixa:       r.data_caixa,
      mesCaixa:        r.data_caixa.slice(0, 7),
      dataCompetencia: r.data_competencia,
      descricao:       r.description ?? '',
      conta:           rotuloDaConta({ accountName: r.account_name, accountType: r.account_type, accountNumber: r.account_number }),
      sentido:         entrada ? 'Entrada' : 'Saída',
      valor,
      valorNoFluxo:    entrada ? valor : -valor,
      tipo:            r.cat_type ? (TIPO_LABEL[r.cat_type] ?? r.cat_type) : null,
      codigoPai:       r.pai_code,
      naturezaPai:     comCodigo(r.pai_code, r.pai_name),
      codigoNatureza:  r.cat_code,
      natureza:        comCodigo(r.cat_code, r.cat_name),
      // A seção mora na natureza PAI, como na tela (opexCapex !== 'capex' → OPEX).
      secao:           r.pai_code ? (r.pai_opex_capex === 'capex' ? 'CAPEX' : 'OPEX') : null,
      centroDeCusto:   r.cc_name,
      unidadeDeNegocio: r.bu_name,
      entidadeJuridica: r.le_name,
      contato:         r.contato,
      rateio:          r.allocation_sequence != null && count ? `${r.allocation_sequence}/${count}` : null,
      valorDoLancamento: r.transaction_amount == null ? null : Number(r.transaction_amount),
      entraNoFluxo:    motivo == null,
      motivo,
      status:          r.status,
    }
  })
}

// ─── A matriz (o que a aba "Fluxo de caixa" mostra) ───────────────────────────

export interface NaturezaDaMatriz {
  codigo: string
  rotulo: string                       // "código – nome", igual à coluna Natureza
  porMes: Record<string, number>       // YYYY-MM → valor no fluxo
}

export interface PaiDaMatriz {
  codigo: string
  rotulo: string
  secao:  'OPEX' | 'CAPEX'
  filhos: NaturezaDaMatriz[]
}

/** Agrupa as linhas que entram no fluxo na árvore pai → filho, ordenada como a tela. */
export function montarMatriz(linhas: LinhaExportada[]): PaiDaMatriz[] {
  const pais = new Map<string, PaiDaMatriz & { mapa: Map<string, NaturezaDaMatriz> }>()
  for (const l of linhas) {
    if (!l.entraNoFluxo) continue
    const kp = l.codigoPai!
    let pai = pais.get(kp)
    if (!pai) {
      pai = { codigo: kp, rotulo: l.naturezaPai!, secao: l.secao!, filhos: [], mapa: new Map() }
      pais.set(kp, pai)
    }
    const kf = l.codigoNatureza!
    let filho = pai.mapa.get(kf)
    if (!filho) {
      filho = { codigo: kf, rotulo: l.natureza!, porMes: {} }
      pai.mapa.set(kf, filho)
    }
    filho.porMes[l.mesCaixa] = (filho.porMes[l.mesCaixa] ?? 0) + l.valorNoFluxo
  }
  // Mesma ordenação da tela: localeCompare do código (texto, não número).
  return Array.from(pais.values())
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
    .map(({ mapa, ...p }) => ({
      ...p,
      filhos: Array.from(mapa.values()).sort((a, b) => a.codigo.localeCompare(b.codigo)),
    }))
}

// ─── A planilha ───────────────────────────────────────────────────────────────

const ABA_LANC  = 'Lançamentos'
const ABA_FLUXO = 'Fluxo de caixa'
const FMT_VALOR = '#,##0.00;[Red]-#,##0.00'
const FMT_DATA  = 'dd/mm/yyyy'
const FMT_MES   = 'mmm/yy'

/** Serial de data do Excel (sistema 1900), sem passar por fuso horário. */
function serial(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return (Date.UTC(y, m - 1, d || 1) - Date.UTC(1899, 11, 30)) / 86_400_000
}

// As colunas da aba de lançamentos, na ordem. `chave` dá a letra usada nas fórmulas.
const COLUNAS = [
  { chave: 'dataCaixa',        titulo: 'Data de caixa',        largura: 12 },
  { chave: 'mesCaixa',         titulo: 'Mês de caixa',         largura: 10 },
  { chave: 'dataCompetencia',  titulo: 'Data de competência',  largura: 12 },
  { chave: 'descricao',        titulo: 'Descrição',            largura: 44 },
  { chave: 'conta',            titulo: 'Conta',                largura: 30 },
  { chave: 'sentido',          titulo: 'Sentido',              largura: 9 },
  { chave: 'valor',            titulo: 'Valor',                largura: 14 },
  { chave: 'valorNoFluxo',     titulo: 'Valor no fluxo',       largura: 14 },
  { chave: 'tipo',             titulo: 'Tipo',                 largura: 26 },
  { chave: 'naturezaPai',      titulo: 'Natureza pai',         largura: 34 },
  { chave: 'natureza',         titulo: 'Natureza',             largura: 40 },
  { chave: 'secao',            titulo: 'Seção',                largura: 8 },
  { chave: 'centroDeCusto',    titulo: 'Centro de custo',      largura: 20 },
  { chave: 'unidadeDeNegocio', titulo: 'Unidade de negócio',   largura: 20 },
  { chave: 'entidadeJuridica', titulo: 'Entidade jurídica',    largura: 20 },
  { chave: 'contato',          titulo: 'Contato',              largura: 24 },
  { chave: 'rateio',           titulo: 'Rateio (parte)',       largura: 10 },
  { chave: 'valorDoLancamento', titulo: 'Valor do lançamento (rateado)', largura: 16 },
  { chave: 'entraNoFluxo',     titulo: 'Entra no fluxo?',      largura: 10 },
  { chave: 'motivo',           titulo: 'Motivo de ficar fora', largura: 26 },
  { chave: 'status',           titulo: 'Status',               largura: 10 },
  { chave: 'transactionId',    titulo: 'Id do lançamento',     largura: 38 },
] as const

type Chave = (typeof COLUNAS)[number]['chave']
const letra = (chave: Chave) => XLSX.utils.encode_col(COLUNAS.findIndex(c => c.chave === chave))

/** Coluna inteira da aba de lançamentos, absoluta: 'Lançamentos'!$H:$H */
const ref = (chave: Chave) => `'${ABA_LANC}'!$${letra(chave)}:$${letra(chave)}`

/** Texto como critério de SOMASES: aspas dobradas e curingas (* ? ~) escapados. */
function criterioLiteral(texto: string): string {
  return `"${texto.replace(/[~*?]/g, m => `~${m}`).replace(/"/g, '""')}"`
}

type Celula = XLSX.CellObject

function celulaDaLinha(l: LinhaExportada, chave: Chave): Celula | null {
  switch (chave) {
    case 'dataCaixa':        return { t: 'n', v: serial(l.dataCaixa), z: FMT_DATA }
    case 'mesCaixa':         return { t: 'n', v: serial(l.mesCaixa + '-01'), z: FMT_MES }
    case 'dataCompetencia':  return { t: 'n', v: serial(l.dataCompetencia), z: FMT_DATA }
    case 'valor':            return { t: 'n', v: l.valor, z: FMT_VALOR }
    case 'valorNoFluxo':     return { t: 'n', v: l.valorNoFluxo, z: FMT_VALOR }
    case 'valorDoLancamento':
      return l.valorDoLancamento == null ? null : { t: 'n', v: l.valorDoLancamento, z: FMT_VALOR }
    case 'entraNoFluxo':     return { t: 's', v: l.entraNoFluxo ? 'Sim' : 'Não' }
    case 'status':           return { t: 's', v: l.status === 'confirmed' ? 'Confirmado' : (MOTIVO_STATUS[l.status] ?? l.status) }
    default: {
      const v = l[chave]
      return v == null || v === '' ? null : { t: 's', v: String(v) }
    }
  }
}

function abaDeLancamentos(linhas: LinhaExportada[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  COLUNAS.forEach((c, i) => { ws[XLSX.utils.encode_cell({ r: 0, c: i })] = { t: 's', v: c.titulo } })
  linhas.forEach((l, r) => {
    COLUNAS.forEach((c, i) => {
      const cel = celulaDaLinha(l, c.chave)
      if (cel) ws[XLSX.utils.encode_cell({ r: r + 1, c: i })] = cel
    })
  })
  const ultima = XLSX.utils.encode_cell({ r: Math.max(linhas.length, 1), c: COLUNAS.length - 1 })
  ws['!ref'] = `A1:${ultima}`
  ws['!autofilter'] = { ref: `A1:${ultima}` }
  ws['!cols'] = COLUNAS.map(c => ({ wch: c.largura }))
  return ws
}

function abaDoFluxo(matriz: PaiDaMatriz[], meses: string[], titulo: string): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  const put = (r: number, c: number, cel: Celula) => { ws[XLSX.utils.encode_cell({ r, c })] = cel }
  const addr = (r: number, c: number) => XLSX.utils.encode_cell({ r, c })
  const nCols = meses.length + 2 // natureza + meses + total
  const colTotal = meses.length + 1

  put(0, 0, { t: 's', v: titulo })
  put(1, 0, { t: 's', v: 'Valores pela data de caixa. Cada célula de natureza é um SOMASES sobre a aba "Lançamentos": coluna "Valor no fluxo", filtrando Natureza, Mês de caixa e "Entra no fluxo?" = Sim.' })

  const H = 3 // linha do cabeçalho
  put(H, 0, { t: 's', v: 'Natureza' })
  meses.forEach((m, i) => put(H, i + 1, { t: 'n', v: serial(m + '-01'), z: FMT_MES }))
  put(H, colTotal, { t: 's', v: 'Total' })

  let r = H + 1
  const linhasDeSecao: Record<'OPEX' | 'CAPEX', number[]> = { OPEX: [], CAPEX: [] }
  const totaisDaSecao: Partial<Record<'OPEX' | 'CAPEX', { linha: number; porMes: number[] }>> = {}

  const somaLinha = (linha: number, porMes: number[]) => {
    const v = porMes.reduce((s, x) => s + x, 0)
    put(linha, colTotal, { t: 'n', f: `SUM(${addr(linha, 1)}:${addr(linha, meses.length)})`, v, z: FMT_VALOR })
  }

  for (const secao of ['OPEX', 'CAPEX'] as const) {
    const pais = matriz.filter(p => p.secao === secao)
    if (pais.length === 0) continue
    const porMesSecao = meses.map(() => 0)

    for (const pai of pais) {
      const linhaPai = r++
      const porMesPai = meses.map(() => 0)
      put(linhaPai, 0, { t: 's', v: pai.rotulo })
      const primeiroFilho = r

      for (const filho of pai.filhos) {
        const linha = r++
        put(linha, 0, { t: 's', v: `    ${filho.rotulo}` })
        // O rótulo da célula tem recuo; o critério usa o texto exato da coluna Natureza.
        const crit = criterioLiteral(filho.rotulo)
        const porMes = meses.map((m, i) => {
          const v = filho.porMes[m] ?? 0
          porMesPai[i] += v
          put(linha, i + 1, {
            t: 'n', v, z: FMT_VALOR,
            f: `SUMIFS(${ref('valorNoFluxo')},${ref('natureza')},${crit},${ref('mesCaixa')},${addr(H, i + 1).replace(/(\d+)$/, '$$$1')},${ref('entraNoFluxo')},"Sim")`,
          })
          return v
        })
        somaLinha(linha, porMes)
      }

      const ultimoFilho = r - 1
      meses.forEach((_, i) => {
        porMesSecao[i] += porMesPai[i]
        put(linhaPai, i + 1, { t: 'n', v: porMesPai[i], z: FMT_VALOR, f: `SUM(${addr(primeiroFilho, i + 1)}:${addr(ultimoFilho, i + 1)})` })
      })
      somaLinha(linhaPai, porMesPai)
      linhasDeSecao[secao].push(linhaPai)
    }

    const linhaTotal = r++
    put(linhaTotal, 0, { t: 's', v: `Total ${secao}` })
    meses.forEach((_, i) => {
      const f = linhasDeSecao[secao].map(l => addr(l, i + 1)).join('+')
      put(linhaTotal, i + 1, { t: 'n', v: porMesSecao[i], z: FMT_VALOR, f })
    })
    somaLinha(linhaTotal, porMesSecao)
    totaisDaSecao[secao] = { linha: linhaTotal, porMes: porMesSecao }
    r++ // linha em branco entre as seções
  }

  const linhaLiquido = r
  put(linhaLiquido, 0, { t: 's', v: 'Total líquido' })
  const secoes = Object.values(totaisDaSecao)
  const porMesLiquido = meses.map((_, i) => secoes.reduce((s, x) => s + x!.porMes[i], 0))
  meses.forEach((_, i) => {
    const f = secoes.length ? secoes.map(x => addr(x!.linha, i + 1)).join('+') : '0'
    put(linhaLiquido, i + 1, { t: 'n', v: porMesLiquido[i], z: FMT_VALOR, f })
  })
  somaLinha(linhaLiquido, porMesLiquido)

  ws['!ref'] = `A1:${addr(linhaLiquido, nCols - 1)}`
  ws['!cols'] = [{ wch: 48 }, ...meses.map(() => ({ wch: 13 })), { wch: 15 }]
  return ws
}

export interface ExportacaoDoFluxo {
  arquivo:  Buffer
  nome:     string
  linhas:   number
}

export function montarPlanilhaDoFluxo(
  linhas: LinhaExportada[],
  filters: DreFilters,
  nomeDaOrganizacao: string,
): ExportacaoDoFluxo {
  const meses = generateMonthRange(filters.from, filters.to)
  const matriz = montarMatriz(linhas)
  const fmt = (iso: string) => iso.split('-').reverse().join('/')
  const filtrado = !!(filters.costCenterIds?.length || filters.businessUnitIds?.length || filters.legalEntityIds?.length)
  const titulo = `Fluxo de caixa — ${nomeDaOrganizacao} — ${fmt(filters.from)} a ${fmt(filters.to)}${filtrado ? ' (com filtros de dimensão)' : ''}`

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, abaDoFluxo(matriz, meses, titulo), ABA_FLUXO)
  XLSX.utils.book_append_sheet(wb, abaDeLancamentos(linhas), ABA_LANC)
  const arquivo = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const slug = nomeDaOrganizacao
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const nome = `fluxo-de-caixa_${slug}_${filters.from.slice(0, 7)}_a_${filters.to.slice(0, 7)}.xlsx`

  return { arquivo, nome, linhas: linhas.length }
}

export async function exportarFluxo(
  organizationId: string,
  filters: DreFilters,
  exec: Exec = db,
): Promise<ExportacaoDoFluxo> {
  const [linhas, org] = await Promise.all([
    lerLinhasParaExportar(organizationId, filters, exec),
    exec.execute<{ name: string }>(sql`SELECT name FROM organizations WHERE id = ${organizationId}::uuid`),
  ])
  return montarPlanilhaDoFluxo(linhas, filters, org[0]?.name ?? 'organizacao')
}
