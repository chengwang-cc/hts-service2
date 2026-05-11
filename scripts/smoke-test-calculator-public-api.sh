#!/usr/bin/env bash
#
# Smoke test for POST /api/v1/calculator/calculate after the PR #3
# (strict countryOfOrigin validation) deploy.
#
# Required env:
#   HTS_API_BASE   e.g. https://api.usahts.com  or  http://localhost:3100
#   HTS_API_KEY    a valid API key (format: hts_{env}_{random})
#
# Optional env:
#   HTS_TEST_HTS   defaults to 8471.30.0100 (a laptop — has known Section 301
#                  exposure for CN that VN doesn't have, so it discriminates).
#
# Exits non-zero on any failure.

set -u

API_BASE="${HTS_API_BASE:?HTS_API_BASE not set (e.g. https://api.usahts.com)}"
API_KEY="${HTS_API_KEY:?HTS_API_KEY not set}"
HTS="${HTS_TEST_HTS:-8471.30.0100}"

ENDPOINT="${API_BASE%/}/api/v1/calculator/calculate"

PASS=0
FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; echo "    $2"; FAIL=$((FAIL+1)); }

# Helper: call API, return "<status>|<body>"
call() {
  local body="$1"
  curl -sS -o /tmp/hts-smoke-body.json -w '%{http_code}' \
    -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d "$body"
  echo
}

echo "Smoke testing $ENDPOINT"
echo "HTS: $HTS"
echo

# ──────────────────────────────────────────────────────────────────────────
# Test 1 — Happy path with ISO-2 country
echo "[1] Happy path: countryOfOrigin=CN, declaredValue=1000"
status=$(call "{\"htsNumber\":\"$HTS\",\"countryOfOrigin\":\"CN\",\"declaredValue\":1000}")
body=$(cat /tmp/hts-smoke-body.json)
if [ "$status" = "200" ] || [ "$status" = "201" ]; then
  pass "200 OK"
else
  fail "expected 200, got $status" "$body"
fi

# Test 2 — meta.countryOfOrigin echo
echo "[2] meta.countryOfOrigin echo on success"
meta_country=$(echo "$body" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('meta',{}).get('countryOfOrigin',''))" 2>/dev/null || echo "")
if [ "$meta_country" = "CN" ]; then
  pass "meta.countryOfOrigin = CN"
else
  fail "meta.countryOfOrigin not echoed correctly" "got: '$meta_country'"
fi

# Test 3 — case-insensitive: lowercase 'cn' should be accepted and normalized
echo "[3] Case-insensitive: countryOfOrigin=cn"
status=$(call "{\"htsNumber\":\"$HTS\",\"countryOfOrigin\":\"cn\",\"declaredValue\":1000}")
body=$(cat /tmp/hts-smoke-body.json)
meta_country=$(echo "$body" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('meta',{}).get('countryOfOrigin',''))" 2>/dev/null || echo "")
if { [ "$status" = "200" ] || [ "$status" = "201" ]; } && [ "$meta_country" = "CN" ]; then
  pass "lowercase 'cn' normalized to 'CN'"
else
  fail "lowercase should be accepted and normalized" "status=$status meta=$meta_country"
fi

# Test 4 — country actually affects rate (CN vs VN, same HTS)
echo "[4] Origin country affects additionalTariffs (CN vs VN)"
call "{\"htsNumber\":\"$HTS\",\"countryOfOrigin\":\"CN\",\"declaredValue\":1000}" > /dev/null
cn_at=$(python3 -c "import json; d=json.load(open('/tmp/hts-smoke-body.json')); print(d.get('data',{}).get('additionalTariffs', 0))" 2>/dev/null || echo "0")
call "{\"htsNumber\":\"$HTS\",\"countryOfOrigin\":\"VN\",\"declaredValue\":1000}" > /dev/null
vn_at=$(python3 -c "import json; d=json.load(open('/tmp/hts-smoke-body.json')); print(d.get('data',{}).get('additionalTariffs', 0))" 2>/dev/null || echo "0")
if [ "$cn_at" != "$vn_at" ]; then
  pass "CN additionalTariffs=$cn_at, VN additionalTariffs=$vn_at — country matters"
else
  fail "country didn't change additionalTariffs (both $cn_at) — try a different HTS with Section 301 exposure" ""
fi

# Test 5 — empty countryOfOrigin → 400
echo "[5] Empty countryOfOrigin → 400"
status=$(call "{\"htsNumber\":\"$HTS\",\"countryOfOrigin\":\"\",\"declaredValue\":1000}")
body=$(cat /tmp/hts-smoke-body.json)
if [ "$status" = "400" ] && echo "$body" | grep -qi "countryOfOrigin"; then
  pass "400 with countryOfOrigin error"
else
  fail "expected 400 referencing countryOfOrigin" "status=$status body=$body"
fi

# Test 6 — country NAME instead of code → 400
echo "[6] Country name (\"China\") → 400"
status=$(call "{\"htsNumber\":\"$HTS\",\"countryOfOrigin\":\"China\",\"declaredValue\":1000}")
body=$(cat /tmp/hts-smoke-body.json)
if [ "$status" = "400" ] && echo "$body" | grep -qi "ISO\|alpha-2\|2-letter"; then
  pass "400 with descriptive ISO-2 error"
else
  fail "expected 400 with ISO-2 hint" "status=$status body=$body"
fi

# Test 7 — wrong field name (country instead of countryOfOrigin) → 400
echo "[7] Wrong field name (country: \"CN\") → 400"
status=$(call "{\"htsNumber\":\"$HTS\",\"country\":\"CN\",\"declaredValue\":1000}")
body=$(cat /tmp/hts-smoke-body.json)
if [ "$status" = "400" ] && echo "$body" | grep -qi "country should not exist\|countryOfOrigin"; then
  pass "400 — forbidNonWhitelisted catches misnamed field"
else
  fail "expected 400 — forbidNonWhitelisted should reject unknown 'country' field" "status=$status body=$body"
fi

# Test 8 — extra unknown field on otherwise-valid payload → 400
echo "[8] Extra unknown field (\"foo\":\"bar\") → 400"
status=$(call "{\"htsNumber\":\"$HTS\",\"countryOfOrigin\":\"CN\",\"declaredValue\":1000,\"foo\":\"bar\"}")
body=$(cat /tmp/hts-smoke-body.json)
if [ "$status" = "400" ] && echo "$body" | grep -qi "foo should not exist"; then
  pass "400 — extra unknown field rejected"
else
  fail "expected 400 rejecting unknown 'foo' field" "status=$status body=$body"
fi

# ──────────────────────────────────────────────────────────────────────────
echo
echo "Result: $PASS passed, $FAIL failed"
rm -f /tmp/hts-smoke-body.json
[ "$FAIL" -eq 0 ]
