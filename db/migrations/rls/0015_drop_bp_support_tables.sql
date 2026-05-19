-- Migration 0015: Drop BP support tables (fixed_assets, loans, equity_movements, inventory_snapshots)
-- Motivo: redesign do BP — os dados virão via importação de relatórios classificados
-- como transações com categorias de tipo BP, igual ao fluxo do DRE.
-- As tabelas são substituídas pelo modelo de transactions + document_type.

DROP TABLE IF EXISTS fixed_assets CASCADE;
DROP TABLE IF EXISTS loans CASCADE;
DROP TABLE IF EXISTS equity_movements CASCADE;
DROP TABLE IF EXISTS inventory_snapshots CASCADE;
