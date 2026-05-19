-- Migration 0016: Adiciona report_type e reference_date em documents
-- report_type distingue relatórios de BP dos demais uploads (extratos, DRE, etc.)
-- reference_date é a data de referência do snapshot de BP (ex: 2026-01-31)

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'other';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reference_date text;
