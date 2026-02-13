#!/bin/bash

# Source the .env file
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

npm run db:run