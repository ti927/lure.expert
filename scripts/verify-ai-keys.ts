/**
 * Fase 2 — chave de IA por organização.
 *
 * Três blocos: a criptografia (pura), a migration 0029 (dentro de transação com
 * ROLLBACK) e a resolução de acesso exercitada contra as tabelas criadas ali
 * dentro — só possível porque `resolverAcessoIa` aceita um executor, como
 * `budget-scope.ts` já fazia.
 *
 *   ENCRYPTION_KEY=<32 bytes em hex> DATABASE_URL="<pooler>" npx tsx scripts/verify-ai-keys.ts
 */
import { readFileSync } from 'fs'

import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { encryptSecret, decryptSecret, ultimos4, cryptoDisponivel } from '@/lib/crypto'
import { resolverAcessoIa, gastoDoMes, verificarAlertaDeConsumo } from '@/lib/ai-access'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

const CHAVE_FALSA = 'sk-ant-api03-' + 'x'.repeat(80) + 'AA'

async function main() {
  // ── 1. Criptografia ─────────────────────────────────────────────────────
  if (!cryptoDisponivel()) {
    console.error('ENCRYPTION_KEY ausente ou inválida. Gere com:')
    console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
    process.exit(1)
  }

  const cifrado = encryptSecret(CHAVE_FALSA)
  t(decryptSecret(cifrado) === CHAVE_FALSA, 'cifra e decifra devolvem o mesmo texto')
  t(!cifrado.includes(CHAVE_FALSA.slice(10, 40)),
    'o texto cifrado NÃO contém a chave em claro (o defeito de `encryptApiKey`, que é só base64)')
  t(cifrado.startsWith('v1.') && cifrado.split('.').length === 4,
    `formato versionado: ${cifrado.slice(0, 24)}…`)
  t(encryptSecret(CHAVE_FALSA) !== cifrado,
    'cifrar duas vezes dá resultados diferentes (IV aleatório por chamada)')

  const adulterado = (() => {
    const p = cifrado.split('.')
    const b = Buffer.from(p[3], 'base64url'); b[0] ^= 0xff
    return [p[0], p[1], p[2], b.toString('base64url')].join('.')
  })()
  try { decryptSecret(adulterado); t(false, 'texto adulterado foi aceito e não devia') }
  catch { t(true, 'texto adulterado é recusado pela tag de autenticação do GCM') }

  try { decryptSecret('base64puro'); t(false, 'formato antigo aceito') }
  catch { t(true, 'formato desconhecido é recusado') }

  t(ultimos4(CHAVE_FALSA) === 'xxAA'.slice(-4) || ultimos4(CHAVE_FALSA).length === 4,
    `ultimos4 devolve 4 caracteres ("${ultimos4(CHAVE_FALSA)}")`)

  // ── 2 e 3. Migration + resolução, dentro de transação revertida ─────────
  const migration = readFileSync('db/migrations/rls/0029_organization_ai_settings.sql', 'utf8')

  try {
    await db.transaction(async (tx) => {
      const [{ orgs }] = await tx.execute<{ orgs: number }>(sql`
        SELECT COUNT(*)::int AS orgs FROM organizations`)

      await tx.execute(sql.raw(migration))
      console.log('\n— migration executou sem erro de sintaxe —')

      const [{ n }] = await tx.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM organization_ai_settings`)
      t(Number(n) === Number(orgs),
        `as ${orgs} organizações existentes nasceram em 'platform' — aplicar a migration NÃO desliga a IA de ninguém`)

      const [{ p }] = await tx.execute<{ p: number }>(sql`
        SELECT COUNT(*)::int AS p FROM organization_ai_settings WHERE key_source = 'platform'`)
      t(Number(p) === Number(orgs), `todas em 'platform' (${p})`)

      const pol = await tx.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM pg_policies WHERE tablename = 'organization_ai_settings'`)
      t(Number(pol[0].n) === 4, `4 policies RLS (${pol[0].n})`)

      const [{ org }] = await tx.execute<{ org: string }>(sql`
        SELECT organization_id::text AS org FROM transactions
        GROUP BY organization_id ORDER BY COUNT(*) DESC LIMIT 1`)

      const recusa = async (rotulo: string, fn: () => Promise<unknown>) => {
        await tx.execute(sql`SAVEPOINT s`)
        try { await fn(); await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); t(false, `${rotulo} — aceito e não devia`) }
        catch { await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); t(true, `${rotulo} — recusado`) }
      }

      await recusa('origem de chave inventada', () =>
        tx.execute(sql`UPDATE organization_ai_settings SET key_source = 'sei_la' WHERE organization_id = ${org}::uuid`))
      await recusa('teto negativo', () =>
        tx.execute(sql`UPDATE organization_ai_settings SET monthly_limit_usd = -1 WHERE organization_id = ${org}::uuid`))
      await recusa('limiar de alerta acima de 100', () =>
        tx.execute(sql`UPDATE organization_ai_settings SET alert_threshold = 150 WHERE organization_id = ${org}::uuid`))
      await recusa('chave cifrada sem os 4 últimos', () =>
        tx.execute(sql`UPDATE organization_ai_settings SET api_key_encrypted = 'v1.a.b.c' WHERE organization_id = ${org}::uuid`))

      // ── Resolução de acesso ──────────────────────────────────────────────
      const exec = tx as unknown as Parameters<typeof resolverAcessoIa>[1]

      // Sem ANTHROPIC_API_KEY no ambiente, a resposta correta e recusar por
      // 'plataforma_indisponivel' -- que tambem e um caso que vale testar.
      const naPlataforma = await resolverAcessoIa(org, exec)
      if (process.env.ANTHROPIC_API_KEY) {
        t(naPlataforma.ok === true && naPlataforma.origem === 'platform',
          'organização em "platform" recebe o client da Lure')
      } else {
        t(naPlataforma.ok === false && naPlataforma.motivo === 'plataforma_indisponivel',
          'sem ANTHROPIC_API_KEY no ambiente, "platform" recusa com plataforma_indisponivel')
      }

      await tx.execute(sql`
        UPDATE organization_ai_settings SET key_source = 'own', api_key_encrypted = NULL, api_key_last4 = NULL
        WHERE organization_id = ${org}::uuid`)
      const semChave = await resolverAcessoIa(org, exec)
      t(semChave.ok === false && semChave.motivo === 'sem_chave',
        `sem chave própria: recusa com "${semChave.ok === false ? semChave.motivo : ''}"`)
      if (semChave.ok === false) console.log(`       mensagem: ${semChave.mensagem.slice(0, 90)}…`)

      await tx.execute(sql`
        UPDATE organization_ai_settings
        SET api_key_encrypted = ${encryptSecret(CHAVE_FALSA)}, api_key_last4 = ${ultimos4(CHAVE_FALSA)}
        WHERE organization_id = ${org}::uuid`)
      const comChave = await resolverAcessoIa(org, exec)
      t(comChave.ok === true && comChave.origem === 'own',
        'com chave própria cadastrada: acesso concedido com o client da organização')

      // Teto. O gasto real do mês corrente pode ser zero, o que tornaria o
      // teste inconclusivo — então injeto consumo sintético aqui dentro, que o
      // ROLLBACK leva junto. `monthly_limit_usd` é numeric(10,2): o menor teto
      // possivel e US$ 0,01, e um teto de 0 significa "sem IA".
      const gastoAntes = await gastoDoMes(org, exec)
      await tx.execute(sql`
        INSERT INTO agent_events (organization_id, type, payload, model_used, tokens_input, tokens_output, cost_usd)
        VALUES (${org}::uuid, 'categorization', '{"teste":true}'::jsonb, 'claude-haiku-4-5-20251001', 1000, 100, 5.00)`)
      const gasto = await gastoDoMes(org, exec)
      t(Math.abs(gasto - gastoAntes - 5) < 0.0001,
        `gastoDoMes enxerga o consumo do mês (US$ ${gastoAntes.toFixed(2)} → US$ ${gasto.toFixed(2)})`)

      await tx.execute(sql`
        UPDATE organization_ai_settings SET monthly_limit_usd = ${(gasto - 1).toFixed(2)} WHERE organization_id = ${org}::uuid`)
      const estourado = await resolverAcessoIa(org, exec)
      t(estourado.ok === false && estourado.motivo === 'teto_estourado',
        'teto abaixo do gasto recusa MESMO com chave própria válida')
      if (estourado.ok === false) console.log(`       mensagem: ${estourado.mensagem.slice(0, 100)}…`)

      await tx.execute(sql`
        UPDATE organization_ai_settings SET monthly_limit_usd = ${(gasto + 10).toFixed(2)} WHERE organization_id = ${org}::uuid`)
      const folgado = await resolverAcessoIa(org, exec)
      t(folgado.ok === true, 'teto acima do gasto não atrapalha')

      // Alerta em 80%: dispara uma vez, e blocos do job em paralelo não repetem.
      await tx.execute(sql`
        UPDATE organization_ai_settings
        SET monthly_limit_usd = ${(gasto / 0.9).toFixed(2)}, alerted_month = NULL
        WHERE organization_id = ${org}::uuid`)
      const primeiro = await verificarAlertaDeConsumo(org, exec)
      const segundo  = await verificarAlertaDeConsumo(org, exec)
      t(primeiro.avisar === true && segundo.avisar === false,
        `alerta dispara uma vez (${primeiro.avisar ? primeiro.percentual.toFixed(0) + '%' : '—'}) e não repete no mesmo mês`)

      await tx.execute(sql`
        UPDATE organization_ai_settings
        SET monthly_limit_usd = ${(gasto * 10).toFixed(2)}, alerted_month = NULL
        WHERE organization_id = ${org}::uuid`)
      const longe = await verificarAlertaDeConsumo(org, exec)
      t(longe.avisar === false, 'abaixo do limiar de 80%, nenhum alerta')

      throw new Error('__ROLLBACK__')
    })
  } catch (e) {
    if ((e as Error).message !== '__ROLLBACK__') { console.error('\nERRO:', e); falhas++ }
  }

  console.log(`\n${ok} ok, ${falhas} falha(s) — a migration foi revertida`)
  process.exit(falhas > 0 ? 1 : 0)
}


main().catch(e => { console.error('ERRO:', e); process.exit(1) })
