-- Reversa da 0037: apaga a mesa de negociação e os agrupamentos de fornecedor.
-- Perda declarada: todas as marcações, reduções, observações e agrupamentos.
-- Idempotente.
DROP TABLE IF EXISTS supplier_negotiations;
DROP TABLE IF EXISTS supplier_groupings;
