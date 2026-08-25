// POST /api/mcp — o servidor MCP.
//
// Transporte Streamable HTTP, SEM SESSÃO. Cada requisição traz o próprio token
// e nada precisa sobreviver entre elas, então não há `Mcp-Session-Id` para
// emitir. Isso não é simplificação: numa função serverless, instâncias
// diferentes atendem requisições seguidas e não compartilham memória — um
// servidor com sessão em memória funcionaria no teste e falharia em produção.
//
// O POST responde `application/json` direto, sem SSE. O GET, que serviria para
// abrir o fluxo de eventos do servidor, devolve 405: não temos nada a empurrar.
//
// REGRA DURA DE IMPORTAÇÃO: nada de `src/server/**` aqui. Aqueles arquivos
// chamam `redirect()`, que lança `NEXT_REDIRECT` — numa resposta JSON-RPC isso
// vira 500 opaco em vez de erro legível.

import {
  resposta, erro, ehPedidoValido, ehNotificacao, CODIGO, type PedidoJsonRpc,
} from '@/lib/mcp/jsonrpc'
import { ferramentasPara, acharFerramenta, schemaDeEntrada, mensagemDeErro } from '@/lib/mcp/tools'
import { resolverTokenDeAcesso, marcarUso, type TokenResolvido } from '@/lib/oauth/store'
import { baseUrlDe, desafioWwwAuthenticate, mesmaOrigem } from '@/lib/oauth/metadata'
import { CABECALHOS_CORS } from '@/lib/oauth/http'
import { db } from '@/db'
import { agentEvents } from '@/db/schema'
import { papelNaOrganizacao } from '@/lib/members'
import { papelAtinge } from '@/lib/members-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Importar arquivo e classificar lote levam minutos; o padrão de 10s cortaria
// no meio. Explícito para não depender do que a Vercel decidir como padrão.
export const maxDuration = 300

const VERSOES_CONHECIDAS = ['2025-06-18', '2025-03-26', '2024-11-05']
const VERSAO_PADRAO = '2025-06-18'

const INSTRUCOES = `Você está ligado ao lure.expert, o sistema financeiro desta empresa.

Comece sempre por listar_organizacoes: toda outra ferramenta exige o organizationId de lá.
Depois, descrever_organizacao diz o período que tem dados — pedir um mês vazio é o erro mais comum.

Duas datas convivem em cada lançamento, e escolher errado troca a resposta:
competência é quando o fato aconteceu (alimenta a DRE), caixa é quando o dinheiro se moveu
(alimenta o fluxo). Na dúvida sobre resultado, use competência.

Quatro dimensões classificam um lançamento além da natureza: centro de custo, unidade de
negócio, entidade jurídica e contato (cliente/fornecedor). Um lançamento pode estar repartido
entre várias — a consulta já distribui o valor proporcionalmente, e contagem continua sendo de
lançamentos, não de partes.

Valores em reais. Nunca invente número que não veio de uma consulta.`

function json(dados: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...CABECALHOS_CORS,
      ...extra,
    },
  })
}

/**
 * O 401 que ensina o cliente a se autorizar.
 *
 * O `WWW-Authenticate` apontando o metadata do recurso é MUST do spec (RFC 9728
 * §5.1) e é o que dispara a descoberta inteira: sem ele o cliente só mostra
 * "não autorizado" e para ali.
 */
function naoAutorizado(base: string, descricao: string) {
  return json(
    { error: 'invalid_token', error_description: descricao },
    401,
    { 'WWW-Authenticate': desafioWwwAuthenticate(base, descricao) },
  )
}

type Portador = Extract<TokenResolvido, { ok: true }>

async function autenticar(req: Request, base: string): Promise<Portador | Response> {
  const auth = req.headers.get('authorization') ?? ''
  if (!/^bearer /i.test(auth)) {
    return naoAutorizado(base, 'Apresente um token de acesso no cabeçalho Authorization.')
  }

  const token = auth.slice(7).trim()
  const r = await resolverTokenDeAcesso(token)
  if (!r.ok) {
    const motivos: Record<string, string> = {
      desconhecido: 'Token desconhecido.',
      expirado: 'Token expirado — renove com o refresh token.',
      revogado: 'Token revogado.',
      consentimento_revogado: 'A conexão foi desconectada nas configurações do lure.expert.',
    }
    return naoAutorizado(base, motivos[r.motivo] ?? 'Token inválido.')
  }

  // Audiência (RFC 8707): token emitido para outro recurso não vale aqui. É o
  // que impede um token capturado de outro serviço de ser aceito por este.
  if (r.resource && !mesmaOrigem(r.resource, base)) {
    return naoAutorizado(base, 'Este token foi emitido para outro recurso.')
  }

  return r
}

async function registrarChamada(p: {
  organizationId: string
  ferramenta: string
  clientId: string
  userId: string
  sucesso: boolean
  duracaoMs: number
  erro?: string
}) {
  try {
    await db.insert(agentEvents).values({
      organizationId: p.organizationId,
      type: 'mcp_tool_call',
      entityType: 'mcp_tool',
      payload: { ferramenta: p.ferramenta, clientId: p.clientId, userId: p.userId },
      durationMs: p.duracaoMs,
      success: p.sucesso,
      errorMessage: p.erro ?? null,
    })
  } catch (e) {
    // Auditoria não derruba a chamada — o trabalho já foi feito.
    console.error('[mcp] falha ao registrar chamada', (e as Error).message)
  }
}

async function despachar(p: PedidoJsonRpc, portador: Portador): Promise<unknown | null> {
  const { method, params = {}, id } = p

  switch (method) {
    case 'initialize': {
      const pedida = String((params as Record<string, unknown>).protocolVersion ?? '')
      return resposta(id, {
        protocolVersion: VERSOES_CONHECIDAS.includes(pedida) ? pedida : VERSAO_PADRAO,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'lure.expert', title: 'lure.expert', version: '1.0.0' },
        instructions: INSTRUCOES,
      })
    }

    case 'ping':
      return resposta(id, {})

    case 'tools/list':
      return resposta(id, {
        tools: ferramentasPara(portador.scopes).map(f => ({
          name: f.nome,
          title: f.titulo,
          description: f.descricao,
          inputSchema: schemaDeEntrada(f),
        })),
      })

    case 'tools/call': {
      const nome = String((params as Record<string, unknown>).name ?? '')
      const args = ((params as Record<string, unknown>).arguments ?? {}) as Record<string, unknown>

      const f = acharFerramenta(nome, portador.scopes)
      if (!f) {
        return erro(id, CODIGO.metodoDesconhecido,
          `Ferramenta "${nome}" não existe ou não está autorizada por esta conexão.`)
      }

      const orgDaChamada = typeof args.organizationId === 'string' ? args.organizationId : null

      // Papel valendo no funil (4.B): o consentimento de escrita não sobrepõe a
      // membership — quem é Leitor numa organização não escreve NELA, mesmo com
      // escopo de escrita concedido (o mesmo usuário pode ser admin numa empresa
      // e leitor noutra; o portão é por organização, por isso mora aqui e não no
      // catálogo). ANTES da validação de argumentos: quem não pode chamar a
      // ferramenta não precisa ter os argumentos conferidos. Papel inexistente
      // segue adiante — o `escopoDe` da ferramenta já recusa com a mensagem de
      // vínculo.
      if (f.escopo === 'escrita' && orgDaChamada) {
        const papel = await papelNaOrganizacao(portador.userId, orgDaChamada)
        if (papel !== null && !papelAtinge(papel, 'member')) {
          return resposta(id, {
            content: [{
              type: 'text',
              text: 'Seu papel nesta organização é Leitor — as ferramentas de escrita não valem nela. ' +
                    'Peça a alteração a um operador, administrador ou ao proprietário.',
            }],
            isError: true,
          })
        }
      }

      const lidos = f.entrada.safeParse(args)
      if (!lidos.success) {
        // Erro de argumento volta como RESULTADO com isError, não como erro de
        // protocolo: assim o modelo lê a mensagem e corrige na próxima chamada,
        // em vez de o cliente tratar como falha de transporte.
        return resposta(id, {
          content: [{ type: 'text', text: mensagemDeErro(lidos.error) }],
          isError: true,
        })
      }

      const inicio = Date.now()

      try {
        const saida = await f.executar(lidos.data as Record<string, unknown>, {
          userId: portador.userId,
          clientId: portador.clientId,
          organizationIds: portador.organizationIds,
          scopes: portador.scopes,
        })

        if (orgDaChamada) {
          await registrarChamada({
            organizationId: orgDaChamada, ferramenta: nome, clientId: portador.clientId,
            userId: portador.userId, sucesso: true, duracaoMs: Date.now() - inicio,
          })
        }

        return resposta(id, {
          content: [{ type: 'text', text: JSON.stringify(saida, null, 2) }],
          structuredContent: saida,
        })
      } catch (e) {
        const msg = mensagemDeErro(e)
        console.error(`[mcp] ${nome} falhou:`, e)

        if (orgDaChamada) {
          await registrarChamada({
            organizationId: orgDaChamada, ferramenta: nome, clientId: portador.clientId,
            userId: portador.userId, sucesso: false, duracaoMs: Date.now() - inicio, erro: msg,
          })
        }

        return resposta(id, { content: [{ type: 'text', text: msg }], isError: true })
      }
    }

    // Listas vazias em vez de "método desconhecido": alguns clientes perguntam
    // por recursos e prompts mesmo sem o servidor os anunciar, e um erro ali
    // aparece como conexão quebrada.
    case 'resources/list': return resposta(id, { resources: [] })
    case 'prompts/list':   return resposta(id, { prompts: [] })

    default:
      if (ehNotificacao(p)) return null
      return erro(id, CODIGO.metodoDesconhecido, `Método "${method}" não é suportado.`)
  }
}

export async function POST(req: Request) {
  const base = baseUrlDe(req)

  const portador = await autenticar(req, base)
  if (portador instanceof Response) return portador

  let corpo: unknown
  try {
    corpo = JSON.parse(await req.text())
  } catch {
    return json(erro(null, CODIGO.parse, 'Corpo não é JSON válido.'), 400)
  }

  const pedidos = Array.isArray(corpo) ? corpo : [corpo]
  if (pedidos.length === 0) {
    return json(erro(null, CODIGO.pedidoInvalido, 'Lote vazio.'), 400)
  }

  const respostas: unknown[] = []
  for (const bruto of pedidos) {
    if (!ehPedidoValido(bruto)) {
      respostas.push(erro(null, CODIGO.pedidoInvalido, 'Pedido JSON-RPC malformado.'))
      continue
    }
    try {
      const r = await despachar(bruto, portador)
      if (r !== null && !ehNotificacao(bruto)) respostas.push(r)
    } catch (e) {
      console.error('[mcp] falha no despacho', e)
      respostas.push(erro(bruto.id, CODIGO.interno, 'Falha interna ao processar a chamada.'))
    }
  }

  void marcarUso(portador.tokenId, portador.grantId)

  // Só notificações: o protocolo manda 202 sem corpo.
  if (respostas.length === 0) {
    return new Response(null, { status: 202, headers: CABECALHOS_CORS })
  }

  return json(Array.isArray(corpo) ? respostas : respostas[0])
}

/** O GET abriria um fluxo SSE do servidor para o cliente. Não temos o que empurrar. */
export async function GET(req: Request) {
  const base = baseUrlDe(req)
  const auth = req.headers.get('authorization') ?? ''
  if (!/^bearer /i.test(auth)) {
    return naoAutorizado(base, 'Apresente um token de acesso no cabeçalho Authorization.')
  }
  return json({ error: 'method_not_allowed', error_description: 'Este servidor não oferece fluxo SSE.' },
    405, { Allow: 'POST, OPTIONS' })
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CABECALHOS_CORS,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Expose-Headers': 'WWW-Authenticate',
    },
  })
}
