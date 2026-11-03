#!/bin/sh
# Rejoue toutes les migrations sur une base PostgreSQL locale vierge puis le scénario de bout en bout.
# Usage : PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres sh supabase/tests/lancer.sh
set -e
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists nexia_test" -d postgres
psql -q -c "create database nexia_test" -d postgres
for f in tests/simulation_supabase.sql migrations/0001_schema.sql migrations/0002_regles.sql migrations/0003_fonctions.sql migrations/0005_discipline.sql migrations/0006_import.sql migrations/0007_api_mcp.sql migrations/0008_oauth.sql; do
  psql -q -v ON_ERROR_STOP=1 -d nexia_test -f "$f" 2>&1 | grep -v NOTICE || true
done
psql -d nexia_test -f tests/scenario.sql 2>&1 | grep -E "ok :|ÉCHEC|ERROR|TERMINÉ"
