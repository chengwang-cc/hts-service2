#!/bin/bash
# Source the .env file
if [ -f .env ]; then
  source .env
else
  echo "Error: .env file not found, please run from root: scripts/create-migration.sh MIGRATION_FILE"
  exit 1
fi

# Enforce that $1 (migration name) is provided and validate it
if [ -z "$1" ]; then
  echo "Error: Migration name is required. Usage: $0 <migration-name>"
  exit 1
fi

source .env
DB_MIGRATION_PATH=src/db/migrations
npm run db:create "$DB_MIGRATION_PATH/$1"

