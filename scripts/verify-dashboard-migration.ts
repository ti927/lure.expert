// Fase 1.3 — as duas funções do dashboard passaram a usar o motor.
// A pergunta é uma só: elas devolvem exatamente o mesmo que antes?
//
// O SQL de referência é cópia literal do que estava em src/server/dashboard.ts
// antes da migração (recuperável com `git show 70edfc5:src/server/dashboard.ts`).
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { runQuery } from '@/lib/query/engine'
import { scopeFromJob } from '@/lib/query/scope'
import { withSubtotals } from '@/lib/query/derive'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

const TIPOS_SAIDA = `'deducoes_tributarias','deducoes_operacionais','cpv','sga','resultado_financeiro','ir','emprestimos_amortizacoes','investimentos_retiradas'`

async function main() {
  // A organizacao com mais SAIDAS -- a com mais lancamentos (Vieira Pisos) e
  // 100% inflow, e o teste passaria comparando dois conjuntos vazios.
  const [{ org }] = await db.execute<{ org: string }>(sql`
    SELECT organization_id::text AS org FROM transaction_lines
    WHERE direction = 'outflow' AND status NOT IN ('pending','duplicate')
    GROUP BY organization_id ORDER BY COUNT(*) DESC LIMIT 1`)
  const scope = scopeFromJob(org)

  // Um mês que tenha movimento de saída, senão os dois lados dão vazio e o
  // teste passa sem provar nada.
  const [mes] = await db.execute<{ m: string; n: number }>(sql`
    SELECT TO_CHAR(DATE_TRUNC('month', COALESCE(effective_date, date)::date), 'YYYY-MM') AS m,
           COUNT(*)::int AS n
    FROM transaction_lines WHERE organization_id = ${org}::uuid AND direction = 'outflow'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 1`)

  const alvo = mes?.m ?? (await db.execute<{ m: string }>(sql`
    SELECT TO_CHAR(DATE_TRUNC('month', MAX(date)::date), 'YYYY-MM') AS m
    FROM transactions WHERE organization_id = ${org}::uuid`))[0].m

  const curFrom = `${alvo}-01`
  const [{ fim }] = await db.execute<{ fim: string }>(sql`
    SELECT (DATE_TRUNC('month', ${curFrom}::date) + INTERVAL '1 month - 1 day')::date::text AS fim`)
  console.log(`Organização ${org.slice(0, 8)}…  mês de referência ${alvo} (${curFrom} a ${fim})`)
  console.log(`Lançamentos de saída no mês: ${mes?.n ?? 0}\n`)

  // ── 1. getTopExpenseCategories ──────────────────────────────────────────
  const refTop = await db.execute<{ cat_id: string; total: string; tx_count: string }>(sql`
    SELECT c.id::text AS cat_id,
           SUM(t.amount::numeric)::text AS total,
           COUNT(*)::text               AS tx_count
    FROM transactions t
    JOIN categories c      ON t.category_id = c.id
    LEFT JOIN categories p ON c.parent_id   = p.id
    WHERE t.organization_id = ${org}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND t.direction = 'outflow'
      AND COALESCE(t.effective_date, t.date)::date >= ${curFrom}::date
      AND COALESCE(t.effective_date, t.date)::date <= ${fim}::date
      AND c.type IN (${sql.raw(TIPOS_SAIDA)})
      AND COALESCE(c.hide_in_cashflow, false) = false
      AND COALESCE(p.hide_in_cashflow, false) = false   -- herda do pai (26/ago)
    GROUP BY c.id, c.name, c.code, c.type, p.id, p.name, p.code
    ORDER BY SUM(t.amount::numeric) DESC
    LIMIT 5`)

  const novoTop = await runQuery(scope, {
    fonte: 'realizado', medidas: ['saidas', 'contagem'], agruparPor: ['categoria'],
    periodo: { tipo: 'intervalo', de: curFrom, ate: fim, regime: 'caixa' },
    filtros: {
      direcao: 'outflow',
      tiposDeCategoria: TIPOS_SAIDA.replace(/'/g, '').split(','),
      visibilidade: 'caixa', excluirBalanco: true,
    },
    ordenarPor: [{ por: 'saidas', direcao: 'desc' }], limite: 5,
  })

  const mesmaOrdem = refTop.every((r, i) => novoTop.linhas[i]?.chaves[0].id === r.cat_id)
  const mesmosValores = refTop.every((r, i) =>
    Math.abs((novoTop.linhas[i]?.medidas.saidas ?? -1) - Number(r.total)) < 0.005)
  t(refTop.length === novoTop.linhas.length && mesmaOrdem && mesmosValores,
    `Top ${refTop.length} despesas: mesma ordem e mesmos valores`)
  refTop.forEach((r, i) => {
    const n = novoTop.linhas[i]
    console.log(`  ${(n?.chaves[0].rotulo ?? '?').padEnd(32)} antes ${Number(r.total).toFixed(2).padStart(12)}  agora ${(n?.medidas.saidas ?? 0).toFixed(2).padStart(12)}   contagem ${r.tx_count} → ${n?.medidas.contagem}`)
  })

  // ── 2. getCashFlowChart ─────────────────────────────────────────────────
  const [{ ini90 }] = await db.execute<{ ini90: string }>(sql`
    SELECT (${fim}::date - INTERVAL '89 days')::date::text AS ini90`)

  const refFluxo = await db.execute<{ date: string; inflow: string; outflow: string }>(sql`
    SELECT COALESCE(t.effective_date, t.date)::date::text AS date,
           COALESCE(SUM(CASE WHEN t.direction = 'inflow'  THEN t.amount::numeric ELSE 0 END), 0)::text AS inflow,
           COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric ELSE 0 END), 0)::text AS outflow
    FROM transactions t
    WHERE t.organization_id = ${org}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND COALESCE(t.effective_date, t.date)::date >= ${ini90}::date
      AND COALESCE(t.effective_date, t.date)::date <= ${fim}::date
    GROUP BY COALESCE(t.effective_date, t.date)::date
    ORDER BY 1 ASC`)

  const novoFluxo = await runQuery(scope, {
    fonte: 'realizado', medidas: ['entradas', 'saidas'], agruparPor: ['dia'],
    periodo: { tipo: 'intervalo', de: ini90, ate: fim, regime: 'caixa' },
    filtros: { excluirBalanco: false, visibilidade: 'todas' },
    ordenarPor: [{ por: 'dia', direcao: 'asc' }], limite: 500,
  })

  let difFluxo = 0
  refFluxo.forEach((r, i) => {
    const n = novoFluxo.linhas[i]
    const bate = n?.chaves[0].id === r.date
      && Math.abs(n.medidas.entradas - Number(r.inflow)) < 0.005
      && Math.abs(n.medidas.saidas - Number(r.outflow)) < 0.005
    if (!bate) {
      difFluxo++
      if (difFluxo <= 3) console.log(`  divergente ${r.date}: antes ${r.inflow}/${r.outflow} agora ${n?.medidas.entradas}/${n?.medidas.saidas}`)
    }
  })
  t(difFluxo === 0 && refFluxo.length === novoFluxo.linhas.length,
    `Fluxo diário: ${refFluxo.length} dias, todos idênticos (entrada e saída)`)

  // ── 3. A cascata do P&L pelo motor ──────────────────────────────────────
  const [faixa] = await db.execute<{ de: string; ate: string }>(sql`
    SELECT MIN(date)::text AS de, MAX(date)::text AS ate FROM transactions
    WHERE organization_id = ${org}::uuid`)

  const porTipo = await runQuery(scope, {
    fonte: 'realizado', medidas: ['valor_liquido'], agruparPor: ['tipo', 'mes'],
    periodo: { tipo: 'intervalo', de: faixa.de, ate: faixa.ate, regime: 'competencia' },
    filtros: { excluirBalanco: true, visibilidade: 'dre' }, limite: 500,
  })
  const cascata = withSubtotals(porTipo)

  // Referência: mesma cascata calculada direto do SQL da DRE.
  const refTipos = await db.execute<{ tipo: string; mes: string; v: string }>(sql`
    SELECT c.type AS tipo,
           TO_CHAR(DATE_TRUNC('month', t.date::date), 'YYYY-MM') AS mes,
           COALESCE(SUM(CASE WHEN t.direction='inflow' THEN t.amount::numeric ELSE -t.amount::numeric END),0)::text AS v
    FROM transaction_lines t
    JOIN categories c ON t.category_id = c.id
    JOIN categories p ON c.parent_id   = p.id
    WHERE t.organization_id = ${org}::uuid
      AND t.status NOT IN ('pending','duplicate')
      AND t.date::date >= ${faixa.de}::date AND t.date::date <= ${faixa.ate}::date
      AND c.type NOT IN ('ativo_circulante','ativo_nao_circulante','passivo_circulante','passivo_nao_circulante','patrimonio_liquido')
      AND c.hide_in_dre = false
        AND p.hide_in_dre = false   -- herda do pai (26/ago); aqui por JOIN, na implementação por EXISTS
    GROUP BY 1, 2`)

  const receitaRef = new Map<string, number>()
  for (const r of refTipos) {
    if (r.tipo === 'receita_operacional') {
      receitaRef.set(r.mes, (receitaRef.get(r.mes) ?? 0) + Number(r.v))
    }
  }
  let cascataDif = 0
  for (const c of cascata) {
    const esperado = receitaRef.get(c.month) ?? 0
    if (Math.abs(c.receitaBruta - esperado) > 0.005) cascataDif++
  }
  t(cascataDif === 0 && cascata.length > 0,
    `cascata do P&L pelo motor: ${cascata.length} meses, receita bruta conferindo em todos`)
  const comLucro = cascata.filter(c => c.lucroLiquido !== 0)
  console.log(`  (${comLucro.length} meses com lucro líquido diferente de zero)`)

  console.log(`\n${ok} ok, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(e => { console.error('ERRO:', e); process.exit(1) })
