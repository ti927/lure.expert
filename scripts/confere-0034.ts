/**
 * Confere a 0034 DEPOIS de aplicada (só leitura).
 *   npx tsx --env-file=.env.local scripts/confere-0034.ts
 * Com `--aplicar`, aplica antes numa transação única (é idempotente).
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'

async function main() {
  if (process.argv.includes('--aplicar')) {
    const ddl = readFileSync('db/migrations/rls/0034_account_opening_balances.sql', 'utf8')
    await db.transaction(async tx => { await tx.execute(sql.raw(ddl)) })
    console.log('0034 aplicada')
  }
  const [r] = await db.execute<Record<string, unknown>>(sql`
    SELECT to_regclass('account_opening_balances') IS NOT NULL AS existe,
      (SELECT relrowsecurity FROM pg_class WHERE relname = 'account_opening_balances') AS rls,
      (SELECT count(*)::int FROM pg_policies WHERE tablename = 'account_opening_balances') AS policies,
      (SELECT count(*)::int FROM pg_trigger WHERE tgname = 'trg_account_opening_balances_updated_at') AS gatilho,
      (SELECT count(*)::int FROM pg_constraint WHERE conname = 'account_opening_balances_unq') AS unicidade`)
  console.log(r)
  const ok = r.existe && r.rls && r.policies === 4 && r.gatilho === 1 && r.unicidade === 1
  console.log(ok ? 'CONFERIDA' : 'FALHA')
  process.exit(ok ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
