#!/usr/bin/env ts-node
/**
 * Patch LL — 2026-03-13:
 *
 * Fix 1 rule:
 *
 * 1. INDOOR_PLANT_INTENT: "plants" fires for "Vegetables fruit nuts...parts of plants
 *    preserved by sugar drained glazed or crystallized" (2006 ch.20) → allowChapters:[06].
 *    After KK patches, PRESERVED_FOOD_CH20_INTENT allows ch.20, SUGAR/FRESH_VEG/FRESH_FRUIT
 *    rules no longer fire — but INDOOR_PLANT_INTENT still fires for "plants" → surviving
 *    includes [06,20] instead of just [20]. Fix: add noneOf for preserved/sugar context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ll.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix INDOOR_PLANT_INTENT — exclude preserved food context ──────────────
  {
    priority: 640,
    rule: {
      id: 'INDOOR_PLANT_INTENT',
      description: 'Indoor/ornamental plants, succulents, houseplants, bonsai → ch.06. ' +
        'Added noneOf for preserved/food context: "Vegetables fruit nuts...parts of plants ' +
        'preserved by sugar drained glazed or crystallized" (2006 ch.20) has "plants" → ' +
        'fires allowChapters:[06]. "Parts of plants" in a preservation/food context = ch.20, ' +
        'not ch.06 live/ornamental plants.',
      pattern: {
        anyOf: [
          'plant', 'plants', 'succulent', 'succulents', 'houseplant', 'houseplants',
          'bonsai', 'seedling', 'herb',
        ],
        noneOf: [
          'factory', 'power', 'industrial', 'manufacturing',
          'stake', 'hanger', 'stained glass', 'stained', 'magnet', 'magnets', 'magnetic',
          'fridge magnet', 'stand', 'shelf',
          // Preserved food context → ch.20
          'preserved', 'preserved by sugar', 'preserved by', 'sugar', 'drained',
          'glazed', 'crystallized', 'candied', 'glace', 'in syrup',
        ],
      },
      whitelist: { allowChapters: ['06'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch LL)...`);

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
    console.log(`\nPatch LL complete: ${success} applied, ${failed} failed`);
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
