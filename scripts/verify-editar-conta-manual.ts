/**
 * Verificação de 20/out: editar conta manual (nome, tipo, número) sem perder a
 * identidade, e importação reconhecendo o nome antigo e o novo.
 *
 * TUDO dentro de uma transação que termina em ROLLBACK — roda contra a produção
 * sem deixar rastro. A última asserção confere isso fora da transação.
 *
 * Rodar com o pooler:
 *   DATABASE_URL="postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:6543/postgres" \
 *     npx tsx --env-file=.env.local scripts/verify-editar-conta-manual.ts
 */

import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { dataSources, transactions } from '@/db/schema'
import { editarContaManual, garantirContaManual, mapaDeContasManuais } from '@/lib/accounts'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }
const ROLLBACK = '__ROLLBACK__'

async function main() {
  // A conta manual com mais lançamentos — o caso que mais tem a perder.
  const [alvo] = await db.execute<{ id: string; org: string; nome: string; account_id: string; n: string }>(sql`
    SELECT ds.id::text, ds.organization_id::text AS org, ds.name AS nome,
           ds.metadata->>'accountId' AS account_id, COUNT(t.id)::text AS n
      FROM data_sources ds JOIN transactions t ON t.data_source_id = ds.id
     WHERE ds.provider = 'manual'
     GROUP BY 1, 2, 3, 4 ORDER BY COUNT(t.id) DESC LIMIT 1`)
  t(!!alvo && Number(alvo.n) > 0, `conta manual com lançamentos: "${alvo?.nome}" (${alvo?.n})`)
  const org = alvo.org
  const [outra] = await db.execute<{ nome: string }>(sql`
    SELECT name AS nome FROM data_sources WHERE provider = 'manual' AND organization_id = ${org}::uuid AND id <> ${alvo.id}::uuid LIMIT 1`)

  const contarPorNome = async (exec: typeof db, nome: string) => Number((await exec.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text n FROM transactions WHERE organization_id = ${org}::uuid AND account_id = ${alvo.account_id} AND account_name = ${nome}`))[0].n)

  try {
    await db.transaction(async tx => {
      const exec = tx as unknown as typeof db
      const contasAntes = Number((await tx.execute<{ n: string }>(sql`SELECT COUNT(*)::text n FROM data_sources WHERE organization_id = ${org}::uuid`))[0].n)

      // Logo e badge "postos pela pessoa" — têm de sobreviver a tudo abaixo.
      await tx.execute(sql`UPDATE data_sources
        SET metadata = metadata || '{"customBadge":{"text":"TESTE"},"customLogoPath":"x/teste.png"}'::jsonb
        WHERE id = ${alvo.id}::uuid`)

      // 1. Renomear
      const r = await editarContaManual(org, alvo.id, { nome: 'Conta Renomeada Teste', tipo: 'CHECKING_ACCOUNT', numero: '999-1' }, exec)
      t('ok' in r && r.lancamentosAtualizados === Number(alvo.n), `renomear atualiza os ${alvo.n} lançamentos`)
      t(await contarPorNome(exec, 'Conta Renomeada Teste') === Number(alvo.n), 'todos os lançamentos passam a ter o nome novo')
      t(await contarPorNome(exec, alvo.nome) === 0, 'nenhum ficou com o nome antigo')
      const [tipos] = await tx.execute<{ tipo: string; num: string }>(sql`
        SELECT MIN(account_type) tipo, MIN(account_number) num FROM transactions WHERE account_id = ${alvo.account_id} AND organization_id = ${org}::uuid`)
      t(tipos.tipo === 'CHECKING_ACCOUNT' && tipos.num === '999-1', 'tipo e número também foram propagados')

      const [ds] = await tx.select({ name: dataSources.name, metadata: dataSources.metadata })
        .from(dataSources).where(eq(dataSources.id, alvo.id))
      const meta = ds.metadata as Record<string, unknown>
      t(ds.name === 'Conta Renomeada Teste' && meta.institutionName === 'Conta Renomeada Teste', 'cadastro com o nome novo (e o rótulo do filtro também)')
      t(meta.accountId === alvo.account_id, `identidade NÃO mudou (${alvo.account_id})`)
      t((meta.customBadge as { text?: string })?.text === 'TESTE' && meta.customLogoPath === 'x/teste.png', 'logo e badge preservados')
      t(Array.isArray(meta.aliases) && (meta.aliases as string[]).includes('arq:conta-renomeada-teste'), 'o slug do nome novo virou apelido')

      // 2. A importação reconhece os dois nomes
      const mapa = await mapaDeContasManuais(org, exec)
      t(mapa.get(alvo.account_id)?.dataSourceId === alvo.id, 'o mapa da importação acha pelo nome antigo (identidade)')
      t(mapa.get('arq:conta-renomeada-teste')?.dataSourceId === alvo.id, 'e pelo nome novo (apelido)')

      const g1 = await garantirContaManual(org, alvo.nome, null, null, exec)
      const g2 = await garantirContaManual(org, 'CONTA renomeada  teste', null, null, exec)
      t(!('error' in g1) && g1.dataSourceId === alvo.id && g1.accountId === alvo.account_id, 'arquivo com o nome antigo cai na mesma conta')
      t(!('error' in g2) && g2.dataSourceId === alvo.id && g2.accountId === alvo.account_id,
        'arquivo com o nome novo cai na mesma conta — e devolve a identidade GRAVADA')
      const contasDepois = Number((await tx.execute<{ n: string }>(sql`SELECT COUNT(*)::text n FROM data_sources WHERE organization_id = ${org}::uuid`))[0].n)
      t(contasDepois === contasAntes, 'nenhuma conta nova foi criada')
      const [ds2] = await tx.select({ metadata: dataSources.metadata }).from(dataSources).where(eq(dataSources.id, alvo.id))
      const meta2 = ds2.metadata as Record<string, unknown>
      t((meta2.customBadge as { text?: string })?.text === 'TESTE' && Array.isArray(meta2.aliases),
        'importar não apaga mais logo, badge nem apelidos (antes reescrevia o metadata inteiro)')

      // 3. Recusas
      if (outra) {
        const r2 = await editarContaManual(org, alvo.id, { nome: outra.nome, tipo: null, numero: null }, exec)
        t('error' in r2 && r2.error.includes(outra.nome), `renomear para o nome de outra conta ("${outra.nome}") é recusado`)
      }
      const r3 = await editarContaManual(org, alvo.id, { nome: '   ', tipo: null, numero: null }, exec)
      t('error' in r3, 'nome vazio é recusado')

      // 4. Voltar ao nome antigo funciona, e não perde apelido
      const r4 = await editarContaManual(org, alvo.id, { nome: alvo.nome, tipo: 'OTHER', numero: null }, exec)
      t('ok' in r4 && await contarPorNome(exec, alvo.nome) === Number(alvo.n), 'voltar ao nome antigo também propaga')

      const [lancTx] = await tx.select({ n: sql<string>`COUNT(*)::text` }).from(transactions)
        .where(and(eq(transactions.organizationId, org), eq(transactions.dataSourceId, alvo.id)))
      t(Number(lancTx.n) === Number(alvo.n), 'nenhum lançamento mudou de conta (vínculo intacto)')

      throw new Error(ROLLBACK)
    })
  } catch (e) {
    if ((e as Error).message !== ROLLBACK) throw e
  }

  // Fora da transação: nada persistiu.
  const [depois] = await db.execute<{ nome: string; badge: string | null }>(sql`
    SELECT name AS nome, metadata->'customBadge'->>'text' AS badge FROM data_sources WHERE id = ${alvo.id}::uuid`)
  t(depois.nome === alvo.nome && depois.badge !== 'TESTE', 'ROLLBACK: a produção ficou como estava')

  console.log(`\n${ok} ok, ${falhas} falha(s)`)
  process.exit(falhas ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
