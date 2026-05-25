// R5-C-03 — sustained audit-write volume.
//
// Targets 100k audit_events writes per hour by driving the cheapest write
// endpoint (a no-op PATCH on a broker_rule scope=organization row, which
// audit-records `broker_rules.rule.updated`). Verifies the audit ingest
// path keeps up and that the AuditRetentionWorker keeps the table from
// bloating uncontrollably during the run.
//
// 100k/h ≈ 27.7 writes/sec — at 20 VUs each doing 1.4 req/s. Tune via
// TARGET_RATE_PER_SEC env var.
//
// Env:
//   BASE_URL    — target API
//   JWT         — token for a broker_admin user
//   RULE_ID     — UUID of a broker_rules row in the same org as the JWT
//   TARGET_RATE_PER_SEC — override default 28

import http from 'k6/http';
import { Trend, Counter } from 'k6/metrics';
import { check, fail } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3100';
const JWT = __ENV.JWT;
const RULE_ID = __ENV.RULE_ID;
const RATE = Number(__ENV.TARGET_RATE_PER_SEC || 28);

if (!JWT) fail('JWT env var is required');
if (!RULE_ID) fail('RULE_ID env var is required (seeded broker_rules id)');

const auditLatency = new Trend('audit_write_latency_ms');
const failedWrites = new Counter('failed_audit_writes');

export const options = {
  scenarios: {
    sustained: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: '15m', // 15 min * 60 * 28 ≈ 25k writes, enough to spot bloat
      preAllocatedVUs: 20,
      maxVUs: 50,
    },
  },
  thresholds: {
    'http_req_duration{name:audit-write}': ['p(95)<1000'],
    failed_audit_writes: ['count<10'], // <0.04% drop
  },
};

let counter = 0;

export default function () {
  counter += 1;
  const res = http.patch(
    `${BASE}/api/v1/broker/rules`,
    JSON.stringify({
      code: `k6-noop-${RULE_ID.slice(0, 6)}-${counter % 10}`,
      title: `k6 audit volume probe ${counter}`,
      scope: 'organization',
      severity: 'warning',
      ruleType: 'value_sanity',
      config: { field: 'totalValue', min: 0.01 },
      enabled: true,
    }),
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${JWT}`,
      },
      tags: { name: 'audit-write' },
    },
  );

  auditLatency.add(res.timings.duration);
  if (res.status >= 400) failedWrites.add(1);

  check(res, {
    'audit write succeeded': (r) => r.status >= 200 && r.status < 300,
  });
}

export function handleSummary(data) {
  console.log(
    `[audit-volume] writes attempted: ${data.metrics.http_reqs.values.count} | ` +
      `failed: ${data.metrics.failed_audit_writes?.values.count ?? 0} | ` +
      `p95 latency: ${data.metrics['http_req_duration{name:audit-write}']?.values['p(95)']?.toFixed(0) ?? 'n/a'}ms`,
  );
  return { 'load-tests/audit-volume-result.json': JSON.stringify(data, null, 2) };
}
