#!/bin/bash

# HTS Service - Run Migrations Script
# Usage: ./scripts/run-migration.sh

echo "Running database migrations..."

# Run TypeORM migrations using ts-node
npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:run -d src/db/data-source.ts

echo "Migrations completed!"
