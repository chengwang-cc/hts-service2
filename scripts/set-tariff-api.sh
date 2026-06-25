#!/usr/bin/env bash
#
# set-tariff-api.sh — point an environment's calculator at a tariff-formula API.
#
# The v1 calculator (calculator.controller.ts) proxies to an external tariff
# API (ai-service / report.chitchats). It reads the URL + key from env, which
# ECS injects from a per-environment Secrets Manager secret — that's how prod
# and staging differ. The KEY stays server-side; it is NEVER placed in the
# frontend bundle (environment.production.ts), because that ships to the browser.
#
# This script updates TARIFF_FORMULAS_API_URL + TARIFF_FORMULAS_API_KEY in the
# right secret (merging — other keys untouched), redeploys the ECS service so
# containers re-read the secret (ECS injects secrets at container START, so a
# redeploy is mandatory), then verifies the calculator end-to-end.
#
# Usage:
#   scripts/set-tariff-api.sh prod    https://api.report.chitchats.com/v2/tariff          <KEY>
#   scripts/set-tariff-api.sh staging https://staging.api.report.chitchats.com/v2/tariff  <KEY>
#
# Env overrides: AWS_PROFILE (default proto), AWS_REGION (default us-west-2),
#                CLUSTER (default poc-edge-cluster).

set -euo pipefail

ENV_NAME="${1:-}"; URL="${2:-}"; KEY="${3:-}"
if [[ -z "$ENV_NAME" || -z "$URL" || -z "$KEY" ]]; then
  echo "usage: $0 <prod|staging> <tariff-api-url> <api-key>" >&2
  exit 1
fi

case "$ENV_NAME" in
  prod)    SECRET="hts/app-secrets";         SERVICE="hts-backend";         API="https://api.usahts.com" ;;
  staging) SECRET="hts/app-secrets-staging"; SERVICE="hts-backend-staging"; API="https://api.qa.usahts.com" ;;
  *) echo "error: env must be 'prod' or 'staging' (got '$ENV_NAME')" >&2; exit 1 ;;
esac

export AWS_PROFILE="${AWS_PROFILE:-proto}"
export AWS_REGION="${AWS_REGION:-us-west-2}"
CLUSTER="${CLUSTER:-poc-edge-cluster}"

echo "==> $ENV_NAME  secret=$SECRET  service=$SERVICE"
echo "    URL=$URL"
echo "    KEY=${KEY:0:8}…${KEY: -4} (len ${#KEY})"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# 1. Merge the two keys into the secret JSON (every other key preserved).
aws secretsmanager get-secret-value --secret-id "$SECRET" --query SecretString --output text > "$TMP"
node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  j.TARIFF_FORMULAS_API_URL = process.argv[2];
  j.TARIFF_FORMULAS_API_KEY = process.argv[3];
  fs.writeFileSync(process.argv[1], JSON.stringify(j));
  console.error("    merged (" + Object.keys(j).length + " keys total in secret)");
' "$TMP" "$URL" "$KEY"
aws secretsmanager put-secret-value --secret-id "$SECRET" --secret-string "file://$TMP" \
  --query VersionId --output text | sed 's/^/    new secret version: /'

# 2. Redeploy so containers re-read the secret (injected at container start).
echo "==> redeploying $SERVICE (force-new-deployment) …"
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment >/dev/null
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"
echo "    stable."

# 3. Verify end-to-end: a known code should return real formulas (advisory).
echo "==> verifying $API/api/v1/calculator/calculate …"
curl -s --max-time 40 -X POST "$API/api/v1/calculator/calculate" \
  -H 'Content-Type: application/json' \
  -d '{"htsNumber":"8302.49.60.85","countryOfOrigin":"CN","declaredValue":100}' \
| node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try {
        const j = JSON.parse(s);
        const n = (j.formulas || []).length;
        const ok = j.blocked === false && n > 0;
        console.log("    8302.49.60.85 → blocked=" + j.blocked + " formulas=" + n +
                    (ok ? "  ✅ live tariff data" : "  ⚠️  no formulas — check the URL/key"));
      } catch { console.log("    ⚠️  unexpected response: " + s.slice(0, 160)); }
    });
  '

echo "==> done. $ENV_NAME calculator now uses $URL"
