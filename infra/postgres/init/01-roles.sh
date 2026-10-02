#!/bin/sh
# Runs once when the local PostgreSQL volume is created.
# Creates the RLS-restricted runtime role used by api and worker. Migrations run as the
# superuser from POSTGRES_USER and grant tuello_app exactly what it needs.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE tuello_app LOGIN PASSWORD '${TUELLO_APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
SQL
