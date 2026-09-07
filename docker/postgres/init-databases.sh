#!/bin/bash
set -euo pipefail

# Runs only on first Postgres data init (empty volume).
# Creates application databases on one Postgres instance.

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  SELECT 'CREATE DATABASE profiles'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'profiles')\gexec

  SELECT 'CREATE DATABASE bcn_quiz'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bcn_quiz')\gexec

  GRANT ALL PRIVILEGES ON DATABASE profiles TO ${POSTGRES_USER};
  GRANT ALL PRIVILEGES ON DATABASE bcn_quiz TO ${POSTGRES_USER};
EOSQL

echo "Initialized databases: profiles, bcn_quiz"
