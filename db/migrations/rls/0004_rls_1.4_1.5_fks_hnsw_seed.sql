-- RLS sessões 1.4 e 1.5 + FKs circulares + HNSW + seed de categorias
-- Rodar no Supabase Studio > SQL Editor

-- FKs PENDENTES
ALTER TABLE credit_card_invoices ADD CONSTRAINT cc_invoices_paid_by_transaction_fk FOREIGN KEY (paid_by_transaction_id) REFERENCES transactions(id);
ALTER TABLE credit_card_invoices ADD CONSTRAINT cc_invoices_document_fk FOREIGN KEY (document_id) REFERENCES documents(id);
ALTER TABLE documents ADD CONSTRAINT documents_template_fk FOREIGN KEY (template_id) REFERENCES templates(id);
ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_transaction_fk FOREIGN KEY (transaction_id) REFERENCES transactions(id);
ALTER TABLE equity_movements ADD CONSTRAINT equity_movements_transaction_fk FOREIGN KEY (transaction_id) REFERENCES transactions(id);

-- HNSW embedding
CREATE INDEX idx_tx_embedding ON transactions USING hnsw (embedding vector_cosine_ops);

-- RLS: documents, transactions, credit_card_invoices, templates, conversations, messages, organization_facts, agent_events
-- (ver SQL completo na mensagem da sessão 1.4+1.5)

-- Seed de plano de contas + trigger
-- (ver SQL completo na mensagem da sessão 1.6)
