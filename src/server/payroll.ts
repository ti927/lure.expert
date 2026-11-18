'use server'

// Server actions da folha de pagamento no orçamento. Cada uma é casca: resolve a
// organização e o papel, confere o papel nas escritas e delega para
// `lib/payroll-write.ts`. Leitura é de qualquer papel; escrita é member+.

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { getAuthContext } from '@/lib/auth-context'
import { recusaDePapel } from '@/lib/members-types'
import {
  apagarPessoa, copiarQuadro, gerarFolha, lerMapa, lerQuadro, preverFolha, salvarMapa, salvarParametrosVersao,
  salvarPessoa,
} from '@/lib/payroll-write'
import type { Componente, ParametrosVersaoInput, PessoaInput } from '@/lib/payroll-types'

const recusaEscrita = (papel: string, acao: string) => recusaDePapel(papel, 'member', acao)

/** O quadro de pessoal da versão, com o custo do ano de cada pessoa. */
export async function getQuadro(versionId: string) {
  const { organizationId } = await getAuthContext()
  return lerQuadro(db, organizationId, versionId)
}

/** Cria (sem `personId`) ou edita uma pessoa do quadro. */
export async function savePessoa(versionId: string, input: PessoaInput, personId?: string) {
  const { organizationId, userId, papel } = await getAuthContext()
  const recusa = recusaEscrita(papel, 'alterar o quadro de pessoal')
  if (recusa) return { error: recusa }

  const r = await db.transaction(tx => salvarPessoa(tx, organizationId, userId, versionId, input, personId))
  if (!('error' in r)) revalidatePath('/orcamento')
  return r
}

export async function deletePessoa(versionId: string, personId: string) {
  const { organizationId, papel } = await getAuthContext()
  const recusa = recusaEscrita(papel, 'alterar o quadro de pessoal')
  if (recusa) return { error: recusa }

  const r = await db.transaction(tx => apagarPessoa(tx, organizationId, versionId, personId))
  if (!('error' in r)) revalidatePath('/orcamento')
  return r
}

/** Modo de 13º/férias e dissídio da versão (percentuais em pontos: 5 = 5%). */
export async function saveParametrosFolha(versionId: string, input: ParametrosVersaoInput) {
  const { organizationId, papel } = await getAuthContext()
  const recusa = recusaEscrita(papel, 'alterar os parâmetros da folha')
  if (recusa) return { error: recusa }

  const r = await db.transaction(tx => salvarParametrosVersao(tx, organizationId, versionId, input))
  if (!('error' in r)) revalidatePath('/orcamento')
  return r
}

/** O mapa componente → natureza da organização (com a sugestão do plano padrão quando não gravado). */
export async function getMapaFolha() {
  const { organizationId } = await getAuthContext()
  return lerMapa(db, organizationId)
}

export async function saveMapaFolha(mapa: Partial<Record<Componente, string | null>>) {
  const { organizationId, papel } = await getAuthContext()
  const recusa = recusaEscrita(papel, 'alterar as naturezas da folha')
  if (recusa) return { error: recusa }

  const r = await db.transaction(tx => salvarMapa(tx, organizationId, mapa))
  if (!('error' in r)) revalidatePath('/orcamento')
  return r
}

/** O que "Gerar folha" gravaria, sem gravar. Leitura: qualquer papel. */
export async function previewFolha(versionId: string) {
  const { organizationId } = await getAuthContext()
  return preverFolha(db, organizationId, versionId)
}

/** Apaga as séries de folha da versão e grava as novas — tudo ou nada. */
export async function generateFolha(versionId: string) {
  const { organizationId, userId, papel } = await getAuthContext()
  const recusa = recusaEscrita(papel, 'gerar a folha')
  if (recusa) return { error: recusa }

  const r = await db.transaction(tx => gerarFolha(tx, organizationId, userId, versionId))
  if (!('error' in r)) revalidatePath('/orcamento')
  return r
}

/** Substitui o quadro do destino pelo da origem. Não gera. */
export async function copyQuadro(origemVersionId: string, destinoVersionId: string) {
  const { organizationId, userId, papel } = await getAuthContext()
  const recusa = recusaEscrita(papel, 'copiar o quadro de pessoal')
  if (recusa) return { error: recusa }

  const r = await db.transaction(tx => copiarQuadro(tx, organizationId, userId, origemVersionId, destinoVersionId))
  if (!('error' in r)) revalidatePath('/orcamento')
  return r
}
