#!/usr/bin/env ts-node
/**
 * snapshot-resolver-baseline.ts
 *
 * Phase 0 (P0.T2) — captures `CalculatorV2QuoteService.quote()` output for a
 * curated fixture catalog and writes it to disk under
 * `hts-service/test/fixtures/exception-rules-baseline/`. The Phase 1
 * `ExceptionRuleRunnerService` is wired in as a no-op pass-through, so
 * re-running this script after Phase 1 lands must produce byte-identical
 * fixtures.
 *
 * The companion jest test
 * `hts-service/test/exception-rules/baseline-regression.spec.ts` re-runs
 * each fixture's input and asserts deep-equal output. That test is what
 * actually guards against regressions; this script is the one-time (and
 * occasional re-snapshot) generator.
 *
 * Usage:
 *   npx ts-node scripts/snapshot-resolver-baseline.ts            # write all
 *   npx ts-node scripts/snapshot-resolver-baseline.ts --check    # diff against existing; non-zero on diff
 *   npx ts-node scripts/snapshot-resolver-baseline.ts --filter=US-apparel-CN
 *
 * Environment:
 *   - Requires DB + jurisdictions seeded.
 *   - Idempotent — re-running with no code change is a no-op.
 *
 * Determinism notes:
 *   - `quote.quoteId` and `quote.generatedAt` are stripped from the snapshot
 *     because they're per-call random/clock values. The runner doesn't
 *     touch them, so the regression check ignores them too.
 *   - Floating-point amounts are rounded to 4 decimal places before write
 *     to avoid spurious diffs from FX provider micro-jitter.
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { CalculatorV2QuoteService } from '../src/modules/calculator-v2-quote/calculator-v2-quote.service';
import type { CalculatorV2QuoteRequest } from '../src/modules/calculator-v2-quote/calculator-v2-quote.types';

interface FixtureSpec {
  slug: string;
  request: CalculatorV2QuoteRequest;
}

/**
 * Catalog of baseline fixtures. Keep this short, representative, and stable.
 *
 * Naming: `{DEST}-{archetype}-{ORIGIN}[-{variant}]`. The slug becomes the
 * fixture filename.
 */
const FIXTURES: FixtureSpec[] = [
  // US — primary surface; covers apparel, steel article, aluminum
  // article, electronics, alcohol, vehicle archetype × CN/KR/MX/VN.
  {
    slug: 'US-apparel-CN',
    request: {
      destination: { country: 'US' },
      origin: { country: 'CN' },
      currency: 'USD',
      items: [{ classificationCode: '6109.10.0004', unitValue: 1000, quantity: 1 }],
    },
  },
  {
    slug: 'US-apparel-VN',
    request: {
      destination: { country: 'US' },
      origin: { country: 'VN' },
      currency: 'USD',
      items: [{ classificationCode: '6109.10.0004', unitValue: 1000, quantity: 1 }],
    },
  },
  {
    slug: 'US-steel-article-CN',
    request: {
      destination: { country: 'US' },
      origin: { country: 'CN' },
      currency: 'USD',
      items: [{ classificationCode: '7326.20.0020', unitValue: 2000, quantity: 1 }],
    },
  },
  {
    slug: 'US-aluminum-article-CN',
    request: {
      destination: { country: 'US' },
      origin: { country: 'CN' },
      currency: 'USD',
      items: [{ classificationCode: '7616.99.5120', unitValue: 1000, quantity: 1 }],
    },
  },
  {
    slug: 'US-aluminum-derivative-8302-CN',
    request: {
      destination: { country: 'US' },
      origin: { country: 'CN' },
      currency: 'USD',
      items: [{ classificationCode: '8302.49.6085', unitValue: 1000, quantity: 1 }],
    },
  },
  {
    slug: 'US-electronics-MX',
    request: {
      destination: { country: 'US' },
      origin: { country: 'MX' },
      currency: 'USD',
      items: [{ classificationCode: '8471.30.0100', unitValue: 1500, quantity: 1 }],
    },
  },
  {
    slug: 'US-electronics-CN',
    request: {
      destination: { country: 'US' },
      origin: { country: 'CN' },
      currency: 'USD',
      items: [{ classificationCode: '8471.30.0100', unitValue: 1500, quantity: 1 }],
    },
  },
  // CA
  {
    slug: 'CA-apparel-CN',
    request: {
      destination: { country: 'CA' },
      origin: { country: 'CN' },
      currency: 'CAD',
      items: [{ classificationCode: '6109.10.0010', unitValue: 1000, quantity: 1 }],
    },
  },
  {
    slug: 'CA-electronics-US',
    request: {
      destination: { country: 'CA' },
      origin: { country: 'US' },
      currency: 'CAD',
      items: [{ classificationCode: '8471.30.0000', unitValue: 1500, quantity: 1 }],
    },
  },
  // GB
  {
    slug: 'GB-apparel-CN',
    request: {
      destination: { country: 'GB' },
      origin: { country: 'CN' },
      currency: 'GBP',
      items: [{ classificationCode: '6109.10.0000', unitValue: 1000, quantity: 1 }],
    },
  },
  // EU-DE
  {
    slug: 'EU-DE-apparel-CN',
    request: {
      destination: { country: 'EU', memberState: 'DE' },
      origin: { country: 'CN' },
      currency: 'EUR',
      items: [{ classificationCode: '6109.10.0000', unitValue: 500, quantity: 1 }],
    },
  },
  // HK
  {
    slug: 'HK-apparel-CN',
    request: {
      destination: { country: 'HK' },
      origin: { country: 'CN' },
      currency: 'HKD',
      items: [{ classificationCode: '6109.10.0000', unitValue: 1000, quantity: 1 }],
    },
  },
  // KR
  {
    slug: 'KR-apparel-CN',
    request: {
      destination: { country: 'KR' },
      origin: { country: 'CN' },
      currency: 'KRW',
      items: [{ classificationCode: '6109.10.0000', unitValue: 1_000_000, quantity: 1 }],
    },
  },
  {
    slug: 'KR-apparel-CN-deminimis',
    request: {
      destination: { country: 'KR' },
      origin: { country: 'CN' },
      currency: 'KRW',
      items: [{ classificationCode: '6109.10.0000', unitValue: 150_000, quantity: 1 }],
    },
  },
  // SG
  {
    slug: 'SG-apparel-CN',
    request: {
      destination: { country: 'SG' },
      origin: { country: 'CN' },
      currency: 'SGD',
      items: [{ classificationCode: '6109.10.0000', unitValue: 1000, quantity: 1 }],
    },
  },
  // AU
  {
    slug: 'AU-apparel-CN',
    request: {
      destination: { country: 'AU' },
      origin: { country: 'CN' },
      currency: 'AUD',
      items: [{ classificationCode: '6109.10.0000', unitValue: 2000, quantity: 1 }],
    },
  },
  // NZ
  {
    slug: 'NZ-apparel-CN',
    request: {
      destination: { country: 'NZ' },
      origin: { country: 'CN' },
      currency: 'NZD',
      items: [{ classificationCode: '6109.10.0000', unitValue: 2000, quantity: 1 }],
    },
  },
  // TW
  {
    slug: 'TW-apparel-CN',
    request: {
      destination: { country: 'TW' },
      origin: { country: 'CN' },
      currency: 'TWD',
      items: [{ classificationCode: '6109.10.0000', unitValue: 10_000, quantity: 1 }],
    },
  },
];

const FIXTURE_DIR = path.resolve(
  __dirname,
  '..',
  'test',
  'fixtures',
  'exception-rules-baseline',
);

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Strip non-deterministic fields and round amounts. Mirrors what the
 * regression test will do at compare-time.
 */
function normalize(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map(normalize);
  if (payload && typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (k === 'quoteId' || k === 'generatedAt') continue;
      out[k] = normalize(v);
    }
    return out;
  }
  if (typeof payload === 'number' && !Number.isInteger(payload)) {
    return round4(payload);
  }
  return payload;
}

function readArg(name: string): string | undefined {
  const m = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!m) return undefined;
  if (m === `--${name}`) return '';
  const eq = m.indexOf('=');
  return eq === -1 ? '' : m.slice(eq + 1);
}

async function main() {
  const checkMode = readArg('check') !== undefined;
  const filter = readArg('filter');

  if (!fs.existsSync(FIXTURE_DIR)) {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const quotes = app.get(CalculatorV2QuoteService, { strict: false });

  let written = 0;
  let mismatched = 0;
  const failures: string[] = [];

  for (const fx of FIXTURES) {
    if (filter && !fx.slug.includes(filter)) continue;
    const file = path.join(FIXTURE_DIR, `${fx.slug}.json`);

    let result: unknown;
    try {
      result = await quotes.quote(fx.request);
    } catch (e: any) {
      failures.push(`${fx.slug}: ${e?.message ?? e}`);
      continue;
    }

    const snapshot = {
      request: fx.request,
      result: normalize(result),
    };
    const serialized = JSON.stringify(snapshot, null, 2) + '\n';

    if (checkMode) {
      if (!fs.existsSync(file)) {
        mismatched++;
        failures.push(`${fx.slug}: fixture missing`);
        continue;
      }
      const onDisk = fs.readFileSync(file, 'utf8');
      if (onDisk !== serialized) {
        mismatched++;
        failures.push(`${fx.slug}: drift detected`);
      }
    } else {
      fs.writeFileSync(file, serialized);
      written++;
    }
  }

  await app.close();

  if (checkMode) {
    if (mismatched > 0) {
      console.error(`✗ ${mismatched} fixture(s) drift:`);
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(2);
    }
    console.log(`✓ ${FIXTURES.length} fixtures match`);
    return;
  }
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} fixture(s) failed to capture:`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log(`Wrote ${written} fixture(s) → ${path.relative(process.cwd(), FIXTURE_DIR)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
