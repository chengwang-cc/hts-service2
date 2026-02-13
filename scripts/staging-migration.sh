#!/bin/bash

# Source the .env file
if [ -f .env ]; then
  source .env
else
  echo "Error: .env file not found, please run from root which contains .env file: scripts/run-migration.sh"
  exit 1
fi

source secrets/.env_staging
echo $DB_PASSWORD
echo $DB_PORT
NODE_ENV=development npm run db:run