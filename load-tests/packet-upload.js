// R5-C-01 — concurrent packet uploads.
//
// 50 VUs upload base64-encoded PDF blobs to POST /broker/packets for 60s.
// Each iteration creates a fresh packet (so we test the storage + scan +
// queue path, not just an empty-payload echo). Pass thresholds match the
// plan acceptance criteria for the storage + scan + queue path.
//
// Env:
//   BASE_URL  — target API root (default http://localhost:3100)
//   JWT       — Bearer token for a broker_member of ORG_ID
//   ORG_ID    — broker organization id seeded via seed:broker-fixtures
//   CLIENT_ID — broker_client id under ORG_ID

import http from 'k6/http';
import encoding from 'k6/encoding';
import { check, fail } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3100';
const JWT = __ENV.JWT;
const ORG_ID = __ENV.ORG_ID;
const CLIENT_ID = __ENV.CLIENT_ID;

if (!JWT) fail('JWT env var is required');
if (!CLIENT_ID) fail('CLIENT_ID env var is required (broker_client id)');

// A tiny synthetic PDF — header + body + xref — large enough to exercise
// the body parser + storage adapter without bloating k6 memory.
const PDF_PREAMBLE = '%PDF-1.4\n%%EOF\n';
const PDF_BODY = 'A'.repeat(1024 * 200); // 200 KB

export const options = {
  scenarios: {
    upload: {
      executor: 'constant-vus',
      vus: 50,
      duration: '60s',
    },
  },
  thresholds: {
    'http_req_failed{name:upload}': ['rate<0.01'], // <1% 5xx
    'http_req_duration{name:upload}': ['p(95)<3000'], // p95 < 3s
    rate_429: ['count<1'], // R0-C-03 rate limiter should NOT fire at this load
  },
};

import { Counter } from 'k6/metrics';
const rate429 = new Counter('rate_429');

export default function () {
  const body = JSON.stringify({
    clientId: CLIENT_ID,
    source: 'broker',
    label: `k6-load-${Date.now()}`,
    documents: [
      {
        fileName: `k6-${__VU}-${__ITER}.pdf`,
        mimeType: 'application/pdf',
        contentBase64: encoding.b64encode(PDF_PREAMBLE + PDF_BODY),
      },
    ],
  });

  const res = http.post(`${BASE}/api/v1/broker/packets`, body, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${JWT}`,
    },
    tags: { name: 'upload' },
  });

  if (res.status === 429) rate429.add(1);

  check(res, {
    'status is 201 or 200': (r) => r.status === 201 || r.status === 200,
    'response has id': (r) => {
      try {
        return Boolean(JSON.parse(r.body).data?.id);
      } catch {
        return false;
      }
    },
  });
}

export function teardown() {
  console.log(`[packet-upload] 429s observed: ${rate429.name}`);
}
