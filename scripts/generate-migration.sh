#!/bin/bash

# Source the .env file
if [ -f .env ]; then
  echo "Locate environment file .env"
  # Export all variables from .env file
  set -a
  source .env
  set +a
  echo "Loaded environment variables from .env"
else
  echo "Error: .env file not found, please run from root which contains .env file: scripts/generate-migration.sh"
  exit 1
fi

# Enforce that $1 (migration name) is provided and validate it
if [ -z "$1" ]; then
  echo "Error: Migration name is required. Usage: $0 <migration-name>"
  exit 1
fi


DB_MIGRATION_PATH=src/db/migrations
npm run db:generate "$DB_MIGRATION_PATH/$1"