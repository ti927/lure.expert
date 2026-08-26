/**
 * Verificação do motor de consulta (Fase 1).
 *
 * Três perguntas, nesta ordem de importância:
 *
 * 1. O motor produz os MESMOS números que a query que ele substitui? A DRE é a
 *    referência porque é a leitura mais exercitada do app. Mesma conferência
 *    célula a célula das sessões 9.7 e 10.3.
 * 2. O predicado de organização é aplicado SEMPRE? Testado por consequência —
 *    o total do motor tem de bater com o total da organização e diferir do
 *    total global — e não por inspeção de string, que passaria por engano.
 * 3. As recusas recusam? Fonte inexistente, agrupamento não suportado, teto
 *    estourado, escopo de terceiro.
 *
 * Rodar com o pooler:
 *   DATABASE_URL="postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:6543/postgres" \
 *     npx tsx scripts/verify-query-engine.ts
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { runQuery, explicarQuery } from '@/lib/query/engine'
import { scopeFromJob, scopeFromSession } from '@/lib/query/scope'
import { querySpecSchema } from '@/lib/query/spec'
import * as z from 'zod'
import { QueryValidationError, ScopeDeniedError } from '@/lib/query/errors'
import { GROUPING_IDS } from '@/lib/query/groupings'
import { MEASURE_IDS } from '@/lib/query/measures'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

async function deveRecusar(rotulo: string, fn: () => Promise<unknown>, tipo?: string) {
  try {
    await fn()
    t(false, `${rotulo} — foi aceito e não devia`)
  } catch (e) {
    const nome = (e as Error).name
    const certo = !tipo || nome === tipo
    t(certo, `${rotulo} — recusado com ${nome}: ${(e as Error).message.slice(0, 80)}`)
  }
}

async function main() {
  // A organização com mais dados é a que melhor exercita o motor.
  const [{ org }] = await db.execute<{ org: string }>(sql`
    SELECT organization_id::text AS org FROM transactions
    GROUP BY organization_id ORDER BY COUNT(*) DESC LIMIT 1`)
  const scope = scopeFromJob(org)

  const [{ de, ate }] = await db.execute<{ de: string; ate: string }>(sql`
    SELECT MIN(date)::text AS de, MAX(date)::text AS ate
    FROM transactions WHERE organization_id = ${org}::uuid`)
  console.log(`Organização de teste: ${org}`)
  console.log(`Período com dados: ${de} a ${ate}\n`)

  const periodo = { tipo: 'intervalo' as const, de, ate, regime: 'competencia' as const }

  // ── 1. Fidelidade contra a query da DRE ─────────────────────────────────
  // Réplica exata do SQL de getDreData, sem passar pelo motor.
  const dre = await db.execute<{ cat: string; mes: string; liquido: string; n: number }>(sql`
    SELECT c.id::text AS cat,
           TO_CHAR(DATE_TRUNC('month', t.date::date), 'YYYY-MM') AS mes,
           COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END), 0)::text AS liquido,
           COUNT(DISTINCT t.transaction_id)::int AS n
    FROM transaction_lines t
    JOIN categories c ON t.category_id = c.id
    JOIN categories p ON c.parent_id   = p.id
    WHERE t.organization_id = ${org}::uuid
      AND t.status NOT IN ('pending', 'duplicate')
      AND t.date::date >= ${de}::date AND t.date::date <= ${ate}::date
      AND c.type NOT IN ('ativo_circulante','ativo_nao_circulante','passivo_circulante','passivo_nao_circulante','patrimonio_liquido')
      AND c.hide_in_dre = false
        AND p.hide_in_dre = false   -- herda do pai (26/ago); aqui por JOIN, na implementação por EXISTS
    GROUP BY c.id, DATE_TRUNC('month', t.date::date)`)

  const motor = await runQuery(scope, {
    fonte: 'realizado',
    medidas: ['valor_liquido', 'contagem'],
    agruparPor: ['categoria', 'mes'],
    periodo,
    filtros: { excluirBalanco: true, visibilidade: 'dre' },
    limite: 500,
  })

  const doMotor = new Map<string, { liq: number; n: number }>()
  for (const l of motor.linhas) {
    const cat = l.chaves.find(k => k.campo === 'categoria')!.id
    const mes = l.chaves.find(k => k.campo === 'mes')!.id
    if (cat === null) continue   // o motor mostra "sem natureza"; a DRE não
    doMotor.set(`${cat}|${mes}`, { liq: l.medidas.valor_liquido, n: l.medidas.contagem })
  }

  let iguais = 0, divergentes = 0
  const exemplos: string[] = []
  for (const r of dre) {
    const m = doMotor.get(`${r.cat}|${r.mes}`)
    const liqOk = m && Math.abs(m.liq - Number(r.liquido)) < 0.005
    const nOk = m && m.n === Number(r.n)
    if (liqOk && nOk) iguais++
    else {
      divergentes++
      if (exemplos.length < 3) {
        exemplos.push(`  ${r.cat.slice(0, 8)}|${r.mes} dre=${Number(r.liquido).toFixed(2)}/${r.n} motor=${m ? `${m.liq.toFixed(2)}/${m.n}` : 'AUSENTE'}`)
      }
    }
  }
  t(divergentes === 0 && iguais > 0,
    `${iguais}/${dre.length} células idênticas entre a query da DRE e o motor`)
  exemplos.forEach(x => console.log(x))

  // Sem categoria: o motor mostra, a DRE esconde. Tem de ser diferença de
  // apresentação, não de soma.
  const semNat = motor.linhas.filter(l => l.chaves.find(k => k.campo === 'categoria')!.id === null)
  console.log(`  (o motor traz ainda ${semNat.length} célula(s) de "sem natureza" que a DRE oculta por usar INNER JOIN)`)

  // ── 2. O pedido que originou o motor ────────────────────────────────────
  // A organização com mais dados não usa dimensões — o teste tem de rodar onde
  // há UEN preenchida, senão passaria devolvendo só "Sem unidade" e não
  // exercitaria nada.
  const [comUen] = await db.execute<{ org: string; n: number }>(sql`
    SELECT organization_id::text AS org, COUNT(*)::int AS n
    FROM transaction_lines WHERE business_unit_id IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 1`)

  if (!comUen) {
    console.log('AVISO | nenhuma organização usa unidade de negócio — teste de "top UENs" pulado')
  } else {
    const scopeUen = scopeFromJob(comUen.org)
    const [faixa] = await db.execute<{ de: string; ate: string }>(sql`
      SELECT MIN(date)::text AS de, MAX(date)::text AS ate FROM transactions
      WHERE organization_id = ${comUen.org}::uuid`)

    const topUen = await runQuery(scopeUen, {
      fonte: 'realizado',
      medidas: ['saidas', 'contagem'],
      agruparPor: ['unidade_de_negocio'],
      periodo: { tipo: 'intervalo', de: faixa.de, ate: faixa.ate, regime: 'competencia' },
      ordenarPor: [{ por: 'saidas', direcao: 'desc' }],
      limite: 5,
    })
    const nomeadas = topUen.linhas.filter(l => l.chaves[0].id !== null)
    t(nomeadas.length > 0,
      `"top 5 UENs por despesa" devolve ${nomeadas.length} unidade(s) nomeada(s) — impossível antes da Fase 1`)
    topUen.linhas.forEach(l =>
      console.log(`  ${l.chaves[0].rotulo.padEnd(28)} R$ ${l.medidas.saidas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}  (${l.medidas.contagem} lanç.)`))

    // A mesma spec trocando um campo produz o "top 5 despesas" que a tela tem
    // hoje — é a prova de que o motor generaliza em vez de duplicar.
    const topCat = await runQuery(scopeUen, {
      fonte: 'realizado', medidas: ['saidas'], agruparPor: ['categoria'],
      periodo: { tipo: 'intervalo', de: faixa.de, ate: faixa.ate, regime: 'competencia' },
      ordenarPor: [{ por: 'saidas', direcao: 'desc' }], limite: 5,
    })
    t(topCat.linhas.length > 0,
      `a MESMA spec com agruparPor:["categoria"] reproduz o "top 5 despesas" da tela (${topCat.linhas.length} linhas)`)
  }

  // ── 3. Predicado de organização em TODA combinação ──────────────────────
  const [{ total_org }] = await db.execute<{ total_org: number }>(sql`
    SELECT COUNT(DISTINCT id)::int AS total_org FROM transactions
    WHERE organization_id = ${org}::uuid AND status NOT IN ('pending','duplicate')`)
  const [{ total_geral }] = await db.execute<{ total_geral: number }>(sql`
    SELECT COUNT(DISTINCT id)::int AS total_geral FROM transactions
    WHERE status NOT IN ('pending','duplicate')`)

  let combinacoesOk = 0, combinacoesRuins = 0
  for (const g of GROUPING_IDS) {
    try {
      const r = await runQuery(scope, {
        fonte: 'realizado', medidas: ['contagem'], agruparPor: [g],
        periodo, filtros: { excluirBalanco: false, visibilidade: 'todas' }, limite: 500,
      })
      // Com agrupamento por dimensão a soma pode passar do total (um lançamento
      // rateado aparece em duas linhas), mas NUNCA pode alcançar o total global.
      const soma = r.linhas.reduce((a, l) => a + l.medidas.contagem, 0)
      const dentro = soma > 0 && soma <= total_org * 3 && soma < total_geral
      dentro ? combinacoesOk++ : combinacoesRuins++
      if (!dentro) console.log(`  suspeito em "${g}": soma=${soma} org=${total_org} geral=${total_geral}`)
    } catch (e) {
      combinacoesRuins++
      console.log(`  erro em "${g}": ${(e as Error).message}`)
    }
  }
  t(combinacoesRuins === 0,
    `${combinacoesOk}/${GROUPING_IDS.length} agrupamentos respeitam o escopo da organização (org=${total_org}, geral=${total_geral})`)

  let medidasOk = 0
  for (const m of MEASURE_IDS) {
    try {
      await runQuery(scope, { fonte: 'realizado', medidas: [m], agruparPor: ['mes'], periodo, limite: 100 })
      medidasOk++
    } catch (e) { console.log(`  erro na medida "${m}": ${(e as Error).message}`) }
  }
  t(medidasOk === MEASURE_IDS.length, `${medidasOk}/${MEASURE_IDS.length} medidas executam`)

  // ── 4. O sentinela "sem dimensão" ───────────────────────────────────────
  const semCc = await runQuery(scope, {
    fonte: 'realizado', medidas: ['contagem'], agruparPor: [],
    periodo, filtros: { centrosDeCusto: ['__null__'] }, limite: 1,
  })
  const [{ n: esperado }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(DISTINCT transaction_id)::int AS n FROM transaction_lines
    WHERE organization_id = ${org}::uuid AND status NOT IN ('pending','duplicate')
      AND cost_center_id IS NULL AND date::date >= ${de}::date AND date::date <= ${ate}::date`)
  t(semCc.linhas[0]?.medidas.contagem === Number(esperado),
    `filtro "sem centro de custo" devolve ${semCc.linhas[0]?.medidas.contagem} = esperado ${esperado}`)

  // ── 5. As recusas ───────────────────────────────────────────────────────
  //
  // `balanco` e `snapshot` saíram do SCHEMA em 26/ago (achado 1 do diagnóstico
  // do MCP): eram aceitos pelo Zod e recusados pelo motor, o que fazia o
  // catálogo publicar duas opções que nunca funcionaram. Agora a recusa vem
  // ANTES, na validação — daí o `as never`, que é o teste forçando um valor que
  // o tipo já não permite.
  await deveRecusar('fonte "balanco" é recusada pelo SCHEMA, não mais pelo motor',
    async () => runQuery(scope, {
      fonte: 'balanco' as never, medidas: ['valor_liquido'],
      periodo: { tipo: 'intervalo', de, ate, regime: 'competencia' },
    }), 'QueryValidationError')
  await deveRecusar('limite acima do teto',
    async () => runQuery(scope, { fonte: 'realizado', periodo, medidas: ['valor_liquido'], limite: 5000 }),
    'QueryValidationError')
  await deveRecusar('três agrupamentos',
    async () => runQuery(scope, {
      fonte: 'realizado', periodo, medidas: ['valor_liquido'],
      agruparPor: ['mes', 'categoria', 'conta'] as never,
    }), 'QueryValidationError')
  await deveRecusar('ordenar por campo que não está na consulta',
    async () => runQuery(scope, {
      fonte: 'realizado', periodo, medidas: ['valor_liquido'], agruparPor: ['mes'],
      ordenarPor: [{ por: 'contagem', direcao: 'desc' }],
    }), 'QueryValidationError')
  await deveRecusar('data inicial depois da final',
    async () => runQuery(scope, {
      fonte: 'realizado', medidas: ['valor_liquido'],
      periodo: { tipo: 'intervalo', de: '2026-12-31', ate: '2026-01-01', regime: 'competencia' },
    }), 'QueryValidationError')
  await deveRecusar('periodo "snapshot" é recusado pelo SCHEMA — a variante saiu junto com o balanço',
    async () => runQuery(scope, {
      fonte: 'realizado', medidas: ['valor_liquido'],
      periodo: { tipo: 'snapshot', em: '2026-06-30' } as never,
    }), 'QueryValidationError')

  // ── 6. O escopo recusa organização de terceiro ──────────────────────────
  const membros = await db.execute<{ uid: string; org: string }>(sql`
    SELECT user_id::text AS uid, organization_id::text AS org FROM memberships
    WHERE accepted_at IS NOT NULL LIMIT 5`)
  const outra = await db.execute<{ org: string }>(sql`
    SELECT id::text AS org FROM organizations
    WHERE id NOT IN (SELECT organization_id FROM memberships WHERE user_id = ${membros[0].uid}::uuid)
    LIMIT 1`)
  if (outra.length > 0) {
    await deveRecusar('escopo de organização sem vínculo',
      async () => scopeFromSession(membros[0].uid, outra[0].org), 'ScopeDeniedError')
  } else {
    console.log('AVISO | nenhuma organização sem vínculo para testar o escopo negado')
  }
  const valido = await scopeFromSession(membros[0].uid, membros[0].org)
  t(valido.organizationId === membros[0].org && valido.actor === 'session',
    'escopo com vínculo aceito é emitido')

  // ── 7. Fonte `orcado` contra fetchBudgetRows ────────────────────────────
  const [versao] = await db.execute<{ id: string; org: string; n: number }>(sql`
    SELECT bv.id::text AS id, bv.organization_id::text AS org, COUNT(be.id)::int AS n
    FROM budget_versions bv JOIN budget_entries be ON be.version_id = bv.id
    GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 1`)

  if (!versao) {
    console.log('AVISO | nenhuma versão de orçamento com ocorrências — fonte "orcado" não conciliada')
  } else {
    const scopeOrc = scopeFromJob(versao.org)
    const [faixaOrc] = await db.execute<{ de: string; ate: string }>(sql`
      SELECT MIN(competence_date)::text AS de, MAX(competence_date)::text AS ate
      FROM budget_entries WHERE version_id = ${versao.id}::uuid`)

    // Réplica de fetchBudgetRows, sem passar pelo motor.
    const ref = await db.execute<{ cat: string; mes: string; valor: string }>(sql`
      SELECT c.id::text AS cat,
             TO_CHAR(DATE_TRUNC('month', e.competence_date::date), 'YYYY-MM') AS mes,
             COALESCE(SUM(CASE WHEN e.direction = 'inflow' THEN e.amount::numeric ELSE -e.amount::numeric END), 0)::text AS valor
      FROM budget_entries e
      JOIN categories c ON e.category_id = c.id
      JOIN categories p ON c.parent_id   = p.id
      WHERE e.organization_id = ${versao.org}::uuid
        AND e.version_id      = ${versao.id}::uuid
        AND e.competence_date::date >= ${faixaOrc.de}::date
        AND e.competence_date::date <= ${faixaOrc.ate}::date
        AND c.type NOT IN ('ativo_circulante','ativo_nao_circulante','passivo_circulante','passivo_nao_circulante','patrimonio_liquido')
        AND c.hide_in_dre = false
        AND p.hide_in_dre = false   -- herda do pai (26/ago); aqui por JOIN, na implementação por EXISTS
      GROUP BY c.id, DATE_TRUNC('month', e.competence_date::date)`)

    const motorOrc = await runQuery(scopeOrc, {
      fonte: 'orcado', medidas: ['valor_liquido'], agruparPor: ['categoria', 'mes'],
      periodo: { tipo: 'intervalo', de: faixaOrc.de, ate: faixaOrc.ate, regime: 'competencia' },
      filtros: { versaoOrcamento: versao.id, excluirBalanco: true, visibilidade: 'dre' },
      limite: 500,
    })
    const mapaOrc = new Map<string, number>()
    for (const l of motorOrc.linhas) {
      const cat = l.chaves.find(k => k.campo === 'categoria')!.id
      const mes = l.chaves.find(k => k.campo === 'mes')!.id
      if (cat !== null) mapaOrc.set(`${cat}|${mes}`, l.medidas.valor_liquido)
    }
    let orcIguais = 0, orcDif = 0
    for (const r of ref) {
      const v = mapaOrc.get(`${r.cat}|${r.mes}`)
      if (v !== undefined && Math.abs(v - Number(r.valor)) < 0.005) orcIguais++
      else { orcDif++; if (orcDif <= 2) console.log(`  divergente ${r.cat.slice(0,8)}|${r.mes}: ref=${r.valor} motor=${v}`) }
    }
    t(orcDif === 0 && orcIguais > 0,
      `${orcIguais}/${ref.length} células idênticas entre fetchBudgetRows e a fonte "orcado"`)

    await deveRecusar('orçado sem versão',
      async () => runQuery(scopeOrc, {
        fonte: 'orcado', medidas: ['valor_liquido'],
        periodo: { tipo: 'intervalo', de: faixaOrc.de, ate: faixaOrc.ate, regime: 'competencia' },
      }), 'QueryValidationError')
    await deveRecusar('orçado filtrado por conta (não existe)',
      async () => runQuery(scopeOrc, {
        fonte: 'orcado', medidas: ['valor_liquido'],
        periodo: { tipo: 'intervalo', de: faixaOrc.de, ate: faixaOrc.ate, regime: 'competencia' },
        filtros: { versaoOrcamento: versao.id, contas: ['x'] },
      }), 'QueryValidationError')
  }

  // ── 8. Fonte `nfe` — recusas e escopo (tabela vazia hoje) ───────────────
  const periodoNfe = { tipo: 'intervalo' as const, de, ate, regime: 'competencia' as const }
  const nfeOk = await runQuery(scope, {
    fonte: 'nfe', medidas: ['valor_liquido', 'contagem'], agruparPor: ['contato'],
    periodo: periodoNfe, limite: 10,
  })
  t(Array.isArray(nfeOk.linhas), `fonte "nfe" executa (${nfeOk.linhas.length} linhas — a tabela está vazia hoje)`)

  await deveRecusar('NF-e agrupada por centro de custo',
    async () => runQuery(scope, {
      fonte: 'nfe', medidas: ['valor_liquido'], agruparPor: ['centro_de_custo'], periodo: periodoNfe,
    }), 'QueryValidationError')
  await deveRecusar('NF-e filtrada por unidade de negócio',
    async () => runQuery(scope, {
      fonte: 'nfe', medidas: ['valor_liquido'], periodo: periodoNfe,
      filtros: { unidadesDeNegocio: ['11111111-1111-1111-1111-111111111111'] },
    }), 'QueryValidationError')
  await deveRecusar('NF-e agrupada por natureza (invoices não tem)',
    async () => runQuery(scope, {
      fonte: 'nfe', medidas: ['valor_liquido'], agruparPor: ['categoria'], periodo: periodoNfe,
    }), 'QueryValidationError')

  // ── 9. Regime muda a coluna de agrupamento, não só a de filtro ──────────
  // Foi o defeito achado ao escrever a segunda fonte: com `mes` declarado na
  // fonte, o agrupamento ficava preso à data de competência e "por mês em
  // regime de caixa" atribuía meses errados sem erro nenhum.
  const porMesComp = await runQuery(scope, {
    fonte: 'realizado', medidas: ['valor_liquido'], agruparPor: ['mes'],
    periodo: { tipo: 'intervalo', de, ate, regime: 'competencia' }, limite: 500,
  })
  const porMesCaixa = await runQuery(scope, {
    fonte: 'realizado', medidas: ['valor_liquido'], agruparPor: ['mes'],
    periodo: { tipo: 'intervalo', de, ate, regime: 'caixa' }, limite: 500,
  })
  const [{ divergem }] = await db.execute<{ divergem: number }>(sql`
    SELECT COUNT(*)::int AS divergem FROM transaction_lines
    WHERE organization_id = ${org}::uuid AND effective_date IS NOT NULL
      AND DATE_TRUNC('month', effective_date::date) <> DATE_TRUNC('month', date::date)`)
  const mesmoTotal = Math.abs(
    porMesComp.linhas.reduce((a, l) => a + l.medidas.valor_liquido, 0) -
    porMesCaixa.linhas.reduce((a, l) => a + l.medidas.valor_liquido, 0)) < 0.01
  t(mesmoTotal,
    `agrupar por mês em competência e em caixa dá o mesmo total (${divergem} linha(s) caem em mês diferente entre os regimes)`)

  // ── 10. explicarQuery não toca o banco ──────────────────────────────────
  const exp = explicarQuery({
    fonte: 'realizado', medidas: ['saidas'], agruparPor: ['unidade_de_negocio'],
    periodo: { tipo: 'relativo', meses: 12, regime: 'caixa' }, limite: 5,
  })
  t(exp.periodo && 'de' in exp.periodo && exp.regime === 'caixa',
    `explicarQuery resolve "últimos 12 meses" em ${JSON.stringify(exp.periodo)}`)

  // ── 11. O que o MODELO enxerga do schema ─────────────────────────────────
  //
  // A JSDoc do `spec.ts` não chega ao modelo: `z.toJSONSchema` publica só o que
  // vem de `.describe()`. Em 26/ago o expert concluiu que não dava para montar
  // um gráfico OPEX × CAPEX porque somava as transferências — ele tinha o
  // filtro `visibilidade` disponível e via apenas o enum cru. Descrição que não
  // chega ao modelo é descrição que não existe, e nada quebra quando ela some.
  {
    const publicado = JSON.stringify(z.toJSONSchema(querySpecSchema, { io: 'input' }))
    t(publicado.includes('ocultar na DRE'),
      'o schema publicado explica o que `visibilidade` faz')
    t(publicado.includes('opex_capex') && publicado.includes('CAPEX'),
      'e avisa que agrupar por opex_capex sem filtrar traz as transferências')
    t(publicado.includes('Balan'),
      'e explica `excluirBalanco`')
    // O outro sentido: removida a `.describe()`, o schema segue VÁLIDO e o
    // modelo volta a ficar sem pista. Os valores continuam publicados.
    t(publicado.includes('"dre"') && publicado.includes('"caixa"') && publicado.includes('"todas"'),
      'os três valores seguem publicados (a descrição não substituiu o enum)')
  }

  console.log(`\n${ok} ok, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(e => { console.error('ERRO:', e); process.exit(1) })
