-- Fix: parent_id para categorias com código X.Y.Z nas orgs existentes
-- A migration 0009 atualizou o campo type mas não setou parent_id.
-- Orgs novas já recebem a estrutura Pai/Filho correta pelo trigger recriado na 0009.

UPDATE categories AS filho
SET
  parent_id = pai.id,
  updated_at = NOW()
FROM categories pai
WHERE filho.organization_id = pai.organization_id
  AND filho.parent_id IS NULL
  -- exatamente 2 pontos no código → X.Y.Z é Filho de X.Y
  AND (length(filho.code) - length(replace(filho.code, '.', ''))) = 2
  -- pai.code = prefixo até o último ponto (ex: '3.1.1' → '3.1')
  AND pai.code = substring(
        filho.code,
        1,
        length(filho.code) - position('.' IN reverse(filho.code))
      );
