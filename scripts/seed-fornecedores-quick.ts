/**
 * Depois da 0037: cadastra os dois agrupamentos da Quick Aviação e leva à mesa as
 * marcações feitas no painel de 24/nov. Idempotente: rodar duas vezes não duplica.
 *
 *   PERMITIR_BANCO_REMOTO=1 DATABASE_URL=<pooler> npx tsx --env-file=.env.local scripts/seed-fornecedores-quick.ts [--aplicar]
 *
 * Sem `--aplicar`, mostra o que faria e não grava (roda numa transação revertida).
 * `--testar-com-migration` aplica a 0037 dentro da mesma transação revertida — para
 * ensaiar ANTES de a migration existir na produção.
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { lerAgrupamentos, lerMesa, lerSaidasPorFornecedor, salvarAgrupamento, salvarItemMesa } from '@/lib/fornecedores'

const QUICK = '54358d88-bf7d-489b-b07b-aecfc031401d'
const TESTAR = process.argv.includes('--testar-com-migration')
const APLICAR = process.argv.includes('--aplicar') && !TESTAR
/** Escrita feita por script, não por uma pessoa. */
const SEM_USUARIO = '00000000-0000-0000-0000-000000000000'
class Reverter extends Error {}

/** As marcações do painel em 24/nov (lidas do banco do artefato), com a redução já digitada. */
const MESA_DO_PAINEL = [
  { rotulo: 'COMPLETI SOLUCOES COMPLETAS EM TECN INFO LTDA', tipo: 'pct' as const, reducao: 2 },
  { rotulo: 'TECNOSEG', tipo: 'pct' as const, reducao: 2 },
  { rotulo: '~ veryon www veryon co ca', tipo: 'pct' as const, reducao: 2 },
  { rotulo: 'J G ASSESSORIA', tipo: 'pct' as const, reducao: 0 },
]

async function main() {
  if (!process.env.PERMITIR_BANCO_REMOTO) { console.error('ABORTADO: defina PERMITIR_BANCO_REMOTO=1.'); process.exit(2) }
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '3s'`)
      if (TESTAR) await tx.execute(sql.raw(readFileSync('db/migrations/rls/0037_fornecedores.sql', 'utf8')))
      const [pai] = await tx.execute<{ id: string }>(sql`SELECT id::text AS id FROM categories WHERE organization_id = ${QUICK}::uuid AND parent_id IS NULL AND name = 'Despesas com Pessoal'`)
      const [ebury] = await tx.execute<{ id: string }>(sql`SELECT id::text AS id FROM contacts WHERE organization_id = ${QUICK}::uuid AND btrim(name) = 'EBURY CAMBIOS'`)
      if (!pai || !ebury) throw new Error('Natureza "Despesas com Pessoal" ou contato EBURY CAMBIOS não encontrados.')

      const existentes = await lerAgrupamentos(tx, QUICK)
      const querer = [
        { nome: 'Folha de pagamento (TEDs em lote)', padrao: 'ted pagamento fornecedor', naturezaPaiId: pai.id, contactId: null, sobrepoeContato: true },
        { nome: 'Câmbio Ebury (fornecedor a definir)', padrao: 'ebury', naturezaPaiId: null, contactId: ebury.id, sobrepoeContato: false },
      ]
      for (const g of querer) {
        if (existentes.some((e) => e.padrao === g.padrao)) { console.log(`  já existe: agrupamento "${g.nome}"`); continue }
        const r = await salvarAgrupamento(tx, QUICK, SEM_USUARIO, g)
        console.log('error' in r ? `  ERRO agrupamento "${g.nome}": ${r.error}` : `  agrupamento criado: "${g.nome}"`)
      }

      const lancs = await lerSaidasPorFornecedor(tx, QUICK, { de: '2026-01-01', ate: '2026-12-31' })
      const chavePorNome = new Map<string, string>()
      for (const l of lancs) if (l.grupo === 'Despesas') chavePorNome.set(l.fornecedor, l.chave)
      const naMesa = new Set((await lerMesa(tx, QUICK)).map((m) => m.chave))
      for (const m of MESA_DO_PAINEL) {
        const chave = chavePorNome.get(m.rotulo)
        if (!chave) { console.log(`  NÃO ACHEI na tela: "${m.rotulo}" (fica de fora)`); continue }
        if (naMesa.has(chave)) { console.log(`  já na mesa: "${m.rotulo}"`); continue }
        const r = await salvarItemMesa(tx, QUICK, SEM_USUARIO, { chave, rotulo: m.rotulo, tipo: m.tipo, reducao: m.reducao, nota: '' })
        console.log('error' in r ? `  ERRO mesa "${m.rotulo}": ${r.error}` : `  levado à mesa: "${m.rotulo}" (${chave}, ${m.reducao}%)`)
      }
      if (!APLICAR) throw new Reverter()
    })
    console.log(APLICAR ? '\nGravado.' : '\nSimulação: nada foi gravado (use --aplicar).')
  } catch (e) {
    if (e instanceof Reverter) console.log('\nSimulação: nada foi gravado (use --aplicar).')
    else { console.error(e); process.exit(1) }
  }
  process.exit(0)
}
main()
