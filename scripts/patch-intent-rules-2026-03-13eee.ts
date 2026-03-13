#!/usr/bin/env ts-node
/**
 * Patch EEE — 2026-03-13:
 *
 * Compensate for CCC regression: FRESH_VEGETABLE_INTENT lost 'tomatoes' from anyOf.
 * Two ch.07 queries that had 'tomatoes' triggering FRESH_VEGETABLE_INTENT now fail.
 *
 * Fix:
 *
 * 1.  NEW FRESH_TOMATO_INTENT — "Tomatoes fresh or chilled" context → ch.07
 *     "Grape If entered...Tomatoes fresh or chilled" and "Roma plum type...Tomatoes fresh or chilled"
 *     were passing because FRESH_VEGETABLE_INTENT fired for 'tomatoes' → allowSet=['07'].
 *     CCC removed 'tomatoes' from FRESH_VEGETABLE_INTENT to allow ch.12 seed result for "Tomato".
 *     Add a more targeted rule: fires for 'tomato'/'tomatoes' + 'fresh'/'chilled' context.
 *     This anchors fresh/chilled tomato queries to ch.07 while NOT firing for bare "Tomato" (seeds).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13eee.ts
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

    // ── 1. NEW FRESH_TOMATO_INTENT ────────────────────────────────────────────────
    // Compensates for FRESH_VEGETABLE_INTENT losing 'tomato'/'tomatoes' from anyOf (CCC patch).
    // Two eval queries were passing via 'tomatoes' → FRESH_VEGETABLE_INTENT → allowSet=[07]:
    //   - "Grape If entered...Tomatoes fresh or chilled" → 0702.00.20.02 (ch.07)
    //   - "Roma plum type If entered...Tomatoes fresh or chilled" → 0702.00.20.04 (ch.07)
    // Without FRESH_VEGETABLE_INTENT firing for 'tomatoes', semantic picks ch.08 (fruits/grapes).
    // This rule fires ONLY when tomato appears WITH fresh/chilled context → ch.07 forced.
    // The bare "Tomato" (ch.12 seeds) query has no 'fresh'/'chilled' → rule doesn't fire →
    //   semantic can now find 1209.91.80.70 (tomato seeds) in top 10.
    patches.push({
      priority: 600,
      rule: {
        id: 'FRESH_TOMATO_INTENT',
        description: 'Fresh/chilled tomatoes → ch.07. Fires when tomato appears with fresh/chilled ' +
          'context, preserving ch.07 anchor without blocking ch.12 seed results for bare "Tomato".',
        pattern: {
          anyOfGroups: [
            ['tomato', 'tomatoes'],
            ['fresh', 'chilled', 'cooling', 'refrigerated'],
          ],
          noneOf: [
            'seed', 'seeds', 'for sowing', 'planting',
            'machinery', 'machine', 'sorting', 'grading', 'processing',
            'sauce', 'puree', 'paste', 'juice', 'preserved', 'canned',
          ],
        },
        whitelist: { allowChapters: ['07'] },
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch EEE)...`);
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
    console.log(`\nPatch EEE complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
