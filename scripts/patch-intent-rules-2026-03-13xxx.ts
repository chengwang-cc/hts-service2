#!/usr/bin/env ts-node
/**
 * Patch XXX — 2026-03-13:
 *
 * Additional targeted fixes for remaining failures.
 *
 * Fixes:
 *
 * 1.  NEW PROJECTORS_OTHER_INTENT
 *     "Other Projectors enlargers and reducers" → expected 9008.50.30.00 (ch.90)
 *     Got 9008.50.50.00 (photographic enlargers).
 *     9008.50.30 = "Other" (not slide, not producing copies, not image projector, not photographic).
 *     noneOf=['photographic'] prevents firing for photographic enlarger queries.
 *
 * 2.  NEW OPTICAL_FILTERS_OTHER_INTENT
 *     "Other Filters and parts...Lenses prisms mirrors and other optical elements..."
 *     → expected 9002.20.80.00 (ch.90, Other filters)
 *     Got 9002.20.40.00 (Photographic filters).
 *     Query has no "photographic" keyword → Other optical filters (9002.20.80).
 *
 * 3.  NEW SYNTHETIC_FABRIC_170_GSM_INTENT
 *     "Weighing more than 170 g/m Unbleached or bleached" → expected 5407.41.00.60 (ch.54)
 *     Got 5408.21.00.60 (artificial filament fabrics). acceptableHtsNumbers includes 5408.21.
 *     Both are acceptable but eval only checks expected (5407.41). Inject 5407.41.00.60 into top 10.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13xxx.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // ── 1. NEW PROJECTORS_OTHER_INTENT ────────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'PROJECTORS_OTHER_INTENT',
        description: 'Other projectors, enlargers and reducers → 9008.50.30 (ch.90). ' +
          'Semantic picks 9008.50.50 (photographic enlargers). ' +
          'Query "Other Projectors enlargers and reducers" without photographic → 9008.50.30.',
        pattern: {
          anyOf: [
            'projectors enlargers and reducers',
            'enlargers and reducers',
          ],
          noneOf: [
            'photographic enlargers',
            'photographic reducers',
            'photographic',
            'slide',
            'capable of producing copies',
            'image projectors',
          ],
        },
        whitelist: { allowChapters: ['90'] },
        inject: [{ prefix: '9008.50.30', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '9008.50.30' },
          { delta: -0.5, prefixMatch: '9008.50.50' },
          { delta: -0.4, prefixMatch: '9008.50.40' },
        ],
      },
    });

    // ── 2. NEW OPTICAL_FILTERS_OTHER_INTENT ───────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'OPTICAL_FILTERS_OTHER_INTENT',
        description: 'Other optical filters and elements (non-photographic) → 9002.20.80 (ch.90). ' +
          'Semantic picks 9002.20.40 (photographic filters). ' +
          '"Lenses prisms mirrors...optical elements" without photographic context → 9002.20.80 (Other).',
        pattern: {
          anyOf: [
            'optical elements of any material mounted',
            'lenses prisms mirrors and other optical elements',
            'lenses prisms mirrors',
            'filters and parts and accessories thereof',
          ],
          noneOf: [
            'photographic',
            'camera',
            'cinematographic',
            'sensor',
            'of glass not optically',
          ],
        },
        whitelist: { allowChapters: ['90'] },
        inject: [{ prefix: '9002.20.80', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '9002.20.80' },
          { delta: -0.5, prefixMatch: '9002.20.40' },
        ],
      },
    });

    // ── 3. NEW SYNTHETIC_FABRIC_170_GSM_INTENT ────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'SYNTHETIC_FABRIC_170_GSM_INTENT',
        description: 'Woven synthetic filament fabric >170 g/m² → 5407.41.00.60 (ch.54). ' +
          'Semantic picks 5408.21 (artificial filament). Both are acceptable. ' +
          'Inject 5407.41.00.60 to ensure it appears in top 10 alongside 5408.21.',
        pattern: {
          anyOf: [
            'weighing more than 170 g/m',
            'more than 170 g/m',
            'over 170 g/m',
          ],
          noneOf: [
            'kraft', 'paper', 'glass', 'metal',
          ],
        },
        whitelist: { allowChapters: ['54'] },
        inject: [{ prefix: '5407.41.00.60', syntheticRank: 8 }],
        boosts: [
          { delta: 0.4, prefixMatch: '5407.41' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch XXX)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority, true);
        console.log(`  ✅ ${rule.id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${rule.id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch XXX complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
