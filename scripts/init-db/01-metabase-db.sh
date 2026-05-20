#!/usr/bin/env bash
# Postgres init script — creates the secondary `metabase` database so the
# Metabase container can use it as its internal app DB.
#
# Postgres images auto-run any *.sql / *.sh / *.sql.gz inside
# /docker-entrypoint-initdb.d on first boot (i.e. when the data volume is
# empty). Re-runs after `docker compose down -v` only.
set -e
psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE metabase OWNER $POSTGRES_USER;
EOSQL
echo "✓ metabase DB ensured"
