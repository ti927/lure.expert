-- Migration: 0017_category_visibility_flags.sql
-- Adiciona flags de visibilidade por relatório nas categorias.
-- Caso de uso: empresa sobe CMV (→ DRE) E Pagamento de Fornecedores (→ Fluxo de Caixa).
-- Sem esses flags a mesma compra apareceria duas vezes — uma em cada fonte.

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS hide_in_dre      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hide_in_cashflow boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN categories.hide_in_dre IS
  'Se true, transações com esta categoria NÃO aparecem na DRE';

COMMENT ON COLUMN categories.hide_in_cashflow IS
  'Se true, transações com esta categoria NÃO aparecem no Fluxo de Caixa';
