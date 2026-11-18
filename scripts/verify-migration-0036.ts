/**
 * Valida a 0036 (folha de pagamento no orçamento) e a reversa ANTES de aplicar:
 * tudo numa transação que termina em ROLLBACK. Nada persiste.
 *
 *   DATABASE_URL=postgresql://postgres:local@localhost:55432/postgres \
 *     npx tsx --env-file=.env.local scripts/verify-migration-0036.ts
 *
 * Roda no banco LOCAL durante o desenvolvimento e, no dia de subir, contra a
 * PRODUÇÃO (é ROLLBACK) — com `lock_timeout` curto, para não ficar na fila de
 * uma trava exclusiva.
 *
 * O que precisa ser provado:
 * 1. Estrutura: 5 tabelas com RLS ligado e 4 policies cada; as 7 colunas novas
 *    de `legal_entities` com os defaults de alíquota.
 * 2. Regras exercitadas: `source='folha'` aceito; CLT sem entidade, saída antes
 *    da entrada, sem nome e sem ser vaga, e percentual 0 — tudo recusado.
 * 3. CASCADE: apagar a versão leva pessoas, alocações, benefícios e settings.
 * 4. A volta: tabelas e colunas fora, e o CHECK antigo recusa 'folha'.
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'

let ok = 0, falhas = 0
const t = (c: boolean, l: string) => { if (c) { ok++; console.log(`  OK    ${l}`) } else { falhas++; console.log(`  FALHA ${l}`) } }
class Reverter extends Error {}

const url = process.env.DATABASE_URL ?? ''
if (!/localhost:55432/.test(url) && !process.env.PERMITIR_BANCO_REMOTO) {
  console.error(`ABORTADO: DATABASE_URL não aponta para o banco local (localhost:55432): ${url.replace(/:[^:@]*@/, ':***@')}`)
  process.exit(2)
}

const IDA   = readFileSync('db/migrations/rls/0036_folha_orcamento.sql', 'utf8')
const VOLTA = readFileSync('db/migrations/rls/0036_down_folha_orcamento.sql', 'utf8')

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const TABELAS = ['budget_payroll_settings', 'budget_people', 'budget_people_allocations', 'budget_people_benefits', 'payroll_category_map']
const COLUNAS_ENTIDADE = ['regime_tributario', 'simples_anexo_iv', 'aliquota_inss_patronal', 'aliquota_rat_fap', 'aliquota_terceiros', 'aliquota_fgts', 'updated_at']

/** Roda `corpo` num savepoint; devolve a mensagem da recusa, ou null se passou. Sempre volta ao savepoint. */
async function recusa(tx: Tx, corpo: () => Promise<unknown>): Promise<string | null> {
  await tx.execute(sql`SAVEPOINT sp`)
  let msg: string | null = null
  try {
    await corpo()
  } catch (e) {
    const pg = e as { message?: string; cause?: { message?: string } }
    msg = pg.cause?.message ?? pg.message ?? 'erro'
  }
  await tx.execute(sql`ROLLBACK TO SAVEPOINT sp`)
  return msg
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '3s'`)

      console.log('── ida ──')
      await tx.execute(sql.raw(IDA))

      for (const tb of TABELAS) {
        const [r] = await tx.execute<{ rls: boolean; pol: number }>(sql`
          SELECT c.relrowsecurity AS rls,
                 (SELECT COUNT(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = ${tb}) AS pol
            FROM pg_class c WHERE c.relname = ${tb} AND c.relkind = 'r'`)
        t(!!r && r.rls === true && Number(r.pol) === 4, `${tb}: existe, RLS ligado, 4 policies`)
      }

      const cols = await tx.execute<{ column_name: string; column_default: string | null }>(sql`
        SELECT column_name, column_default FROM information_schema.columns
         WHERE table_name = 'legal_entities' AND column_name = ANY(${sql.raw(`ARRAY[${COLUNAS_ENTIDADE.map(c => `'${c}'`).join(',')}]`)})`)
      t(cols.length === 7, `legal_entities tem as 7 colunas novas (${cols.length})`)
      const def = (c: string) => cols.find(x => x.column_name === c)?.column_default ?? ''
      t(/0\.20/.test(def('aliquota_inss_patronal')), 'default INSS patronal 0.20')
      t(/0\.02/.test(def('aliquota_rat_fap')), 'default RAT/FAP 0.02')
      t(/0\.058/.test(def('aliquota_terceiros')), 'default terceiros 0.058')
      t(/0\.08/.test(def('aliquota_fgts')), 'default FGTS 0.08')

      // ── massa de teste, descartada pelo ROLLBACK ───────────────────────────
      const [org] = await tx.execute<{ id: string }>(sql`
        INSERT INTO organizations (name, slug) VALUES ('_Teste folha', ${'teste-folha-' + Date.now()}) RETURNING id::text`)
      const [ent] = await tx.execute<{ id: string }>(sql`
        INSERT INTO legal_entities (organization_id, name) VALUES (${org.id}::uuid, '_Entidade') RETURNING id::text`)
      const [ver] = await tx.execute<{ id: string }>(sql`
        INSERT INTO budget_versions (organization_id, name, fiscal_year) VALUES (${org.id}::uuid, '_V', 2027) RETURNING id::text`)
      const [cat] = await tx.execute<{ id: string }>(sql`
        SELECT id::text FROM categories WHERE organization_id = ${org.id}::uuid AND parent_id IS NOT NULL LIMIT 1`)
      const [cc] = await tx.execute<{ id: string }>(sql`
        INSERT INTO cost_centers (organization_id, name) VALUES (${org.id}::uuid, '_CC') RETURNING id::text`)

      const [e0] = await tx.execute<{ a: string; r: string; tc: string; f: string }>(sql`
        SELECT aliquota_inss_patronal::text AS a, aliquota_rat_fap::text AS r, aliquota_terceiros::text AS tc, aliquota_fgts::text AS f
          FROM legal_entities WHERE id = ${ent.id}::uuid`)
      t(Number(e0.a) === 0.2 && Number(e0.r) === 0.02 && Number(e0.tc) === 0.058 && Number(e0.f) === 0.08,
        'entidade nova nasce com 0.20 / 0.02 / 0.058 / 0.08')

      const rAliq = await recusa(tx, () => tx.execute(sql`UPDATE legal_entities SET aliquota_fgts = 8 WHERE id = ${ent.id}::uuid`))
      t(rAliq !== null, 'alíquota em percentual (8) em vez de fração é recusada')
      const rReg = await recusa(tx, () => tx.execute(sql`UPDATE legal_entities SET regime_tributario = 'mei' WHERE id = ${ent.id}::uuid`))
      t(rReg !== null, 'regime tributário fora do enum é recusado')

      const rFolha = await recusa(tx, () => tx.execute(sql`
        INSERT INTO budget_series (organization_id, version_id, description, direction, category_id, start_month, occurrences, base_amount, source)
        VALUES (${org.id}::uuid, ${ver.id}::uuid, '_folha', 'outflow', ${cat.id}::uuid, '2027-01-01', 12, 100, 'folha')`))
      t(rFolha === null, `budget_series aceita source='folha' (${rFolha?.slice(0, 60) ?? ''})`)

      const pessoa = (extra: string, vals: string) => sql.raw(`
        INSERT INTO budget_people (organization_id, version_id, ${extra})
        VALUES ('${org.id}', '${ver.id}', ${vals})`)

      const rCltSemEnt = await recusa(tx, () => tx.execute(pessoa('nome, vinculo, valor_base', `'Ana', 'clt', 3000`)))
      t(rCltSemEnt !== null, 'pessoa CLT sem entidade legal é recusada')
      const rProLabore = await recusa(tx, () => tx.execute(pessoa('nome, vinculo, valor_base', `'Ana', 'pro_labore', 3000`)))
      t(rProLabore !== null, 'pró-labore sem entidade legal é recusado')
      const rPjSemEnt = await recusa(tx, () => tx.execute(pessoa('nome, vinculo, valor_base', `'Bia', 'pj', 3000`)))
      t(rPjSemEnt === null, `PJ sem entidade legal é aceito (${rPjSemEnt?.slice(0, 60) ?? ''})`)
      const rSaida = await recusa(tx, () => tx.execute(pessoa('nome, vinculo, valor_base, mes_entrada, mes_saida', `'Caio', 'pj', 3000, 6, 3`)))
      t(rSaida !== null, 'mes_saida < mes_entrada é recusado')
      const rSemNome = await recusa(tx, () => tx.execute(pessoa('vinculo, valor_base, is_vaga', `'pj', 3000, false`)))
      t(rSemNome !== null, 'sem nome e sem ser vaga é recusado')
      const rVaga = await recusa(tx, () => tx.execute(pessoa('vinculo, valor_base, is_vaga', `'pj', 3000, true`)))
      t(rVaga === null, `vaga sem nome é aceita (${rVaga?.slice(0, 60) ?? ''})`)
      const rVinculo = await recusa(tx, () => tx.execute(pessoa('nome, vinculo, valor_base', `'Du', 'avulso', 3000`)))
      t(rVinculo !== null, 'vínculo fora do enum é recusado')
      const rValor = await recusa(tx, () => tx.execute(pessoa('nome, vinculo, valor_base', `'Eva', 'pj', 0`)))
      t(rValor !== null, 'valor_base 0 é recusado')

      // pessoa válida para os filhos
      const [p] = await tx.execute<{ id: string }>(sql`
        INSERT INTO budget_people (organization_id, version_id, nome, vinculo, valor_base, legal_entity_id)
        VALUES (${org.id}::uuid, ${ver.id}::uuid, 'Fábio', 'clt', 5000, ${ent.id}::uuid) RETURNING id::text`)
      const [pd] = await tx.execute<{ mes_entrada: number; mes_saida: number; dia_pagamento_pj: number; aplica_dissidio: boolean; naturezas: unknown }>(sql`
        SELECT mes_entrada, mes_saida, dia_pagamento_pj, aplica_dissidio, naturezas FROM budget_people WHERE id = ${p.id}::uuid`)
      t(pd.mes_entrada === 1 && pd.mes_saida === 12 && pd.dia_pagamento_pj === 10 && pd.aplica_dissidio === true
        && JSON.stringify(pd.naturezas) === '{}', 'defaults da pessoa: 1, 12, dia 10, dissídio, naturezas {}')

      const rPct0 = await recusa(tx, () => tx.execute(sql`
        INSERT INTO budget_people_allocations (organization_id, person_id, cost_center_id, percentual, ordem)
        VALUES (${org.id}::uuid, ${p.id}::uuid, ${cc.id}::uuid, 0, 1)`))
      t(rPct0 !== null, 'percentual 0 é recusado')
      const rPct101 = await recusa(tx, () => tx.execute(sql`
        INSERT INTO budget_people_allocations (organization_id, person_id, cost_center_id, percentual, ordem)
        VALUES (${org.id}::uuid, ${p.id}::uuid, ${cc.id}::uuid, 100.01, 1)`))
      t(rPct101 !== null, 'percentual acima de 100 é recusado')
      await tx.execute(sql`
        INSERT INTO budget_people_allocations (organization_id, person_id, cost_center_id, percentual, ordem)
        VALUES (${org.id}::uuid, ${p.id}::uuid, ${cc.id}::uuid, 100, 1)`)
      await tx.execute(sql`
        INSERT INTO budget_people_benefits (organization_id, person_id, nome, valor_mensal, ordem)
        VALUES (${org.id}::uuid, ${p.id}::uuid, 'VR', 600, 1)`)
      const rBenef = await recusa(tx, () => tx.execute(sql`
        INSERT INTO budget_people_benefits (organization_id, person_id, nome, valor_mensal, ordem)
        VALUES (${org.id}::uuid, ${p.id}::uuid, 'VT', 0, 2)`))
      t(rBenef !== null, 'benefício com valor 0 é recusado')
      await tx.execute(sql`INSERT INTO budget_payroll_settings (organization_id, version_id) VALUES (${org.id}::uuid, ${ver.id}::uuid)`)
      const [st] = await tx.execute<{ modo_provisao: string }>(sql`SELECT modo_provisao FROM budget_payroll_settings WHERE version_id = ${ver.id}::uuid`)
      t(st.modo_provisao === 'provisao', "settings nasce em modo 'provisao'")
      const rDup = await recusa(tx, () => tx.execute(sql`INSERT INTO budget_payroll_settings (organization_id, version_id) VALUES (${org.id}::uuid, ${ver.id}::uuid)`))
      t(rDup !== null, 'uma configuração por versão (UNIQUE)')
      const rDiss = await recusa(tx, () => tx.execute(sql`UPDATE budget_payroll_settings SET dissidio_mes = 13 WHERE version_id = ${ver.id}::uuid`))
      t(rDiss !== null, 'dissidio_mes 13 é recusado')
      await tx.execute(sql`INSERT INTO payroll_category_map (organization_id, componente, category_id) VALUES (${org.id}::uuid, 'salario', ${cat.id}::uuid)`)
      const rMapDup = await recusa(tx, () => tx.execute(sql`INSERT INTO payroll_category_map (organization_id, componente, category_id) VALUES (${org.id}::uuid, 'salario', ${cat.id}::uuid)`))
      t(rMapDup !== null, 'mapa de componente: chave (organização, componente) é única')
      const rCatRestrict = await recusa(tx, () => tx.execute(sql`DELETE FROM categories WHERE id = ${cat.id}::uuid`))
      t(rCatRestrict !== null, 'categoria mapeada não pode ser apagada (RESTRICT)')
      const rEntRestrict = await recusa(tx, () => tx.execute(sql`DELETE FROM legal_entities WHERE id = ${ent.id}::uuid`))
      t(rEntRestrict !== null, 'entidade com pessoa não pode ser apagada (RESTRICT)')

      // ── CASCADE a partir da versão ─────────────────────────────────────────
      const conta = async () => {
        const [r] = await tx.execute<{ n: number }>(sql`
          SELECT ((SELECT COUNT(*) FROM budget_people WHERE version_id = ${ver.id}::uuid)
                + (SELECT COUNT(*) FROM budget_people_allocations WHERE person_id = ${p.id}::uuid)
                + (SELECT COUNT(*) FROM budget_people_benefits WHERE person_id = ${p.id}::uuid)
                + (SELECT COUNT(*) FROM budget_payroll_settings WHERE version_id = ${ver.id}::uuid))::int AS n`)
        return Number(r.n)
      }
      t(await conta() > 0, 'há filhos antes de apagar a versão')
      await tx.execute(sql`DELETE FROM budget_series WHERE version_id = ${ver.id}::uuid`)
      await tx.execute(sql`DELETE FROM budget_versions WHERE id = ${ver.id}::uuid`)
      t(await conta() === 0, 'apagar a versão leva pessoas, alocações, benefícios e settings (CASCADE)')

      // ── idempotência da ida ────────────────────────────────────────────────
      console.log('── idempotência ──')
      await tx.execute(sql.raw(IDA))
      t(true, 'a ida roda duas vezes seguidas sem erro')

      // ── a volta ────────────────────────────────────────────────────────────
      console.log('── volta ──')
      // Uma série 'folha' precisa existir para provar o DELETE da reversa.
      const [ver2] = await tx.execute<{ id: string }>(sql`
        INSERT INTO budget_versions (organization_id, name, fiscal_year) VALUES (${org.id}::uuid, '_V2', 2028) RETURNING id::text`)
      await tx.execute(sql`
        INSERT INTO budget_series (organization_id, version_id, description, direction, category_id, start_month, occurrences, base_amount, source)
        VALUES (${org.id}::uuid, ${ver2.id}::uuid, '_folha', 'outflow', ${cat.id}::uuid, '2028-01-01', 12, 100, 'folha')`)
      await tx.execute(sql.raw(VOLTA))
      for (const tb of TABELAS) {
        const [r] = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM pg_class WHERE relname = ${tb} AND relkind = 'r'`)
        t(Number(r.n) === 0, `${tb} removida`)
      }
      const colsDepois = await tx.execute(sql`
        SELECT 1 FROM information_schema.columns WHERE table_name = 'legal_entities'
           AND column_name = ANY(${sql.raw(`ARRAY[${COLUNAS_ENTIDADE.map(c => `'${c}'`).join(',')}]`)})`)
      t(colsDepois.length === 0, 'as 7 colunas de legal_entities removidas')
      const [sobra] = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM budget_series WHERE source = 'folha'`)
      t(Number(sobra.n) === 0, "séries 'folha' apagadas pela reversa")
      const rAntigo = await recusa(tx, () => tx.execute(sql`
        INSERT INTO budget_series (organization_id, version_id, description, direction, category_id, start_month, occurrences, base_amount, source)
        VALUES (${org.id}::uuid, ${ver2.id}::uuid, '_folha2', 'outflow', ${cat.id}::uuid, '2028-01-01', 12, 100, 'folha')`))
      t(rAntigo !== null, "depois da volta o CHECK antigo recusa 'folha'")
      await tx.execute(sql.raw(VOLTA))
      t(true, 'a reversa roda duas vezes seguidas sem erro (idempotente)')

      throw new Reverter()
    })
  } catch (e) {
    if (!(e instanceof Reverter)) throw e
  }

  const [fim] = await db.execute<{ reg: string | null }>(sql`SELECT to_regclass('budget_people')::text AS reg`)
  t(fim.reg === null, 'ROLLBACK: nada persistiu (to_regclass(budget_people) é null)')

  console.log(`\n${ok + falhas} verificações — ${ok} OK, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
