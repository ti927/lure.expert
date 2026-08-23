/**
 * Fase 2.1 — o caminho da chave, de ponta a ponta.
 *
 * O que NÃO é testado aqui, e por quê: `saveAiKey` grava no banco de produção e
 * marcaria uma organização real como `own`. O teste exercita cada peça
 * separadamente — o teste da chave contra a API (sem gravar), a ida e volta pela
 * coluna cifrada (com ROLLBACK), e a leitura que a tela recebe.
 *
 *   ENCRYPTION_KEY=<hex> ANTHROPIC_API_KEY=<chave> DATABASE_URL="<pooler>" \
 *     npx tsx scripts/verify-ai-key-flow.ts
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { encryptSecret, decryptSecret, ultimos4 } from '@/lib/crypto'
import { testarChaveAnthropic } from '@/lib/ai-key-test'
import { resolverAcessoIa } from '@/lib/ai-access'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

async function main() {
  // ── 1. O teste de chave, contra a API de verdade ────────────────────────
  const invalida = await testarChaveAnthropic('sk-ant-api03-' + 'z'.repeat(90))
  t(invalida.ok === false && invalida.status === 401,
    `chave inválida devolve 401 (status ${invalida.ok === false ? invalida.status : '—'})`)
  if (invalida.ok === false) {
    t(!invalida.mensagem.includes('401') && invalida.mensagem.includes('Confira'),
      `a mensagem é acionável, não o erro cru: "${invalida.mensagem}"`)
  }

  const real = process.env.ANTHROPIC_API_KEY
  if (real) {
    const valida = await testarChaveAnthropic(real)
    t(valida.ok === true, 'chave válida passa no teste')
    if (valida.ok) {
      console.log(`       custo do teste: US$ ${valida.custoUsd.toFixed(8)} (${valida.usage.inputTokens} in / ${valida.usage.outputTokens} out)`)
      t(valida.custoUsd < 0.0001, 'o teste custa frações de centavo')
    }
  } else {
    console.log('AVISO | sem ANTHROPIC_API_KEY no ambiente — o caso da chave válida não foi exercitado')
  }

  const semPrefixo = await testarChaveAnthropic('chave-qualquer-que-nao-e-anthropic')
  t(semPrefixo.ok === false, 'chave sem formato de Anthropic também é recusada pela API')

  // ── 2. A ida e volta pela coluna cifrada, com ROLLBACK ──────────────────
  const CHAVE = 'sk-ant-api03-' + 'k'.repeat(80) + 'Zz99'
  try {
    await db.transaction(async (tx) => {
      const [{ org }] = await tx.execute<{ org: string }>(sql`
        SELECT organization_id::text AS org FROM organization_ai_settings LIMIT 1`)

      await tx.execute(sql`
        UPDATE organization_ai_settings
        SET key_source = 'own',
            api_key_encrypted = ${encryptSecret(CHAVE)},
            api_key_last4 = ${ultimos4(CHAVE)},
            api_key_validated_at = now()
        WHERE organization_id = ${org}::uuid`)

      const [guardado] = await tx.execute<{ enc: string; last4: string }>(sql`
        SELECT api_key_encrypted AS enc, api_key_last4 AS last4
        FROM organization_ai_settings WHERE organization_id = ${org}::uuid`)

      t(!guardado.enc.includes(CHAVE.slice(10, 50)),
        'a coluna do banco NÃO contém a chave em claro')
      t(guardado.enc.startsWith('v1.'), 'formato versionado sobreviveu ao banco')
      t(decryptSecret(guardado.enc) === CHAVE,
        'a chave volta idêntica depois de passar pela coluna')
      t(guardado.last4 === 'Zz99', `os 4 últimos são o único fragmento legível ("${guardado.last4}")`)

      const exec = tx as unknown as Parameters<typeof resolverAcessoIa>[1]
      const acesso = await resolverAcessoIa(org, exec)
      t(acesso.ok === true && acesso.origem === 'own',
        'resolverAcessoIa decifra a chave gravada e concede acesso')

      // Remover a chave desliga a IA, e NÃO devolve à chave da plataforma.
      await tx.execute(sql`
        UPDATE organization_ai_settings
        SET api_key_encrypted = NULL, api_key_last4 = NULL, api_key_validated_at = NULL
        WHERE organization_id = ${org}::uuid`)
      const semChave = await resolverAcessoIa(org, exec)
      t(semChave.ok === false && semChave.motivo === 'sem_chave',
        'remover a chave desliga a IA e NÃO devolve à chave da Lure')

      const [{ origem }] = await tx.execute<{ origem: string }>(sql`
        SELECT key_source AS origem FROM organization_ai_settings WHERE organization_id = ${org}::uuid`)
      t(origem === 'own', `a origem continua "own" depois de remover a chave (${origem})`)

      throw new Error('__ROLLBACK__')
    })
  } catch (e) {
    if ((e as Error).message !== '__ROLLBACK__') { console.error('ERRO:', e); falhas++ }
  }

  // ── 3. Nada do que a tela recebe carrega a chave ─────────────────────────
  const { readFileSync } = await import('fs')
  const fonte = readFileSync('src/server/ai-settings.ts', 'utf8')
  const view = fonte.slice(fonte.indexOf('export interface AiSettingsView'), fonte.indexOf('export async function getAiSettings'))
  t(!view.includes('apiKeyEncrypted') && !view.includes('chave:'),
    'AiSettingsView não tem campo para a chave — só os 4 últimos')
  t(fonte.includes('ultimos4:     cfg?.apiKeyLast4'),
    'getAiSettings devolve apenas os 4 últimos')

  // ── 4. Estado real, intocado ────────────────────────────────────────────
  const est = await db.execute<{ n: number; own: number; comChave: number }>(sql`
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE key_source = 'own')::int AS own,
           COUNT(*) FILTER (WHERE api_key_encrypted IS NOT NULL)::int AS "comChave"
    FROM organization_ai_settings`)
  console.log(`\nEstado do banco: ${est[0].n} organizações · ${est[0].own} em 'own' · ${est[0].comChave} com chave`)
  t(Number(est[0].comChave) === 0, 'nenhuma chave real foi gravada por este teste')

  console.log(`\n${ok} ok, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(e => { console.error('ERRO:', e); process.exit(1) })
