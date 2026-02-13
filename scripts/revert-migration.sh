#!/bin/bash

# Source the .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
else
  echo "Error: .env file not found, please run from root which contains .env file: scripts/revert-migration.sh"
  exit 1
fi

npm run db:revert