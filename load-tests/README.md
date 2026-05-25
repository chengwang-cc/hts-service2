# Broker platform load tests (k6)

R5-C deliverable. Three scripts targeting the SLO claims in the plan:

| File | Plan ref | What it measures | Pass criteria |
| --- | --- | --- | --- |
| `packet-upload.js` | R5-C-01 | Concurrent packet uploads (50 VUs × 60s) | p95 < 3s, 0% 5xx, 0% 429 |
| `marketplace-match-perf.js` | R5-C-02 | Match-request scoring time over a seeded corpus | p95 < 2s per request |
| `audit-volume.js` | R5-C-03 | Sustained audit write load (100k events/hour) | 0 dropped writes, no table bloat |

## Running

```bash
brew install k6   # or apt-get install k6

# Against a local backend:
BASE_URL=http://localhost:3100 \
JWT=$(node scripts/mint-test-jwt.js)  \
ORG_ID=<seeded-broker-org> \
k6 run load-tests/packet-upload.js

# Against staging:
BASE_URL=https://api.staging.hts.com \
JWT=$ADMIN_JWT \
k6 run load-tests/marketplace-match-perf.js
```

## Producing the seed data

All three scripts assume `npm run seed:broker-fixtures` has been run against
the target environment (30 broker orgs + a Demo Business + one entry per
broker). The fixtures are idempotent; re-running on each load-test session
is safe.

## CI usage

These are intentionally NOT in the GH Actions matrix — they need a long-
running target environment and dedicated infrastructure to observe. Run
them on demand before a release, or schedule via a separate workflow that
deploys to a clean staging cluster first.
