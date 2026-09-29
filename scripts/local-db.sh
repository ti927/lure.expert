#!/usr/bin/env bash
# Banco LOCAL para desenvolver e testar sem tocar a produção.
#
#   bash scripts/local-db.sh up     # cria o contêiner e restaura o dump
#   bash scripts/local-db.sh down   # apaga o contêiner (o dump fica)
#
# O dump mora FORA do repositório (tem dado de cliente): por padrão
# C:/Users/Julio/backups/lure-expert/. Sobrescreva com DUMP=/caminho/arquivo.dump.
# Usa pgvector/pgvector:pg17 porque a imagem postgres padrão não tem a extensão
# `vector`, e sem ela `transactions` não é criada (erro visto em 29/set).
#
# Depois de subir:
#   DATABASE_URL=postgresql://postgres:local@localhost:55432/postgres \
#     npx tsx --env-file=.env.local scripts/<script>.ts
set -euo pipefail
NOME=lure-local
PORTA=55432
DUMP="${DUMP:-C:/Users/Julio/backups/lure-expert/lure-expert-2026-09-29-antes-rateio-natureza.dump}"
PASTA=$(dirname "$DUMP"); ARQ=$(basename "$DUMP")

case "${1:-}" in
  up)
    docker rm -f "$NOME" >/dev/null 2>&1 || true
    MSYS_NO_PATHCONV=1 docker run -d --name "$NOME" -p "$PORTA:5432" \
      -e POSTGRES_PASSWORD=local -v "$PASTA:/out" pgvector/pgvector:pg17 >/dev/null
    for i in $(seq 1 60); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
    sleep 2
    # Papéis que o dump do Supabase referencia; sem eles as policies não restauram.
    MSYS_NO_PATHCONV=1 docker exec "$NOME" sh -c '
      for r in anon authenticated service_role supabase_admin supabase_auth_admin \
               supabase_storage_admin authenticator dashboard_user pgbouncer \
               supabase_realtime_admin supabase_replication_admin supabase_read_only_user; do
        psql -U postgres -qc "create role $r" 2>/dev/null || true
      done'
    echo -n "erros de restauração (esperado: 3, extensões exclusivas do Supabase): "
    MSYS_NO_PATHCONV=1 docker exec "$NOME" pg_restore -U postgres -d postgres \
      --no-owner --no-privileges "/out/$ARQ" 2>&1 | grep -c "error:" || true
    MSYS_NO_PATHCONV=1 docker exec "$NOME" psql -U postgres -Atc \
      "select count(*)||' lançamentos, '||(select count(*) from transaction_allocations)||' partes' from transactions"
    ;;
  down) docker rm -f "$NOME" ;;
  *) echo "uso: $0 up|down"; exit 1 ;;
esac
