/**
 * Exercita o servidor MCP contra um `next start` de verdade, por HTTP.
 *
 *   npx next build
 *   DATABASE_URL="<pooler>" npx next start -p 3100 &
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-mcp.ts
 *
 * Ao contrário do teste do OAuth, aqui o usuário e a organização são REAIS: as
 * ferramentas juntam com `memberships`, e um usuário sintético devolveria lista
 * vazia — o teste passaria sem provar nada. O que o teste escreve é um cliente
 * OAuth de teste (apagado no fim, com CASCADE levando grant e tokens) e as
 * linhas de auditoria da própria chamada, também apagadas.
 */
import { db } from '@/db'
import { oauthClients, agentEvents } from '@/db/schema'
import { and, eq, like, sql } from 'drizzle-orm'
import { garantirGrant, emitirTokens } from '@/lib/oauth/store'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const RECURSO = `${BASE}/api/mcp`
const NOME = 'Conferencia MCP 3.2'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

let proximoId = 1

async function rpc(token: string | null, method: string, params?: unknown) {
  const id = proximoId++
  const r = await fetch(RECURSO, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
  })
  const texto = await r.text()
  let json: Record<string, unknown> | null = null
  try { json = JSON.parse(texto) } catch { /* 401 devolve JSON, mas 202 não devolve nada */ }
  return { status: r.status, headers: r.headers, json, texto }
}

/** O conteúdo de um `tools/call` bem-sucedido, já desembrulhado. */
function saida(resp: { json: Record<string, unknown> | null }): { dados: unknown; isError: boolean; texto: string } {
  const result = (resp.json?.result ?? {}) as Record<string, unknown>
  const conteudo = (result.content ?? []) as { type: string; text: string }[]
  const texto = conteudo.map(c => c.text).join('\n')
  let dados: unknown = result.structuredContent
  if (dados === undefined) { try { dados = JSON.parse(texto) } catch { dados = null } }
  return { dados, isError: result.isError === true, texto }
}

async function main() {
  await db.delete(oauthClients).where(like(oauthClients.clientName, `${NOME}%`))

  // ── Um par (usuário, organização) real, o que tiver mais lançamentos ──────
  const [alvo] = await db.execute<{ user_id: string; organization_id: string; n: number }>(sql`
    SELECT m.user_id::text, m.organization_id::text, COUNT(t.id)::int AS n
    FROM memberships m
    LEFT JOIN transactions t ON t.organization_id = m.organization_id
    WHERE m.accepted_at IS NOT NULL
    GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 1`)
  if (!alvo) throw new Error('Nenhuma membership aceita no banco — o teste não tem o que exercitar.')
  const USUARIO = alvo.user_id
  const EMPRESA = alvo.organization_id
  console.log(`(organização de teste: ${EMPRESA} — ${alvo.n} lançamentos)\n`)

  // ── Uma organização à qual este usuário NÃO tem acesso ───────────────────
  const [alheia] = await db.execute<{ id: string }>(sql`
    SELECT o.id::text FROM organizations o
    WHERE o.id <> ${EMPRESA}::uuid
      AND NOT EXISTS (SELECT 1 FROM memberships m
                      WHERE m.organization_id = o.id AND m.user_id = ${USUARIO}::uuid)
    LIMIT 1`)

  const clientId = 'lure_cli_conferencia_mcp'
  await db.insert(oauthClients).values({
    clientId, clientName: NOME, redirectUris: [`${BASE}/cb`],
  })
  const grantId = await garantirGrant({
    userId: USUARIO, clientId, organizationIds: [EMPRESA], scopes: ['leitura'],
  })
  const { accessToken } = await emitirTokens(grantId, RECURSO, ['leitura'])

  // ═══ Autenticação ═════════════════════════════════════════════════════════
  console.log('── autenticação ──')

  const semToken = await rpc(null, 'initialize')
  t(semToken.status === 401, `sem token: 401 (${semToken.status})`)
  const desafio = semToken.headers.get('www-authenticate') ?? ''
  t(desafio.includes('resource_metadata=') && desafio.includes('/.well-known/oauth-protected-resource'),
    'o 401 traz WWW-Authenticate apontando o metadata — é o que dispara a descoberta')

  const tokenFalso = await rpc('lure_at_naoexiste', 'initialize')
  t(tokenFalso.status === 401, 'token desconhecido: 401')

  // Audiência: token emitido para outro recurso não vale aqui (RFC 8707).
  const { accessToken: tokenDeOutro } = await emitirTokens(grantId, 'https://outro.servidor/api/mcp', ['leitura'])
  const audienciaErrada = await rpc(tokenDeOutro, 'initialize')
  t(audienciaErrada.status === 401 &&
    String((audienciaErrada.json as Record<string, string>)?.error_description ?? '').includes('outro recurso'),
    'token com audiência de outro servidor: 401 — é a validação do RFC 8707')

  // ═══ Handshake ════════════════════════════════════════════════════════════
  console.log('\n── handshake ──')

  const ini = await rpc(accessToken, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'teste', version: '1' },
  })
  const r = (ini.json?.result ?? {}) as Record<string, unknown>
  t(ini.status === 200 && r.protocolVersion === '2025-06-18', 'initialize devolve a versão pedida')
  t((r.serverInfo as Record<string, string>)?.name === 'lure.expert', 'serverInfo identifica o lure.expert')
  t(typeof r.instructions === 'string' && (r.instructions as string).includes('listar_organizacoes'),
    'as instruções ensinam a começar por listar_organizacoes')
  t(!!(r.capabilities as Record<string, unknown>)?.tools, 'anuncia capacidade de ferramentas')

  const versaoAntiga = await rpc(accessToken, 'initialize', { protocolVersion: '2024-11-05' })
  t(((versaoAntiga.json?.result ?? {}) as Record<string, string>).protocolVersion === '2024-11-05',
    'aceita versão antiga do protocolo em vez de recusar a conexão')

  const notif = await fetch(RECURSO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  })
  t(notif.status === 202, `notificação não recebe resposta: 202 (${notif.status})`)

  const get = await fetch(RECURSO, { headers: { Authorization: `Bearer ${accessToken}` } })
  t(get.status === 405, `GET (fluxo SSE) devolve 405 — não temos o que empurrar (${get.status})`)

  // ═══ Catálogo ═════════════════════════════════════════════════════════════
  console.log('\n── catálogo ──')

  const lista = await rpc(accessToken, 'tools/list')
  const tools = ((lista.json?.result ?? {}) as { tools?: { name: string; inputSchema: Record<string, unknown> }[] }).tools ?? []
  t(tools.length === 4, `4 ferramentas de leitura (${tools.map(x => x.name).join(', ')})`)
  const consultarTool = tools.find(x => x.name === 'consultar')
  const props = (consultarTool?.inputSchema?.properties ?? {}) as Record<string, unknown>
  t(!!props.organizationId && !!props.medidas && !!props.periodo,
    'o schema de `consultar` publica organizationId, medidas e periodo')
  const obrigatorios = (consultarTool?.inputSchema?.required ?? []) as string[]
  t(obrigatorios.includes('organizationId') && obrigatorios.includes('periodo') && !obrigatorios.includes('limite'),
    'io:input funcionou — só o que não tem default é obrigatório (limite ficou de fora)')

  const desconhecida = await rpc(accessToken, 'tools/call', { name: 'apagar_tudo', arguments: {} })
  t((desconhecida.json?.error as { code: number })?.code === -32601,
    'ferramenta inexistente: erro de protocolo -32601')

  // ═══ Contexto ═════════════════════════════════════════════════════════════
  console.log('\n── contexto ──')

  const orgs = saida(await rpc(accessToken, 'tools/call', { name: 'listar_organizacoes', arguments: {} }))
  const listaOrgs = (orgs.dados as { organizacoes: { id: string }[] })?.organizacoes ?? []
  t(listaOrgs.length === 1 && listaOrgs[0].id === EMPRESA,
    'listar_organizacoes devolve exatamente a empresa consentida')

  const desc = saida(await rpc(accessToken, 'tools/call', {
    name: 'descrever_organizacao', arguments: { organizationId: EMPRESA },
  }))
  const d = desc.dados as { lancamentos: number; periodoComDados: { de: string; ate: string } | null }
  t(!desc.isError && Number(d.lancamentos) === Number(alvo.n),
    `descrever_organizacao bate com o banco (${d.lancamentos} lançamentos)`)
  t(d.periodoComDados !== null, `informa o período com dados (${d.periodoComDados?.de} a ${d.periodoComDados?.ate})`)

  if (alheia) {
    const proibida = saida(await rpc(accessToken, 'tools/call', {
      name: 'descrever_organizacao', arguments: { organizationId: alheia.id },
    }))
    t(proibida.isError && proibida.texto.includes('listar_organizacoes'),
      'organização fora do consentimento: ERRO com instrução de correção, nunca resultado vazio')
  } else {
    console.log('(pulado: não há outra organização no banco para sondar)')
  }

  const argRuim = saida(await rpc(accessToken, 'tools/call', {
    name: 'descrever_organizacao', arguments: { organizationId: 'nao-e-uuid' },
  }))
  t(argRuim.isError, 'argumento fora do schema volta como isError, não como falha de transporte')

  // ═══ Consulta ═════════════════════════════════════════════════════════════
  console.log('\n── consulta ──')

  const janela = d.periodoComDados ?? { de: '2020-01-01', ate: '2030-12-31' }

  const total = saida(await rpc(accessToken, 'tools/call', {
    name: 'consultar',
    arguments: {
      organizationId: EMPRESA,
      periodo: { tipo: 'intervalo', de: janela.de, ate: janela.ate },
      medidas: ['valor_liquido', 'contagem'],
    },
  }))
  const linhasTotal = (total.dados as { linhas: { medidas: Record<string, number> }[] })?.linhas ?? []
  t(!total.isError && linhasTotal.length === 1, 'consulta sem agrupamento devolve uma linha')
  const somaTotal = Number(linhasTotal[0]?.medidas?.valor_liquido ?? NaN)
  t(Number.isFinite(somaTotal), `total do período: ${somaTotal.toFixed(2)}`)

  const porMes = saida(await rpc(accessToken, 'tools/call', {
    name: 'consultar',
    arguments: {
      organizationId: EMPRESA,
      periodo: { tipo: 'intervalo', de: janela.de, ate: janela.ate },
      medidas: ['valor_liquido'],
      agruparPor: ['mes'],
      limite: 500,
    },
  }))
  const meses = (porMes.dados as { linhas: { medidas: Record<string, number> }[]; truncado: boolean })
  const somaMeses = (meses?.linhas ?? []).reduce((a, l) => a + Number(l.medidas.valor_liquido ?? 0), 0)
  t(meses?.truncado === false, `${meses?.linhas.length} meses, sem truncar`)
  t(Math.abs(somaMeses - somaTotal) < 0.01,
    `a soma dos meses fecha com o total (${somaMeses.toFixed(2)} vs ${somaTotal.toFixed(2)})`)

  const topUens = saida(await rpc(accessToken, 'tools/call', {
    name: 'consultar',
    arguments: {
      organizationId: EMPRESA,
      periodo: { tipo: 'intervalo', de: janela.de, ate: janela.ate },
      medidas: ['saidas'],
      agruparPor: ['unidade_de_negocio'],
      ordenarPor: [{ por: 'saidas', direcao: 'desc' }],
      limite: 5,
    },
  }))
  t(!topUens.isError && Array.isArray((topUens.dados as { linhas: unknown[] })?.linhas),
    '"top 5 unidades de negócio" — o pedido que motivou o motor — responde')

  // A recusa que faz o modelo se corrigir sozinho, em vez de tentar às cegas.
  const nfePorCc = saida(await rpc(accessToken, 'tools/call', {
    name: 'consultar',
    arguments: {
      organizationId: EMPRESA,
      fonte: 'nfe',
      periodo: { tipo: 'intervalo', de: janela.de, ate: janela.ate },
      agruparPor: ['centro_de_custo'],
    },
  }))
  t(nfePorCc.isError && nfePorCc.texto.toLowerCase().includes('dispon'),
    'NF-e por centro de custo: recusa dizendo o que existe no lugar')

  const limiteAlto = saida(await rpc(accessToken, 'tools/call', {
    name: 'consultar',
    arguments: {
      organizationId: EMPRESA,
      periodo: { tipo: 'intervalo', de: janela.de, ate: janela.ate },
      limite: 5000,
    },
  }))
  t(limiteAlto.isError, 'limite acima do teto é recusado pelo Zod antes de tocar o banco')

  const explicado = saida(await rpc(accessToken, 'tools/call', {
    name: 'explicar_consulta',
    arguments: { periodo: { tipo: 'relativo', meses: 3 }, medidas: ['valor_liquido'] },
  }))
  const exp = explicado.dados as { periodo: { de: string; ate: string }; regime: string }
  t(!explicado.isError && /^\d{4}-\d{2}-\d{2}$/.test(exp?.periodo?.de ?? ''),
    `explicar_consulta resolve "últimos 3 meses" em datas concretas (${exp?.periodo?.de} a ${exp?.periodo?.ate})`)

  // ═══ Auditoria e limpeza ══════════════════════════════════════════════════
  console.log('\n── auditoria ──')

  const [aud] = await db.execute<{ n: number; falhas: number }>(sql`
    SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE NOT success)::int AS falhas
    FROM agent_events
    WHERE type = 'mcp_tool_call' AND payload->>'clientId' = ${clientId}`)
  t(Number(aud.n) > 0, `${aud.n} chamadas registradas em agent_events (${aud.falhas} com erro)`)

  const [custo] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM agent_events
    WHERE type = 'mcp_tool_call' AND payload->>'clientId' = ${clientId} AND cost_usd IS NOT NULL`)
  t(Number(custo.n) === 0,
    'nenhuma chamada MCP grava custo — a tela de consumo filtra por cost_usd e não é poluída')

  await db.delete(agentEvents).where(and(
    eq(agentEvents.type, 'mcp_tool_call'),
    sql`${agentEvents.payload}->>'clientId' = ${clientId}`,
  ))
  await db.delete(oauthClients).where(like(oauthClients.clientName, `${NOME}%`))

  const depois = await rpc(accessToken, 'initialize')
  t(depois.status === 401,
    'limpeza: apagado o cliente, o token deixa de valer no mesmo instante (CASCADE)')

  console.log(`\n${ok} ok, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('ERRO:', e)
  try {
    await db.delete(agentEvents).where(and(
      eq(agentEvents.type, 'mcp_tool_call'),
      sql`${agentEvents.payload}->>'clientId' = 'lure_cli_conferencia_mcp'`,
    ))
    await db.delete(oauthClients).where(like(oauthClients.clientName, `${NOME}%`))
  } catch { /* nada */ }
  process.exit(1)
})
