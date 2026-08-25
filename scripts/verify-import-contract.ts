/**
 * Mede as quatro portas de entrada de `transactions` contra o contrato de
 * importação — e NÃO conserta nada.
 *
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-import-contract.ts
 *
 * Só leitura. Nenhum INSERT, UPDATE ou DELETE. É o mapa que guia as sessões B e
 * C: cada "FALHA" aqui é uma linha de trabalho lá, e cada percentual é o número
 * que precisa mudar para a sessão estar pronta.
 *
 * A seção mais útil não é a de conformidade — é a de **cabeçalhos vistos em
 * campo**. Ela varre o `raw_data` do staging real e diz se a lista de aliases do
 * contrato cobre o que os clientes de fato mandam, ANTES de a Sessão C escrever
 * o caminho rápido do parser.
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import {
  COLUNAS_MOVIMENTOS, COLUNAS_SALDOS, resolverCabecalho,
  normalizarLancamento, cabecalhoDoArquivoSchema, contaCanonica,
} from '@/lib/import-contract'
import { chavear, deduplica } from '@/lib/import-dedup'
import { norm } from '@/lib/format'

let ok = 0, alerta = 0
const t = (bom: boolean, msg: string) => {
  bom ? ok++ : alerta++
  console.log(`${bom ? 'OK   ' : 'FALTA'} | ${msg}`)
}
const pct = (n: number, d: number) => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`)

async function main() {
  // ═══ 1. Divergência entre as portas ═══════════════════════════════════════
  console.log('\n── as quatro portas, campo a campo ──')

  const portas = await db.execute<Record<string, unknown>>(sql`
    SELECT ds.provider,
           COUNT(*)::int                                                        AS n,
           COUNT(*) FILTER (WHERE t.external_id   IS NOT NULL)::int             AS dedup,
           COUNT(*) FILTER (WHERE t.account_id    IS NOT NULL)::int             AS conta_id,
           COUNT(*) FILTER (WHERE t.account_name  IS NOT NULL)::int             AS conta_nome,
           COUNT(*) FILTER (WHERE t.account_type  IS NOT NULL)::int             AS conta_tipo,
           COUNT(*) FILTER (WHERE t.effective_date IS NULL)::int                AS sem_caixa,
           -- IS DISTINCT FROM contaria os NULL como "diferente" e o numero
           -- viraria mentira: 1.361 linhas do Pluggy tem caixa nulo (anteriores
           -- a migration 0021), nao caixa diferente.
           COUNT(*) FILTER (WHERE t.effective_date IS NOT NULL
                              AND t.effective_date <> t.date)::int              AS caixa_difere,
           COUNT(*) FILTER (WHERE t.currency <> 'BRL')::int                     AS outra_moeda,
           COUNT(*) FILTER (WHERE t.status = 'pending')::int                    AS pendentes
      FROM transactions t
      JOIN data_sources ds ON ds.id = t.data_source_id
     GROUP BY ds.provider ORDER BY 2 DESC`)

  console.table(portas.map(p => ({
    porta: p.provider,
    lançamentos: p.n,
    dedup: pct(Number(p.dedup), Number(p.n)),
    'conta id': pct(Number(p.conta_id), Number(p.n)),
    'conta nome': pct(Number(p.conta_nome), Number(p.n)),
    'conta tipo': pct(Number(p.conta_tipo), Number(p.n)),
    'caixa ≠ compet.': p.caixa_difere,
    'caixa nulo': p.sem_caixa,
    'fora do BRL': p.outra_moeda,
    pendentes: p.pendentes,
  })))

  const upload = portas.find(p => p.provider === 'upload')
  const mcp = portas.find(p => p.provider === 'mcp')

  // As duas medidas abaixo são sobre o DADO, não sobre o código. A 4.5.B fez
  // `approveAndInsert` gravar `external_id` e os campos de conta; os 7.762
  // lançamentos anteriores continuam sem, porque ligar a dedup não alcança o
  // passado (risco declarado na migration 0031). O número só se move quando um
  // arquivo novo passar pela tela — e é exatamente isso que se quer medir.
  if (upload) {
    t(Number(upload.dedup) === Number(upload.n),
      `upload: deduplicação em ${pct(Number(upload.dedup), Number(upload.n))} — ` +
      'código corrigido na 4.5.B; o antigo não é alcançado. Suba um arquivo para o número andar')
    t(Number(upload.conta_id) === Number(upload.n),
      `upload: campos de conta em ${pct(Number(upload.conta_id), Number(upload.n))} — ` +
      'código corrigido na 4.5.B; depende de o arquivo declarar a conta na revisão')
  }
  if (mcp) {
    t(Number(mcp.conta_nome) === Number(mcp.n),
      `mcp: account_name em ${pct(Number(mcp.conta_nome), Number(mcp.n))} — Sessão C`)
  }

  const [caixa] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM transactions
     WHERE effective_date IS NOT NULL AND effective_date <> date`)
  t(Number(caixa.n) > 0,
    `data de caixa realmente diferente da competência: ${caixa.n} lançamento(s) na base inteira — ` +
    'a linha que descartava o campo em `process-document.ts` foi corrigida na 4.5.B; ' +
    'só um arquivo NOVO com data de caixa move este número')

  // ═══ 2. Conformidade linha a linha ════════════════════════════════════════
  console.log('\n── o que o contrato recusaria, por porta ──')

  const amostra = await db.execute<{
    provider: string; date: string; effective_date: string | null; amount: string
    direction: string; description: string; currency: string
    account_name: string | null; account_type: string | null; account_number: string | null
  }>(sql`
    SELECT ds.provider, t.date::text, t.effective_date::text, t.amount::text,
           t.direction, t.description, t.currency,
           t.account_name, t.account_type, t.account_number
      FROM transactions t
      JOIN data_sources ds ON ds.id = t.data_source_id
     ORDER BY random() LIMIT 4000`)

  const ctx = cabecalhoDoArquivoSchema.parse({})
  const recusas = new Map<string, Map<string, number>>()

  for (const r of amostra) {
    const res = normalizarLancamento({
      competencia: r.date,
      caixa: r.effective_date,
      descricao: r.description,
      valor: Number(r.amount),
      sentido: r.direction,
      moeda: r.currency,
      conta: r.account_name,
      tipoDeConta: r.account_type,
      numeroDaConta: r.account_number,
    }, ctx)
    if (!res.ok) {
      if (!recusas.has(r.provider)) recusas.set(r.provider, new Map())
      const m = recusas.get(r.provider)!
      m.set(res.motivo, (m.get(res.motivo) ?? 0) + 1)
    }
  }

  if (recusas.size === 0) {
    t(true, `as ${amostra.length} linhas amostradas passam pelo contrato sem recusa`)
  } else {
    for (const [porta, motivos] of Array.from(recusas.entries())) {
      const top = Array.from(motivos.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
      for (const [motivo, n] of top) t(false, `${porta}: ${n}× "${motivo}"`)
    }
  }

  // ═══ 3. Cabeçalhos vistos em campo ════════════════════════════════════════
  console.log('\n── cabeçalhos reais dos arquivos importados ──')

  // Por DOCUMENTO, não em bolo: cabeçalhos de arquivos diferentes misturados
  // nunca casariam com um layout, e o "não casa" seria vazio de significado.
  const brutos = await db.execute<{ document_id: string; raw_data: Record<string, unknown> }>(sql`
    SELECT DISTINCT ON (document_id, row_index) document_id, raw_data
      FROM transactions_staging ORDER BY document_id, row_index LIMIT 5000`)

  const porDocumento = new Map<string, Set<string>>()
  const vistos = new Map<string, number>()
  for (const r of brutos) {
    const chaves = Object.keys(r.raw_data ?? {}).filter(k => !k.startsWith('__'))
    if (!porDocumento.has(r.document_id)) porDocumento.set(r.document_id, new Set())
    for (const k of chaves) {
      porDocumento.get(r.document_id)!.add(k)
      vistos.set(k, (vistos.get(k) ?? 0) + 1)
    }
  }

  const todosAliases = new Set(
    COLUNAS_MOVIMENTOS.flatMap(c => [norm(c.canonico), ...c.aliases.map(norm)]),
  )
  const cobertos: string[] = []
  const orfaos: string[] = []
  for (const k of Array.from(vistos.keys())) {
    ;(todosAliases.has(norm(k)) ? cobertos : orfaos).push(k)
  }

  console.log(`  reconhecidos pelo contrato (${cobertos.length}): ${cobertos.join(' · ') || '—'}`)
  console.log(`  SEM alias (${orfaos.length}): ${orfaos.slice(0, 40).join(' · ') || '—'}`)
  t(vistos.size > 0, `${vistos.size} cabeçalhos distintos vistos em ${brutos.length} linhas de staging`)

  // Prova o caminho rápido contra cada arquivo que existe de verdade
  for (const [doc, chaves] of Array.from(porDocumento.entries())) {
    const r = resolverCabecalho(Array.from(chaves))
    t(r.completo,
      r.completo
        ? `documento ${doc.slice(0, 8)}: casaria com o caminho rápido (sem Haiku)`
        : `documento ${doc.slice(0, 8)}: falta ${r.faltando.join(', ')} — cairia no parser LLM, como deve`)
  }

  // ═══ 4. Buracos declarados ════════════════════════════════════════════════
  console.log('\n── o que ainda não aconteceu na base ──')

  // O contador que prova o ganho da 4.5.C ao longo do tempo. `extraction_method
  // = 'template'` passou a significar "cabeçalho canônico, lido sem IA" — antes
  // era o sistema de fingerprint, descartado na Fase 2 e sem escritor desde
  // então. Enquanto for 0, nenhum arquivo no formato publicado foi enviado.
  const [canon] = await db.execute<{ canonicos: number; total: number }>(sql`
    SELECT COUNT(*) FILTER (WHERE extraction_method = 'template')::int AS canonicos,
           COUNT(*)::int                                               AS total
      FROM documents WHERE storage_path NOT LIKE 'mcp://%'`)
  t(Number(canon.canonicos) > 0,
    `documentos lidos pelo caminho rápido (sem IA): ${canon.canonicos} de ${canon.total} — ` +
    'sobe quando alguém usar a planilha modelo ou um arquivo no formato publicado')

  const [bp] = await db.execute<{ docs: number; linhas: number }>(sql`
    SELECT COUNT(*)::int AS docs,
           (SELECT COUNT(*)::int FROM transactions t
             JOIN documents d2 ON d2.id = t.document_id
            WHERE d2.report_type = 'balance_sheet') AS linhas
      FROM documents WHERE report_type = 'balance_sheet'`)
  t(Number(bp.docs) > 0,
    `documentos de balanço: ${bp.docs} (${bp.linhas} linhas) — os defeitos de CÓDIGO foram ` +
    'corrigidos: o filtro `date && amount && direction` da tela (4.5.B) e o `reportType: other` ' +
    'cravado no MCP (4.5.C). Sobra a decisão de produto: o seed não cria naturezas de Balanço')

  const [prefixos] = await db.execute<{ antigo: number; novo: number }>(sql`
    SELECT COUNT(*) FILTER (WHERE external_id LIKE 'mcp:%')::int AS antigo,
           COUNT(*) FILTER (WHERE external_id LIKE 'arq:%')::int AS novo
      FROM transactions`)
  console.log(`  chaves com prefixo antigo 'mcp:': ${prefixos.antigo} · novo 'arq:': ${prefixos.novo}`)
  t(Number(prefixos.antigo) === 0,
    Number(prefixos.antigo) === 0
      ? 'nenhuma chave com o prefixo antigo — a troca é livre'
      : `${prefixos.antigo} chave(s) 'mcp:' a migrar com UPDATE de prefixo (o hash não inclui o prefixo)`)

  const [rastro] = await db.execute<{ com: number; total: number }>(sql`
    SELECT COUNT(*) FILTER (WHERE t.metadata ? 'stagingId')::int AS com, COUNT(*)::int AS total
      FROM transactions t JOIN data_sources ds ON ds.id = t.data_source_id
     WHERE ds.provider = 'upload'`)
  t(Number(rastro.com) === Number(rastro.total) && Number(rastro.total) > 0,
    `backfill de dedup no passado: ${rastro.com}/${rastro.total} linhas de upload têm stagingId — ` +
    'é por ele que se recupera a ordem original (row_index) que a numeração de ocorrência exige')

  // ═══ 5. Colunas declaradas sem leitor ═════════════════════════════════════
  console.log('\n── colunas declaradas, ainda sem leitor ──')
  const reservadas = Array.from(new Set(
    [...COLUNAS_MOVIMENTOS, ...COLUNAS_SALDOS].filter(c => c.leitor === 'reservada').map(c => c.canonico),
  )).map(canonico => ({ canonico }))
  console.log(`  ${reservadas.map(c => c.canonico).join(' · ')}`)
  t(reservadas.length === 0,
    `${reservadas.length} coluna(s) na planilha ainda não são lidas na importação — pendência declarada`)

  // ═══ 6. Sanidade do próprio contrato ══════════════════════════════════════
  console.log('\n── sanidade do contrato ──')

  const duas = chavear([
    { competencia: '2027-03-05', valor: 15, sentido: 'outflow', descricao: 'CAFE' },
    { competencia: '2027-03-05', valor: 15, sentido: 'outflow', descricao: 'CAFE' },
  ])
  t(duas[0] !== duas[1], 'duas linhas idênticas recebem chaves diferentes (ocorrência)')
  const denovo = chavear([
    { competencia: '2027-03-05', valor: 15, sentido: 'outflow', descricao: 'CAFE' },
    { competencia: '2027-03-05', valor: 15, sentido: 'outflow', descricao: 'CAFE' },
  ])
  t(duas[0] === denovo[0] && duas[1] === denovo[1], 'e o mesmo arquivo reimportado gera as mesmas chaves')
  t(!deduplica('balanco') && deduplica('movimentos'), 'balanço não deduplica; movimentos sim')

  const c = contaCanonica('Itaú C/C', 'C. Corrente', '12345-6')
  t(c.accountId === 'arq:itau-c-c' && c.accountType === 'CHECKING_ACCOUNT',
    `conta canônica: "Itaú C/C" → ${c.accountId} / ${c.accountType}`)

  const semData = normalizarLancamento({ descricao: 'X', valor: 10, sentido: 'Saída' }, ctx)
  t(!semData.ok, 'linha sem competência é recusada com motivo, não jogada fora em silêncio')

  const bpCtx = cabecalhoDoArquivoSchema.parse({ tipoDeRelatorio: 'balanco', dataDeReferencia: '2027-01-31' })
  const saldo = normalizarLancamento({ natureza: '1.1.01', valor: 84300 }, bpCtx)
  t(saldo.ok && saldo.valor.date === '2027-01-31' && saldo.valor.direction === 'inflow',
    'linha de balanço herda a data do arquivo e entra como inflow')

  const bpSemData = cabecalhoDoArquivoSchema.safeParse({ tipoDeRelatorio: 'balanco' })
  t(!bpSemData.success, 'balanço sem data de referência é recusado no nível do arquivo')

  console.log(`\n${ok} ok, ${alerta} pendência(s)`)
  console.log(
    'As Sessões B e C fecharam o CÓDIGO das duas portas de arquivo. As pendências acima são sobre o\n' +
    'DADO: nenhum arquivo passou ainda pelo caminho novo, e a dedup não alcança o que já entrou. Os\n' +
    'números andam quando houver importação nova — é assim que este relatório continua honesto.\n' +
    'Fora isso, sobra uma decisão de PRODUTO: o seed do plano de contas não cria nenhuma natureza de\n' +
    'Balanço, então organização nova importa o BP e /balanco continua vazio.',
  )
  process.exit(0)
}

main().catch((e) => { console.error('ERRO:', e); process.exit(1) })
