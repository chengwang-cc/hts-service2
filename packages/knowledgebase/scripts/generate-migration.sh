#!/bin/bash

# HTS Service - Generate Migration Script
# Usage: ./scripts/generate-migration.sh migration-name

if [ -z "$1" ]; then
  echo "Error: Migration name is required"
  echo "Usage: ./scripts/generate-migration.sh migration-name"
  exit 1
fi

MIGRATION_NAME=$1

echo "Generating migration: $MIGRATION_NAME"

# Run TypeORM migration generation using ts-node
npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:generate src/migrations/$MIGRATION_NAME -d src/db/data-source.ts

echo "Migration generated successfully!"
