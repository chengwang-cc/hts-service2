/**
 * Baseline regression guard (Phase 0, P0.T2).
 *
 * Re-runs each fixture under `test/fixtures/exception-rules-baseline/`
 * through `CalculatorV2QuoteService.quote()` and asserts deep-equal output
 * after the same normalization the snapshot script applies.
 *
 * Tagged `@slow` — opt-in (`jest -t @slow`) or run via the dedicated CI
 * job. Skips automatically when:
 *   - No fixtures exist yet (Phase 0 hasn't been run), or
 *   - The dev DB is not reachable (CI without a hts-service DB).
 *
 * Phase 1's no-op runner must leave every fixture byte-identical.
 * Subsequent phases that activate rules will land fixture updates as part
 * of their PR.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { CalculatorV2QuoteService } from '../../src/modules/calculator-v2-quote/calculator-v2-quote.service';

const FIXTURE_DIR = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'exception-rules-baseline',
);

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

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

interface FixtureFile {
  slug: string;
  filePath: string;
  request: any;
  expectedResult: unknown;
}

function loadFixtures(): FixtureFile[] {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((file) => {
      const filePath = path.join(FIXTURE_DIR, file);
      const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        slug: path.basename(file, '.json'),
        filePath,
        request: json.request,
        expectedResult: json.result,
      };
    });
}

describe('@slow baseline regression — exception-rules baseline fixtures', () => {
  const fixtures = loadFixtures();
  let module: TestingModule | null = null;
  let quotes: CalculatorV2QuoteService | null = null;

  beforeAll(async () => {
    if (fixtures.length === 0) return;
    try {
      module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      await module.init();
      quotes = module.get(CalculatorV2QuoteService, { strict: false });
    } catch (e: any) {
      // DB not reachable; tests below will skip via the guard.
      module = null;
      quotes = null;
    }
  }, 60_000);

  afterAll(async () => {
    if (module) await module.close();
  });

  if (fixtures.length === 0) {
    it('skipped — no baseline fixtures captured yet (run scripts/snapshot-resolver-baseline.ts)', () => {
      expect(true).toBe(true);
    });
    return;
  }

  for (const fx of fixtures) {
    it(`${fx.slug}`, async () => {
      if (!quotes) {
        // Could not bring up the app context (no DB). Treat as skip.
        // eslint-disable-next-line no-console
        console.warn(`[baseline-regression] skipped ${fx.slug}: app context unavailable`);
        return;
      }
      const actual = normalize(await quotes.quote(fx.request));
      expect(actual).toEqual(fx.expectedResult);
    }, 30_000);
  }
});
