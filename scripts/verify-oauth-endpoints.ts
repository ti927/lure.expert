/**
 * Exercita os endpoints OAuth contra um servidor DE VERDADE, por HTTP.
 *
 * Não é teste de unidade: sobe `next start`, bate nas rotas como o claude.ai
 * bateria, e confere o efeito no banco. É a única forma de provar que o rewrite
 * do `.well-known` funciona, que o form-urlencoded é lido, e que o código
 * queimado ficou queimado.
 *
 *   npx next build
 *   DATABASE_URL="<pooler>" npx next start -p 3100 &
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-oauth-endpoints.ts
 *
 * O que ele escreve no banco são clientes de teste, nomeados `Conferencia 3.1`,
 * apagados no fim — e o CASCADE leva consentimentos, códigos e tokens junto.
 * Usuário e organização são UUIDs sintéticos: as colunas não têm FK, e assim o
 * teste não encosta em dado real.
 */
import { db } from '@/db'
import { oauthClients, oauthTokens, oauthAccessGrants } from '@/db/schema'
import { like, eq, inArray } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import { calcularChallenge } from '@/lib/oauth/pkce'
import { criarCodigo, resolverTokenDeAcesso } from '@/lib/oauth/store'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const NOME = 'Conferencia 3.1'
const CB = `${BASE}/cb`

const USUARIO = '11111111-1111-1111-1111-111111111111'
const EMPRESA = '22222222-2222-2222-2222-222222222222'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

async function pegar(caminho: string, init?: RequestInit) {
  const r = await fetch(BASE + caminho, { redirect: 'manual', ...init })
  const texto = await r.text()
  let json: Record<string, unknown> | null = null
  try { json = JSON.parse(texto) } catch { /* html ou vazio */ }
  return { status: r.status, headers: r.headers, texto, json }
}

const form = (params: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(params).toString(),
})

const jsonBody = (dados: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(dados),
})

/** Verifier no alfabeto do RFC 7636, 43 caracteres. */
const novoVerifier = () => randomBytes(32).toString('base64url')

async function main() {
  await db.delete(oauthClients).where(like(oauthClients.clientName, `${NOME}%`))

  // ═══ Descoberta ═══════════════════════════════════════════════════════════
  console.log('── descoberta (RFC 8414 e RFC 9728) ──')

  const as = await pegar('/.well-known/oauth-authorization-server')
  t(as.status === 200, `metadata do servidor responde 200 (${as.status})`)
  t(as.json?.issuer === BASE, `issuer é o host pelo qual se chegou (${as.json?.issuer})`)
  t(as.json?.authorization_endpoint === `${BASE}/oauth/authorize`, 'aponta o /oauth/authorize')
  t(as.json?.token_endpoint === `${BASE}/api/oauth/token`, 'aponta o /api/oauth/token')
  t(as.json?.registration_endpoint === `${BASE}/api/oauth/register`, 'anuncia registro dinâmico')
  t(JSON.stringify(as.json?.code_challenge_methods_supported) === '["S256"]',
    'anuncia S256 e SÓ S256 — plain nem aparece como opção')
  t((as.headers.get('access-control-allow-origin') ?? '') === '*',
    'CORS aberto na descoberta — sem isso um cliente de navegador nem começa')

  const pr = await pegar('/.well-known/oauth-protected-resource')
  t(pr.status === 200 && pr.json?.resource === `${BASE}/api/mcp`,
    `metadata do recurso aponta ${pr.json?.resource}`)
  t(JSON.stringify(pr.json?.authorization_servers) === JSON.stringify([BASE]),
    'o recurso aponta de volta para este mesmo servidor de autorização')

  // O RFC 8414 permite o cliente inserir o caminho do recurso depois do
  // .well-known. Se só a forma curta funcionasse, metade dos clientes falharia.
  const comSufixo = await pegar('/.well-known/oauth-authorization-server/api/mcp')
  t(comSufixo.status === 200 && comSufixo.json?.issuer === BASE,
    'a variante com o caminho do recurso no sufixo devolve o mesmo documento')

  // ═══ Registro dinâmico (RFC 7591) ═════════════════════════════════════════
  console.log('\n── registro dinâmico ──')

  const ruim = await pegar('/api/oauth/register', jsonBody({
    client_name: `${NOME} ruim`, redirect_uris: ['http://exemplo.com/cb'],
  }))
  t(ruim.status === 400 && ruim.json?.error === 'invalid_redirect_uri',
    'http fora de localhost é recusado (o spec exige HTTPS)')

  const comFragmento = await pegar('/api/oauth/register', jsonBody({
    client_name: `${NOME} frag`, redirect_uris: ['https://claude.ai/cb#x'],
  }))
  t(comFragmento.status === 400, 'redirect com fragmento é recusado')

  const semNada = await pegar('/api/oauth/register', jsonBody({
    client_name: `${NOME} vazio`, redirect_uris: [],
  }))
  t(semNada.status === 400, 'registro sem nenhum redirect é recusado')

  const reg = await pegar('/api/oauth/register', jsonBody({
    client_name: `${NOME} publico`, redirect_uris: [CB],
  }))
  t(reg.status === 201, `registro válido devolve 201 (${reg.status})`)
  const clientId = String(reg.json?.client_id ?? '')
  t(clientId.startsWith('lure_cli_'), `client_id gerado (${clientId.slice(0, 18)}…)`)
  t(reg.json?.client_secret === undefined,
    'cliente público não recebe segredo — o que o protege é o PKCE')

  const regConf = await pegar('/api/oauth/register', jsonBody({
    client_name: `${NOME} confidencial`, redirect_uris: [CB],
    token_endpoint_auth_method: 'client_secret_post',
  }))
  const clientIdConf = String(regConf.json?.client_id ?? '')
  const segredo = String(regConf.json?.client_secret ?? '')
  t(segredo.startsWith('lure_cs_'), 'cliente confidencial recebe segredo, uma vez só')

  const [linhaConf] = await db.select({ hash: oauthClients.clientSecretHash })
    .from(oauthClients).where(eq(oauthClients.clientId, clientIdConf))
  t(!!linhaConf?.hash && linhaConf.hash !== segredo && /^[0-9a-f]{64}$/.test(linhaConf.hash),
    'o banco guardou o HASH do segredo, não o segredo')

  // ═══ /oauth/authorize — a tela ════════════════════════════════════════════
  console.log('\n── autorização (tela) ──')

  const semCliente = await pegar('/oauth/authorize?response_type=code&client_id=nao_existe' +
    `&redirect_uri=${encodeURIComponent(CB)}&code_challenge=abc&code_challenge_method=S256`)
  t(semCliente.status === 200 && semCliente.texto.includes('Não foi possível autorizar'),
    'cliente desconhecido: mostra a recusa na tela e NÃO redireciona')

  const redirectAlheio = await pegar(`/oauth/authorize?response_type=code&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent('https://evil.example/cb')}` +
    '&code_challenge=abc&code_challenge_method=S256')
  t(redirectAlheio.status === 200 && !redirectAlheio.headers.get('location'),
    'redirect não registrado: recusa na tela, sem Location — nada de encaminhador aberto')

  const semSessao = await pegar(`/oauth/authorize?response_type=code&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(CB)}&code_challenge=abc&code_challenge_method=S256&state=xyz`)
  const paraLogin = semSessao.headers.get('location') ?? ''
  t([302, 303, 307].includes(semSessao.status) && paraLogin.includes('/login?next='),
    `sem sessão manda para o login (${semSessao.status})`)
  t(decodeURIComponent(paraLogin).includes('state=xyz'),
    'o pedido inteiro viaja no ?next= — o state sobrevive ao login')

  const tipoErrado = await pegar(`/oauth/authorize?response_type=token&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(CB)}&code_challenge=abc&code_challenge_method=S256&state=s1`)
  const voltaErro = tipoErrado.headers.get('location') ?? ''
  t(voltaErro.startsWith(CB) && voltaErro.includes('error=unsupported_response_type') && voltaErro.includes('state=s1'),
    'com o par (cliente, redirect) provado, o erro volta PELA URL, com o state')

  const semPkce = await pegar(`/oauth/authorize?response_type=code&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(CB)}`)
  t((semPkce.headers.get('location') ?? '').includes('error=invalid_request'),
    'pedido sem code_challenge é recusado — PKCE não é opcional')

  const metodoPlain = await pegar(`/oauth/authorize?response_type=code&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(CB)}&code_challenge=abc&code_challenge_method=plain`)
  t((metodoPlain.headers.get('location') ?? '').includes('error=invalid_request'),
    'code_challenge_method=plain é recusado na porta de entrada')

  const semOrigem = await pegar('/oauth/authorize/decidir', form({ client_id: clientId, decisao: 'aprovar' }))
  t(semOrigem.status === 403, 'POST na decisão sem Origin de mesma origem: 403 (defesa de CSRF)')

  // ═══ /api/oauth/token ═════════════════════════════════════════════════════
  console.log('\n── troca de código por token ──')

  const semCred = await pegar('/api/oauth/token', form({ grant_type: 'authorization_code', code: 'x' }))
  t(semCred.status === 401 && semCred.json?.error === 'invalid_client',
    'sem client_id: 401 invalid_client')

  const tipoDesconhecido = await pegar('/api/oauth/token', form({
    grant_type: 'password', client_id: clientId, username: 'a', password: 'b',
  }))
  t(tipoDesconhecido.json?.error === 'unsupported_grant_type',
    'grant_type fora dos dois suportados é recusado por nome')

  const segredoErrado = await pegar('/api/oauth/token', form({
    grant_type: 'authorization_code', client_id: clientIdConf, client_secret: 'lure_cs_errado', code: 'x',
  }))
  t(segredoErrado.status === 401, 'segredo de cliente errado: 401')

  // ── Verifier errado queima o código assim mesmo ──────────────────────────
  const v1 = novoVerifier()
  const c1 = await criarCodigo({
    clientId, userId: USUARIO, redirectUri: CB,
    codeChallenge: calcularChallenge(v1), scopes: ['leitura'],
    organizationIds: [EMPRESA], resource: `${BASE}/api/mcp`,
  })
  const pkceErrado = await pegar('/api/oauth/token', form({
    grant_type: 'authorization_code', client_id: clientId, code: c1,
    redirect_uri: CB, code_verifier: novoVerifier(),
  }))
  t(pkceErrado.status === 400 && pkceErrado.json?.error === 'invalid_grant',
    'code_verifier que não corresponde ao challenge: invalid_grant')
  const c1DeNovo = await pegar('/api/oauth/token', form({
    grant_type: 'authorization_code', client_id: clientId, code: c1,
    redirect_uri: CB, code_verifier: v1,
  }))
  t(c1DeNovo.status === 400,
    'e o código foi queimado na tentativa: nem o verifier certo o ressuscita')

  // ── redirect_uri diferente do usado na autorização ───────────────────────
  const v2 = novoVerifier()
  const c2 = await criarCodigo({
    clientId, userId: USUARIO, redirectUri: CB,
    codeChallenge: calcularChallenge(v2), scopes: ['leitura'],
    organizationIds: [EMPRESA], resource: `${BASE}/api/mcp`,
  })
  const outroRedirect = await pegar('/api/oauth/token', form({
    grant_type: 'authorization_code', client_id: clientId, code: c2,
    redirect_uri: `${BASE}/outro`, code_verifier: v2,
  }))
  t(outroRedirect.json?.error === 'invalid_grant', 'redirect_uri diferente do autorizado: invalid_grant')

  // ── Código de um cliente apresentado por outro ───────────────────────────
  const v3 = novoVerifier()
  const c3 = await criarCodigo({
    clientId, userId: USUARIO, redirectUri: CB,
    codeChallenge: calcularChallenge(v3), scopes: ['leitura'],
    organizationIds: [EMPRESA], resource: `${BASE}/api/mcp`,
  })
  const clienteTrocado = await pegar('/api/oauth/token', form({
    grant_type: 'authorization_code', client_id: clientIdConf, client_secret: segredo,
    code: c3, redirect_uri: CB, code_verifier: v3,
  }))
  t(clienteTrocado.json?.error === 'invalid_grant',
    'código emitido para um cliente não vale na mão de outro')

  // ── Audiência (RFC 8707) ─────────────────────────────────────────────────
  const alvoAlheio = await pegar('/api/oauth/token', form({
    grant_type: 'authorization_code', client_id: clientId, code: 'x',
    redirect_uri: CB, code_verifier: novoVerifier(), resource: 'https://outro.servidor/api/mcp',
  }))
  t(alvoAlheio.json?.error === 'invalid_target',
    'token pedido para outro recurso: invalid_target — é a audiência do RFC 8707')

  // ── O caminho feliz ──────────────────────────────────────────────────────
  const v4 = novoVerifier()
  const c4 = await criarCodigo({
    clientId, userId: USUARIO, redirectUri: CB,
    codeChallenge: calcularChallenge(v4), scopes: ['leitura', 'escrita'],
    organizationIds: [EMPRESA], resource: `${BASE}/api/mcp`,
  })
  const troca = await pegar('/api/oauth/token', form({
    grant_type: 'authorization_code', client_id: clientId, code: c4,
    redirect_uri: CB, code_verifier: v4, resource: `${BASE}/api/mcp`,
  }))
  t(troca.status === 200, `troca válida devolve 200 (${troca.status})`)
  const acesso1 = String(troca.json?.access_token ?? '')
  const refresh1 = String(troca.json?.refresh_token ?? '')
  t(acesso1.startsWith('lure_at_') && refresh1.startsWith('lure_rt_'), 'devolve access e refresh')
  t(troca.json?.token_type === 'Bearer' && troca.json?.expires_in === 3600, 'Bearer, 1 hora')
  t(troca.json?.scope === 'leitura escrita', 'devolve os escopos consentidos')
  t((troca.headers.get('cache-control') ?? '').includes('no-store'),
    'resposta com token não pode ser cacheada')

  const resolvido = await resolverTokenDeAcesso(acesso1)
  t(resolvido.ok && resolvido.organizationIds[0] === EMPRESA && resolvido.userId === USUARIO,
    'o access token resolve para o usuário e a empresa consentidos')

  // ── Reuso do código: os tokens nascidos dele caem ────────────────────────
  const reuso = await pegar('/api/oauth/token', form({
    grant_type: 'authorization_code', client_id: clientId, code: c4,
    redirect_uri: CB, code_verifier: v4,
  }))
  t(reuso.status === 400 && reuso.json?.error === 'invalid_grant', 'código reapresentado: invalid_grant')
  const depoisDoReuso = await resolverTokenDeAcesso(acesso1)
  t(!depoisDoReuso.ok && depoisDoReuso.motivo === 'revogado',
    'e o token emitido a partir dele foi REVOGADO — código reusado é tratado como roubo')

  // ═══ Rotação de refresh ═══════════════════════════════════════════════════
  console.log('\n── rotação de refresh ──')

  const v5 = novoVerifier()
  const c5 = await criarCodigo({
    clientId, userId: USUARIO, redirectUri: CB,
    codeChallenge: calcularChallenge(v5), scopes: ['leitura'],
    organizationIds: [EMPRESA], resource: `${BASE}/api/mcp`,
  })
  const t5 = await pegar('/api/oauth/token', form({
    grant_type: 'authorization_code', client_id: clientId, code: c5,
    redirect_uri: CB, code_verifier: v5,
  }))
  const refreshA = String(t5.json?.refresh_token ?? '')

  const rot = await pegar('/api/oauth/token', form({
    grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshA,
  }))
  t(rot.status === 200, 'refresh válido devolve par novo')
  const acessoB = String(rot.json?.access_token ?? '')
  const refreshB = String(rot.json?.refresh_token ?? '')
  t(refreshB !== refreshA && refreshB.startsWith('lure_rt_'),
    'o refresh MUDA a cada uso — é a rotação que o spec exige de cliente público')

  const refreshAlheio = await pegar('/api/oauth/token', form({
    grant_type: 'refresh_token', client_id: clientIdConf, client_secret: segredo, refresh_token: refreshB,
  }))
  t(refreshAlheio.json?.error === 'invalid_grant', 'um cliente não renova o refresh do outro')

  // Guardar o grant ANTES: depois do reuso, o token não resolve mais e não há
  // como chegar nele pelo token. É o grant que prova que a cadeia caiu — o
  // token sozinho só provaria que aquele token caiu.
  const antesDoReuso = await resolverTokenDeAcesso(acessoB)
  const grantDaCadeia = antesDoReuso.ok ? antesDoReuso.grantId : ''

  const reusoRefresh = await pegar('/api/oauth/token', form({
    grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshA,
  }))
  t(reusoRefresh.status === 400, 'refresh já rotacionado, apresentado de novo: recusado')

  const depoisDoReusoRefresh = await resolverTokenDeAcesso(acessoB)
  t(!depoisDoReusoRefresh.ok, 'o access token vivo daquela cadeia deixa de valer')

  const [grantApos] = await db.select({ revokedAt: oauthAccessGrants.revokedAt })
    .from(oauthAccessGrants).where(eq(oauthAccessGrants.id, grantDaCadeia))
  t(!!grantApos?.revokedAt,
    'e o CONSENTIMENTO foi revogado — reuso de refresh é sinal de roubo, e derruba a cadeia inteira')

  // ═══ Revogação (RFC 7009) ═════════════════════════════════════════════════
  console.log('\n── revogação ──')

  const v6 = novoVerifier()
  const c6 = await criarCodigo({
    clientId, userId: USUARIO, redirectUri: CB,
    codeChallenge: calcularChallenge(v6), scopes: ['leitura'],
    organizationIds: [EMPRESA], resource: `${BASE}/api/mcp`,
  })
  const t6 = await pegar('/api/oauth/token', form({
    grant_type: 'authorization_code', client_id: clientId, code: c6,
    redirect_uri: CB, code_verifier: v6,
  }))
  const acessoC = String(t6.json?.access_token ?? '')

  const rev = await pegar('/api/oauth/revoke', form({ client_id: clientId, token: acessoC }))
  t(rev.status === 200, 'revogação responde 200')
  const depoisRev = await resolverTokenDeAcesso(acessoC)
  t(!depoisRev.ok, 'o token revogado deixa de resolver')

  const revInexistente = await pegar('/api/oauth/revoke', form({ client_id: clientId, token: 'lure_at_nada' }))
  t(revInexistente.status === 200,
    'revogar token inexistente também é 200 — o RFC não quer um oráculo de existência')

  // ═══ O banco não guarda nenhum token em claro ═════════════════════════════
  console.log('\n── o que ficou no banco ──')

  const grants = await db.select({ id: oauthAccessGrants.id }).from(oauthAccessGrants)
    .where(inArray(oauthAccessGrants.clientId, [clientId, clientIdConf]))
  const guardados = grants.length
    ? await db.select({ hash: oauthTokens.tokenHash, resource: oauthTokens.resource })
        .from(oauthTokens).where(inArray(oauthTokens.grantId, grants.map(g => g.id)))
    : []
  t(guardados.length > 0, `${guardados.length} tokens gravados no teste`)
  t(guardados.every(g => /^[0-9a-f]{64}$/.test(g.hash)),
    'todo token_hash é SHA-256 em hex — nenhum token em claro no banco')
  t(!guardados.some(g => g.hash.startsWith('lure_at_') || g.hash.startsWith('lure_rt_')),
    'nenhum valor começa com lure_at_ ou lure_rt_')
  t(guardados.every(g => g.resource === `${BASE}/api/mcp`),
    'todo token nasceu com a audiência deste servidor gravada')

  await db.delete(oauthClients).where(like(oauthClients.clientName, `${NOME}%`))
  const sobrou = await db.select({ id: oauthAccessGrants.id }).from(oauthAccessGrants)
    .where(inArray(oauthAccessGrants.clientId, [clientId, clientIdConf]))
  t(sobrou.length === 0, 'limpeza: apagar os clientes de teste levou consentimentos e tokens')

  console.log(`\n${ok} ok, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('ERRO:', e)
  try { await db.delete(oauthClients).where(like(oauthClients.clientName, `${NOME}%`)) } catch { /* nada */ }
  process.exit(1)
})
