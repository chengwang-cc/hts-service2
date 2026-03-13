#!/usr/bin/env ts-node
/**
 * Patch U — 2026-03-12:
 *
 * Fix FRESH_VEGETABLE_INTENT firing for "vegetable fibers" in footwear/textile HTS
 * descriptions.
 *
 * Root cause: "vegetable" is in anyOf list of FRESH_VEGETABLE_INTENT → allowChapters:[07].
 * "Vegetable fibers" in HTS footwear descriptions (ch.64) refers to fiber material
 * (e.g. jute, coconut fiber, grass) used for shoe uppers/soles — NOT edible vegetables.
 * This causes allowChapters:[07] to block ch.64, and since no ch.07 entry matches
 * "vegetable fibers uppers soles", the API returns EMPTY.
 *
 * Fix: add noneOf=['fibers','fiber','material','materials','upper','uppers','sole','soles',
 * 'textile','textiles','yarn'] so "vegetable fibers" context doesn't trigger the food intent.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12u.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── Fix FRESH_VEGETABLE_INTENT — exclude fiber/material/footwear context ──────
  {
    priority: 660,
    rule: {
      id: 'FRESH_VEGETABLE_INTENT',
      description: 'Fresh/frozen vegetables → ch.07. ' +
        'Added noneOf for fiber/textile/footwear context: "vegetable" fires for ' +
        '"vegetable fibers" in footwear (ch.64) and textile HTS descriptions. ' +
        '"Vegetable fibers" = natural plant fibers (jute, sisal, coconut), NOT food vegetables. ' +
        'Also keeps prior machinery and activated-carbon noneOf exclusions.',
      pattern: {
        anyOf: [
          'broccoli', 'carrot', 'carrots', 'potato', 'potatoes', 'onion', 'onions',
          'tomato', 'tomatoes', 'spinach', 'lettuce', 'mushroom', 'mushrooms',
          'cucumber', 'cucumbers', 'corn', 'garlic', 'asparagus', 'zucchini',
          'eggplant', 'celery', 'cabbage', 'cauliflower', 'pumpkin', 'squash',
          'vegetable', 'vegetables', 'produce',
        ],
        noneOf: [
          // Machinery context (from patch Q)
          'machinery', 'machine', 'machines', 'sorting', 'grading', 'harvesting',
          'threshing', 'cleaning', 'processing', 'incubator', 'agricultural machinery',
          // Fiber/textile/footwear context — "vegetable fibers" = plant fiber material
          'fibers', 'fiber', 'material', 'materials',
          'upper', 'uppers', 'sole', 'soles', 'textile', 'textiles',
          'yarn', 'thread', 'woven', 'knitted',
        ],
      },
      whitelist: { allowChapters: ['07'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch U)...`);

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
    console.log(`\nPatch U complete: ${success} applied, ${failed} failed`);
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
