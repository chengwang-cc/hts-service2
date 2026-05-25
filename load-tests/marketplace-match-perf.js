// R5-C-02 — marketplace match scoring performance.
//
// Creates 100 RFQs in sequence against a corpus of 30+ seeded broker
// profiles and measures the per-request matching latency. The scoring
// algorithm is O(profiles) per request; the threshold confirms a request
// returns matches under 2 seconds at the seeded scale.
//
// Env:
//   BASE_URL — target API root
//   JWT      — Bearer token for a business user

import http from 'k6/http';
import { check, fail } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3100';
const JWT = __ENV.JWT;
if (!JWT) fail('JWT env var is required (business user)');

const COMMODITIES = [
  'Cotton t-shirts, men\'s, knit, 200 GSM, from Vietnam',
  'Aluminum extrusion bars 6063-T5 for window frames, from China',
  'Pharmaceutical-grade vitamin C tablets, OTC, from India',
  'Premium olive oil, extra virgin, glass-bottled, from Italy',
  'Carbon steel structural beams I-section, from South Korea',
  'Frozen Pacific salmon fillets, vacuum-sealed, from Chile',
  'Lithium-ion battery cells 21700 format, from Japan',
  'Hand-knotted wool area rugs, 8x10ft, from Turkey',
];

export const options = {
  scenarios: {
    match: {
      executor: 'shared-iterations',
      vus: 4,
      iterations: 100,
      maxDuration: '5m',
    },
  },
  thresholds: {
    'http_req_duration{name:create-request}': ['p(95)<2000'],
    'http_req_failed{name:create-request}': ['rate<0.01'],
  },
};

export default function () {
  const commodity = COMMODITIES[__ITER % COMMODITIES.length];
  const res = http.post(
    `${BASE}/api/v1/marketplace/requests`,
    JSON.stringify({
      commoditySummary: `${commodity} (k6-iter-${__ITER})`,
      originCountry: 'CN',
      destinationCountry: 'US',
      mode: 'ocean',
      serviceCategories: ['ocean_clearance'],
      visibilityMode: 'invited',
    }),
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${JWT}`,
      },
      tags: { name: 'create-request' },
    },
  );

  check(res, {
    'status 200/201': (r) => r.status === 200 || r.status === 201,
    'response has matches': (r) => {
      try {
        const data = JSON.parse(r.body).data;
        return Array.isArray(data?.matches);
      } catch {
        return false;
      }
    },
  });
}
