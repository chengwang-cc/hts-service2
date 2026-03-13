#!/usr/bin/env ts-node
/**
 * Patch PP — 2026-03-13:
 *
 * Fix 1 rule:
 *
 * 1. PRESERVED_FOOD_CH20_INTENT: Add "including nectarines" phrase to anyOf.
 *    "Other Nectarines Peaches including nectarines" (2008.70 ch.20 — prepared/preserved
 *    peaches including nectarines) → FRESH_FRUIT_INTENT fires for "peaches" → allowChapters:[08],
 *    blocking ch.20. The phrase "including nectarines" is characteristic of HTS heading
 *    2008.70 (prepared peaches). Adding this phrase allows PRESERVED_FOOD_CH20_INTENT to also
 *    fire → surviving includes both [08,20] → search can return the better semantic match
 *    (ch.20 should dominate for this preserved peach description).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13pp.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. PRESERVED_FOOD_CH20_INTENT — add nectarines phrase ─────────────────────
  {
    priority: 660,
    rule: {
      id: 'PRESERVED_FOOD_CH20_INTENT',
      description: 'Fruits/vegetables preserved by sugar, glazed, crystallized, in syrup; ' +
        'jams, marmalades, jellies → ch.20. ' +
        'Added "including nectarines" phrase: "Other Nectarines Peaches including nectarines" ' +
        '(2008.70 ch.20) has FRESH_FRUIT_INTENT firing for "peaches" → [08] blocks ch.20. ' +
        '"Including nectarines" is the specific HTS language for prepared peaches (2008.70).',
      pattern: {
        anyOf: [
          'preserved by sugar', 'drained glazed', 'glazed or crystallized',
          'crystallized', 'candied', 'in syrup', 'in sugar syrup',
          'jam', 'jams', 'marmalade', 'marmalades', 'jelly', 'jellies',
          'fruit butter', 'fruit paste', 'chutney', 'fruit preserves',
          // HTS-specific phrase for prepared peaches (2008.70) → ch.20
          'including nectarines', 'peaches including nectarines',
        ],
      },
      whitelist: { allowChapters: ['20'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch PP)...`);

    let success = 0;
    let failed = 0;

    for (const { rule, priority } of PATCHES) {
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
    console.log(`\nPatch PP complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

patch().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
