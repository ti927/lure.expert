-- Sessão 2.1: bucket privado para documentos enviados por clientes
-- Caminho esperado: {organization_id}/{uuid}-{filename}
-- RLS extrai o primeiro segmento do path para verificar membership

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "members_upload_org_documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND (storage.foldername(name))[1] IN (
    SELECT organization_id::text
    FROM public.memberships
    WHERE user_id = auth.uid()
      AND accepted_at IS NOT NULL
  )
);

CREATE POLICY "members_read_org_documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents'
  AND (storage.foldername(name))[1] IN (
    SELECT organization_id::text
    FROM public.memberships
    WHERE user_id = auth.uid()
      AND accepted_at IS NOT NULL
  )
);

CREATE POLICY "members_delete_org_documents"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents'
  AND (storage.foldername(name))[1] IN (
    SELECT organization_id::text
    FROM public.memberships
    WHERE user_id = auth.uid()
      AND accepted_at IS NOT NULL
  )
);
