'use client'

import { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CsvImportDialog } from './csv-import-dialog'
import {
  previewCategoryImport,
  commitCategoryImport,
  previewCostCenterImport,
  commitCostCenterImport,
  previewBusinessUnitImport,
  commitBusinessUnitImport,
  previewLegalEntityImport,
  commitLegalEntityImport,
} from '@/server/imports'
import type { DimensionKind } from '@/lib/csv-templates'

interface CsvImportButtonProps {
  kind: DimensionKind
}

const ACTIONS = {
  categorias: { preview: previewCategoryImport, commit: commitCategoryImport },
  'centros-de-custo': { preview: previewCostCenterImport, commit: commitCostCenterImport },
  'unidades-de-negocio': { preview: previewBusinessUnitImport, commit: commitBusinessUnitImport },
  'entidades-juridicas': { preview: previewLegalEntityImport, commit: commitLegalEntityImport },
} as const

export function CsvImportButton({ kind }: CsvImportButtonProps) {
  const [open, setOpen] = useState(false)
  const actions = ACTIONS[kind]

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4 mr-1" />
        Importar CSV
      </Button>
      <CsvImportDialog
        open={open}
        onOpenChange={setOpen}
        kind={kind}
        preview={actions.preview}
        commit={actions.commit}
      />
    </>
  )
}
