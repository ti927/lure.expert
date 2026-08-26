/**
 * Valida a migration 0032 ANTES de aplicá-la: roda o arquivo inteiro dentro de
 * uma transação e reverte no fim.
 *
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-migration-0032.ts
 *
 * O que precisa ser provado, e por quê:
 *
 * 1. Os blocos REAIS que já existem perdem `saldo-negativo` e conservam as
 *    outras 7 — na mesma ordem. Ordem importa porque a lista é o vocabulário
 *    que o MCP publica, e reordenar em silêncio é ruído numa auditoria.
 * 2. O resultado PASSA por `lerBlockSpec`. Este é o teste que dá sentido à
 *    migration: se o bloco não voltasse a ler, apertar o enum teria quebrado o
 *    painel de quem personalizou.
 * 3. O caso extremo (`regras` com só a que sai) some a chave, e o `.default`
 *    do Zod devolve as 7 na leitura — em vez de uma lista vazia, que falharia
 *    no `.min(1)`.
 * 4. Bloco que NÃO é de alertas fica intacto.
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { lerBlockSpec, REGRAS_DE_ALERTA } from '@/lib/dashboard/block-spec'

let ok = 0, falhas = 0
function t(cond: boolean, label: string) {
  if (cond) { ok++; console.log(`  OK   ${label}`) }
  else      { falhas++; console.log(`  FALHA ${label}`) }
}

const SQL_PATH = 'db/migrations/rls/0032_alerta_saldo_negativo.sql'

/** As 8 regras como estavam gravadas antes do corte. */
const OITO = [
  'saldo-negativo', 'lucro-negativo', 'despesas-alta', 'receita-queda',
  'ebitda-baixo', 'cobertura-divida', 'liquidez-corrente', 'endividamento',
]

class Reverter extends Error {}

async function main() {
  console.log(`\nValidando ${SQL_PATH} com ROLLBACK\n`)

  const antes = await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n FROM dashboard_blocks
    WHERE spec->>'tipo' = 'alertas' AND spec->'regras' @> '["saldo-negativo"]'::jsonb
  `)
  const alvosReais = Number(antes[0]?.n ?? 0)
  console.log(`blocos reais que a migration vai tocar: ${alvosReais}\n`)

  try {
    await db.transaction(async (tx) => {
      // ── Semeia os dois casos que o dado real não cobre ─────────────────────
      const [org] = await tx.execute<{ id: string }>(sql`
        INSERT INTO organizations (name, slug, cnpj)
        VALUES ('ZZ Teste 0032', 'zz-teste-0032', '00000000000191')
        RETURNING id::text AS id
      `)
      const [painel] = await tx.execute<{ id: string }>(sql`
        INSERT INTO dashboards (organization_id, owner_user_id, name, slug)
        VALUES (${org.id}::uuid, gen_random_uuid(), 'ZZ 0032', 'zz-0032')
        RETURNING id::text AS id
      `)
      const inserirBloco = async (spec: unknown, pos: number) => {
        const [b] = await tx.execute<{ id: string }>(sql`
          INSERT INTO dashboard_blocks (dashboard_id, organization_id, position, spec)
          VALUES (${painel.id}::uuid, ${org.id}::uuid, ${pos}, ${JSON.stringify(spec)}::jsonb)
          RETURNING id::text AS id
        `)
        return b.id
      }

      const idSoSaldo = await inserirBloco(
        { versao: 1, tipo: 'alertas', largura: 12, maximo: 6, regras: ['saldo-negativo'] }, 0)
      const idOito = await inserirBloco(
        { versao: 1, tipo: 'alertas', largura: 12, maximo: 6, regras: OITO }, 1)
      const idNaoAlerta = await inserirBloco(
        { versao: 1, tipo: 'texto', largura: 12, markdown: 'nada a ver' }, 2)

      // ── Aplica a migration, verbatim ──────────────────────────────────────
      const arquivo = readFileSync(SQL_PATH, 'utf8')
      await tx.execute(sql.raw(arquivo))

      const lerSpec = async (id: string) => {
        const [r] = await tx.execute<{ spec: Record<string, unknown> }>(sql`
          SELECT spec FROM dashboard_blocks WHERE id = ${id}::uuid
        `)
        return r.spec
      }

      // ── 1 e 2: o bloco com as 8 ───────────────────────────────────────────
      const specOito = await lerSpec(idOito)
      const regrasOito = specOito.regras as string[]
      t(!regrasOito.includes('saldo-negativo'), "as 8 regras perdem 'saldo-negativo'")
      t(regrasOito.length === 7, `e ficam 7 (${regrasOito.length})`)
      t(regrasOito.join() === OITO.filter(r => r !== 'saldo-negativo').join(),
        'na MESMA ordem em que estavam — a migration não reordena')
      const lidoOito = lerBlockSpec(specOito)
      t(lidoOito.ok === true, 'e a spec resultante PASSA por lerBlockSpec (era isto que a migration protegia)')

      // O outro sentido: sem a migration, a mesma spec quebraria na leitura.
      t(lerBlockSpec({ versao: 1, tipo: 'alertas', largura: 12, maximo: 6, regras: OITO }).ok === false,
        'e a spec ANTIGA, com as 8, é recusada pelo enum novo — a migration não é decorativa')

      // ── 3: o caso extremo ─────────────────────────────────────────────────
      const specSo = await lerSpec(idSoSaldo)
      t(!('regras' in specSo), "bloco cuja ÚNICA regra era a que sai perde a chave 'regras'")
      const lidoSo = lerBlockSpec(specSo)
      t(lidoSo.ok === true, 'e ele volta a ler')
      t(lidoSo.ok === true && lidoSo.spec.tipo === 'alertas'
        && lidoSo.spec.regras.length === REGRAS_DE_ALERTA.length,
        `caindo no default das ${REGRAS_DE_ALERTA.length} regras, e não numa lista vazia`)

      // ── 4: quem não é alerta não é tocado ──────────────────────────────────
      const specTexto = await lerSpec(idNaoAlerta)
      t(specTexto.tipo === 'texto' && specTexto.markdown === 'nada a ver',
        'bloco que não é de alertas fica intacto')

      // ── 5: idempotência — rodar de novo não muda nada ──────────────────────
      await tx.execute(sql.raw(arquivo))
      const denovo = (await lerSpec(idOito)).regras as string[]
      t(denovo.join() === regrasOito.join(), 'rodar a migration duas vezes dá o mesmo resultado')

      // ── 6: nenhuma linha `alertas` sobra com a regra, no banco INTEIRO ─────
      const sobrou = await tx.execute<{ n: string }>(sql`
        SELECT COUNT(*)::text AS n FROM dashboard_blocks
        WHERE spec->'regras' @> '["saldo-negativo"]'::jsonb
      `)
      t(Number(sobrou[0]?.n) === 0, `nenhum bloco no banco ainda menciona a regra (${sobrou[0]?.n})`)

      throw new Reverter()
    })
  } catch (e) {
    if (!(e instanceof Reverter)) throw e
  }

  // ── Nada persistiu ────────────────────────────────────────────────────────
  const depois = await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n FROM dashboard_blocks
    WHERE spec->>'tipo' = 'alertas' AND spec->'regras' @> '["saldo-negativo"]'::jsonb
  `)
  t(Number(depois[0]?.n) === alvosReais,
    `ROLLBACK: os ${alvosReais} blocos reais seguem intocados (${depois[0]?.n})`)
  const orgs = await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n FROM organizations WHERE name = 'ZZ Teste 0032'
  `)
  t(Number(orgs[0]?.n) === 0, 'e a organização de teste não sobrou')

  console.log(`\n${ok + falhas} verificações — ${ok} OK, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(e => { console.error('\nERRO:', e); process.exit(1) })
