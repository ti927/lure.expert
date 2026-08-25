// Papéis de membership e as regras puras de quem pode mexer em quem.
//
// Separado de `members.ts` pelo mesmo motivo de `budget-types.ts` vs
// `budget-write.ts`: este arquivo é importado por componente de cliente (o
// seletor de papel da tela de membros), então não pode puxar `@/db`.
//
// A matriz da v1 (decidida com Julio em 25/ago/2026):
//
// | Ação                                          | viewer | member | admin | owner |
// |-----------------------------------------------|--------|--------|-------|-------|
// | Ver telas, DRE, consultas (e MCP leitura)     |   x    |   x    |   x   |   x   |
// | Importar, classificar, ratear, orçar, regras  |        |   x    |   x   |   x   |
// | Escrita via MCP (escopo no consentimento)     |        |   x    |   x   |   x   |
// | Apagar em lote, documentos, contas, conexões  |        |        |   x   |   x   |
// | Convidar, alterar papel, remover membro       |        |        |   x*  |   x   |
// | Chave de IA, teto, dados da org, apagar org   |        |        |       |   x   |
//
// * admin não mexe em owner — nem rebaixa, nem remove, nem promove alguém a
//   owner. Owner é papel que só outro owner concede.
//
// Nesta sessão (4.A) a matriz vale dentro da GESTÃO DE MEMBROS; o enforcement
// nos demais pontos (funil, escritas destrutivas, chave de IA) é a sessão 4.B.

import { z } from 'zod'

export const PAPEIS = ['owner', 'admin', 'member', 'viewer'] as const
export type Papel = (typeof PAPEIS)[number]

export const PAPEL_LABEL: Record<Papel, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Operador',
  viewer: 'Leitor',
}

export const PAPEL_DESCRICAO: Record<Papel, string> = {
  owner: 'Tudo, incluindo chave de IA, dados da empresa e gestão de proprietários.',
  admin: 'Opera e apaga dados, convida e gerencia membros — exceto proprietários.',
  member: 'Opera o dia a dia: importa, classifica, rateia, orça e cria regras.',
  viewer: 'Só leitura: vê telas, relatórios e consultas.',
}

export const conviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
  papel: z.enum(PAPEIS),
})

export function podeGerirMembros(papel: string): boolean {
  return papel === 'owner' || papel === 'admin'
}

// Hierarquia da matriz: cada papel contém os de baixo. Papel desconhecido
// (dado antigo, valor forjado) vale -1 e não atinge NADA — falha fechada.
const NIVEL: Record<Papel, number> = { viewer: 0, member: 1, admin: 2, owner: 3 }

export function papelAtinge(papel: string, minimo: Papel): boolean {
  return (NIVEL[papel as Papel] ?? -1) >= NIVEL[minimo]
}

/**
 * A recusa padrão dos pontos de enforcement da 4.B — descritiva, dizendo qual
 * papel a ação exige, para o usuário saber a quem pedir. `null` = permitido.
 */
export function recusaDePapel(papel: string, minimo: Papel, acao: string): string | null {
  if (papelAtinge(papel, minimo)) return null
  const quem = minimo === 'owner'
    ? 'o proprietário'
    : minimo === 'admin'
      ? 'um administrador ou o proprietário'
      : 'um operador, administrador ou o proprietário'
  return `Seu papel (${PAPEL_LABEL[papel as Papel] ?? papel}) não permite ${acao} — peça a ${quem}.`
}

/**
 * A regra pura de gestão: pode `papelDoAtor` fazer algo com um membro de
 * `papelDoAlvo`, atribuindo `novoPapel` (no convite e na alteração)?
 *
 * Devolve a recusa como texto descritivo, não exceção — o padrão do projeto
 * desde `resolverAcessoIa`. `null` significa permitido. A regra do último
 * owner NÃO mora aqui: ela depende de contagem no banco, e fica em
 * `members.ts`.
 */
export function recusaDeGestao(args: {
  papelDoAtor: string
  papelDoAlvo?: string
  novoPapel?: Papel
}): string | null {
  const { papelDoAtor, papelDoAlvo, novoPapel } = args

  if (!podeGerirMembros(papelDoAtor)) {
    return 'Só administradores e proprietários gerenciam membros.'
  }
  if (papelDoAtor === 'admin' && papelDoAlvo === 'owner') {
    return 'Administrador não altera nem remove um proprietário.'
  }
  if (papelDoAtor === 'admin' && novoPapel === 'owner') {
    return 'Só um proprietário pode conceder o papel de proprietário.'
  }
  return null
}
