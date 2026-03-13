#!/usr/bin/env ts-node
/**
 * Patch R — 2026-03-12:
 *
 * Fix 3 overly-broad rules causing wrong chapter allowance:
 *
 * 1. AI_CH56_WADDING_BATTING: "filling" in anyOf fires for "in the warp and/or filling"
 *    (warp+filling = weaving terms for weft threads, NOT stuffing/padding).
 *    Query: "With two or more colors in the warp and/or filling Recreational performance
 *    outerwear... Woven fabrics of cotton" → incorrectly allows only ch.56, blocking ch.60/62.
 *    Fix: remove "filling" from anyOf.
 *
 * 2. AI_CH57_COTTON_WOVEN_RUG: "woven" alone + required:"cotton" fires for ANY
 *    "woven fabrics of cotton" query, including outerwear/garment context.
 *    allowChapters:[57] (rugs) blocks ch.52/58/60/62 (correct cotton fabric/garment chapters).
 *    Fix: add noneOf for non-rug contexts (outerwear, recreational, performance, warp,
 *    filling, garment, apparel) and remove bare "woven" which is too generic.
 *
 * 3. FRESH_FRUIT_INTENT: "coconut" in anyOf fires for "Derived from coconut Activated carbon"
 *    → allowChapters:[08] (fruits), blocking ch.38 (activated carbon, chemical products).
 *    Fix: add noneOf=['activated carbon','activated','carbon','charcoal'] so coconut-shell-
 *    derived carbon products don't fire the fruit intent.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12r.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH56_WADDING_BATTING — remove "filling" (weaving term, not stuffing) ──
  {
    priority: 620,
    rule: {
      id: 'AI_CH56_WADDING_BATTING',
      description: 'Wadding, batting, fiberfill, stuffing, polyfill for padding/insulation → ch.56. ' +
        'Removed "filling" which fires for weaving context "in the warp and/or filling" ' +
        '(filling = weft threads in weaving, NOT stuffing).',
      pattern: {
        anyOf: [
          'wadding',
          'batting',
          'fiberfill',
          'stuffing',
          'polyfill',
          'polyester fill',
          'cushion fill',
        ],
      },
      whitelist: { allowChapters: ['56'] },
    },
  },

  // ── 2. Fix AI_CH57_COTTON_WOVEN_RUG — add noneOf for non-rug context ─────────────
  {
    priority: 620,
    rule: {
      id: 'AI_CH57_COTTON_WOVEN_RUG',
      description: 'Cotton woven rugs, dhurries, flatweave mats → ch.57. ' +
        'Removed bare "woven" from anyOf (too generic — fires for "woven fabrics of cotton" ' +
        'in garment/outerwear HTS descriptions). Added noneOf for garment/fabric context. ' +
        'Now requires an actual rug/carpet/mat term.',
      pattern: {
        anyOf: [
          'rug',
          'carpet',
          'runner',
          'dhurrie',
          'flatweave',
          'mat',
          'area rug',
          'cotton rug',
          'woven rug',
          'woven mat',
        ],
        required: ['cotton'],
        noneOf: [
          'outerwear',
          'recreational',
          'performance',
          'garment',
          'apparel',
          'warp',
          'yarn',
          'knitted',
          'crocheted',
          'woven fabric',
          'woven fabrics',
        ],
      },
      whitelist: { allowChapters: ['57'] },
    },
  },

  // ── 3. Fix FRESH_FRUIT_INTENT — exclude activated carbon / coconut-derived products ──
  {
    priority: 650,
    rule: {
      id: 'FRESH_FRUIT_INTENT',
      description: 'Fresh/frozen fruit → ch.08. ' +
        'Added noneOf for activated carbon context: "coconut" appears in HTS descriptions ' +
        'for coconut-shell-derived activated carbon (ch.38), which should NOT be restricted ' +
        'to ch.08. Also exclude machinery context (already present from prior patch).',
      pattern: {
        anyOf: [
          'apple', 'apples', 'banana', 'bananas', 'orange', 'oranges',
          'strawberry', 'strawberries', 'blueberry', 'blueberries',
          'grape', 'grapes', 'mango', 'mangoes', 'avocado', 'avocados',
          'lemon', 'lemons', 'lime', 'limes', 'peach', 'peaches',
          'pear', 'pears', 'watermelon', 'pineapple', 'cherry', 'cherries',
          'kiwi', 'papaya', 'coconut', 'plum', 'plums', 'fruit', 'fruits',
        ],
        noneOf: [
          // Machinery context (from prior patch)
          'machinery', 'machine', 'machines', 'sorting', 'grading',
          'harvesting', 'cleaning', 'processing', 'agricultural machinery',
          // Activated carbon / chemical products derived from coconut shell
          'activated carbon',
          'activated',
          'charcoal',
          'carbon black',
          'mineral products',
        ],
      },
      whitelist: { allowChapters: ['08'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch R)...`);

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
    console.log(`\nPatch R complete: ${success} applied, ${failed} failed`);
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
