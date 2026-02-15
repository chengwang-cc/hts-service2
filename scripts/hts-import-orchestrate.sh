#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${HTS_ADMIN_EMAIL:-}" || -z "${HTS_ADMIN_PASSWORD:-}" ]]; then
  echo "HTS_ADMIN_EMAIL and HTS_ADMIN_PASSWORD are required."
  exit 1
fi

node -r ts-node/register -r tsconfig-paths/register ./scripts/hts-import-orchestrate.ts
