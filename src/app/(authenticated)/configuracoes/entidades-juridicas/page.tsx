import type { Metadata } from 'next'
import { db } from '@/db'
import { legalEntities } from '@/db/schema'
import { getAuthContext } from '@/lib/auth-context'

export const metadata: Metadata = { title: 'Entidades Jurídicas' }
import { eq } from 'drizzle-orm'
import { CAMPOS_FOLHA_UJ, DICA_INSS_DESONERADA, OPCOES_REGIME, valoresDeFolhaParaForm } from '@/lib/payroll-uj'
import { REGIME_LABELS, type Regime } from '@/lib/payroll-types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DimensionManager, type DimensionItem, type ExtraField } from '@/components/settings/dimension-manager'
import { CsvImportButton } from '@/components/settings/csv-import-button'
import {
  createLegalEntity,
  updateLegalEntity,
  toggleLegalEntityActive,
  deleteLegalEntity,
  getLegalEntityLinkedCount,
} from '@/server/dimensions'

// Parâmetros de encargo da folha (orçamento): regime e alíquotas em PONTOS percentuais.
const CAMPOS_FOLHA: ExtraField[] = [
  { name: CAMPOS_FOLHA_UJ.regime, label: 'Regime tributário', type: 'select', options: OPCOES_REGIME, width: 'w-56', showInRow: false },
  {
    name: CAMPOS_FOLHA_UJ.anexoIV, label: 'Anexo IV (INSS patronal fora do DAS)', type: 'checkbox',
    width: 'w-64', visibleWhen: { field: CAMPOS_FOLHA_UJ.regime, equals: 'simples' }, showInRow: false,
  },
  { name: CAMPOS_FOLHA_UJ.inss, label: 'INSS patronal (%)', type: 'text', defaultValue: '20', width: 'w-28', showInRow: false, hint: DICA_INSS_DESONERADA },
  { name: CAMPOS_FOLHA_UJ.ratFap, label: 'RAT/FAP (%)', type: 'text', defaultValue: '2', width: 'w-24', showInRow: false },
  { name: CAMPOS_FOLHA_UJ.terceiros, label: 'Terceiros (%)', type: 'text', defaultValue: '5,8', width: 'w-24', showInRow: false },
  { name: CAMPOS_FOLHA_UJ.fgts, label: 'FGTS (%)', type: 'text', defaultValue: '8', width: 'w-24', showInRow: false },
]

function resumoDaFolha(u: typeof legalEntities.$inferSelect): string | null {
  if (!u.regimeTributario) return null
  const v = valoresDeFolhaParaForm(u)
  const regime = REGIME_LABELS[u.regimeTributario as Regime] ?? u.regimeTributario
  const anexo = u.simplesAnexoIv ? ' (Anexo IV)' : ''
  return `${regime}${anexo} · INSS ${v[CAMPOS_FOLHA_UJ.inss]}% · RAT/FAP ${v[CAMPOS_FOLHA_UJ.ratFap]}% · terceiros ${v[CAMPOS_FOLHA_UJ.terceiros]}% · FGTS ${v[CAMPOS_FOLHA_UJ.fgts]}%`
}

export default async function EntidadesJuridicasPage() {
  const { organizationId } = await getAuthContext()

  const rows = await db
    .select()
    .from(legalEntities)
    .where(eq(legalEntities.organizationId, organizationId))

  const items: DimensionItem[] = rows.map((u) => ({
    id: u.id,
    name: u.name,
    code: u.code,
    isActive: u.isActive,
    createdAt: u.createdAt,
    cnpj: u.cnpj,
    extra: valoresDeFolhaParaForm(u),
    summary: resumoDaFolha(u),
  }))

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Entidades jurídicas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Classifique lançamentos por CNPJ — matriz, filiais ou empresas do grupo.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Entidades jurídicas</CardTitle>
              <CardDescription className="mt-1.5">
                Cada lançamento pode ser vinculado a uma pessoa jurídica para análise consolidada ou por entidade.
              </CardDescription>
            </div>
            <CsvImportButton kind="entidades-juridicas" />
          </div>
        </CardHeader>
        <CardContent>
          <DimensionManager
            items={items}
            title="Entidades jurídicas"
            singularLabel="Entidade jurídica"
            showCnpj
            extraFields={CAMPOS_FOLHA}
            onCreate={createLegalEntity}
            onUpdate={updateLegalEntity}
            onToggleActive={toggleLegalEntityActive}
            onDelete={deleteLegalEntity}
            getLinkedCount={getLegalEntityLinkedCount}
          />
        </CardContent>
      </Card>
    </div>
  )
}
