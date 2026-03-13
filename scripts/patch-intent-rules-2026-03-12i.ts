#!/usr/bin/env ts-node
/**
 * Patch I — 2026-03-12:
 *
 * Fix allowChapters conflicts exposed by patch H:
 *
 * 1. AI_CH36_FUSES_DETONATORS — bare "electric" in anyOf fires allowChapters['36']
 *    for "electric motor", "electric kettle", etc. → detonators show up!
 *    Fix: replace bare "electric" with "electric fuse", "electric detonator", etc.;
 *    add noneOf for common "electric X" products.
 *
 * 2. AI_CH19_PASTRY_CAKE — "cake" fires allowChapters['19'] for "silicone cake mold" /
 *    "cake mold" / "cake cutter". Fix: add noneOf for kitchen tool vocabulary.
 *
 * 3. SILICONE_MOLD_INTENT — add allowChapters['39'] so OR logic beats AI_CH19_PASTRY_CAKE's
 *    allowChapters['19']. With both firing: entry must be in ch.19 OR ch.39; then
 *    denyChapters['19'] removes ch.19 → only ch.39 survives.
 *
 * 4. PET_ACCESSORY_INTENT — replace denyChapters['71'] with allowChapters['42'].
 *    JEWELRY_NECKLACE_INTENT fires allowChapters['71'] for "pet necklace".
 *    With denyChapters['71'] AND allowChapters['71']: allow gives ch.71, deny removes
 *    ch.71, ch.42 fails allowChapters → empty results.
 *    Fix: allowChapters['42'] + high penalty on ch.71 (no hard deny).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12i.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH36_FUSES_DETONATORS — remove bare "electric" ─────────────
  {
    priority: 306,
    rule: {
      id: 'AI_CH36_FUSES_DETONATORS',
      description: 'Safety/detonating fuses, percussion caps, detonators → ch.36; only for explosive/pyrotechnic context',
      pattern: {
        anyOf: [
          'electric fuse', 'electric detonator', 'electric blasting cap',
          'electric primer', 'electric initiator', 'electric squib',
          'fuse', 'fuses', 'detonating cord', 'percussion cap', 'percussion caps',
          'igniter', 'igniters', 'detonator', 'detonators', 'blasting cap',
          'blasting', 'pyrotechnic fuse',
        ],
        noneOf: [
          // electrical products that contain "electric" but are NOT explosives
          'motor', 'kettle', 'guitar', 'scooter', 'keyboard', 'razor',
          'toothbrush', 'shaver', 'fan', 'heater', 'cooler', 'blanket',
          'bike', 'wheelchair', 'skateboard', 'hoverboard', 'desk',
          'car', 'vehicle', 'appliance', 'wire', 'cable', 'charger',
        ],
      },
      whitelist: {
        allowChapters: ['36'],
      },
    },
  },

  // ── 2. Fix AI_CH19_PASTRY_CAKE — exclude mold/cutter kitchen tools ────────
  {
    priority: 307,
    rule: {
      id: 'AI_CH19_PASTRY_CAKE',
      description: 'Baked pastry/cake products (food) → ch.19 (1905); not kitchen tools/molds',
      pattern: {
        anyOf: [
          'pastry', 'pastries', 'cake', 'cakes', 'muffin', 'muffins',
          'donut', 'donuts', 'doughnut', 'doughnuts', 'croissant', 'croissants',
          'danish', 'eclair', 'tart', 'tarts', 'cupcake', 'cupcakes',
          'brownie', 'brownies',
        ],
        noneOf: [
          // kitchen tools / craft
          'mold', 'mould', 'molds', 'moulds', 'cutter', 'cutters',
          'pan', 'tin', 'tray', 'stamp', 'press', 'silicone', 'bakeware',
          'tool', 'kit', '3d', 'print', 'printed', 'resin',
        ],
      },
      whitelist: {
        allowChapters: ['19'],
      },
    },
  },

  // ── 3. Fix SILICONE_MOLD_INTENT — add allowChapters['39'] ─────────────────
  {
    priority: 56,
    rule: {
      id: 'SILICONE_MOLD_INTENT',
      description: 'Silicone / plastic molds for baking, candy, soap, ice → ch.39 (plastic), deny ch.19 (food)',
      pattern: {
        anyOf: [
          'silicone mold', 'silicone mould', 'cake mold', 'cake mould',
          'baking mold', 'candy mold', 'chocolate mold', 'soap mold',
          'ice cube mold', 'ice cube tray', 'ice tray', 'ice mold',
          'fondant mold', 'gummy mold', 'resin mold', 'craft mold',
          'silicone baking', 'cookie mold',
        ],
        noneOf: ['food', 'recipe', 'ingredient'],
      },
      inject: [
        { prefix: '3926', syntheticRank: 2 },
        { prefix: '3922', syntheticRank: 5 },
      ],
      whitelist: {
        allowChapters: ['39'],  // competes with AI_CH19_PASTRY_CAKE via OR logic
        denyChapters: ['19'],   // then removes ch.19 entries that slipped through
      },
      boosts: [
        { delta: 0.55, chapterMatch: '39' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '19' },
      ],
    },
  },

  // ── 4. Fix PET_ACCESSORY_INTENT — allowChapters['42'] instead of deny['71'] ─
  {
    priority: 58,
    rule: {
      id: 'PET_ACCESSORY_INTENT',
      description: 'Pet collars / leashes / harnesses → ch.42; allowChapters[42] competes with JEWELRY_NECKLACE_INTENT[71] via OR logic',
      pattern: {
        anyOf: [
          'dog collar', 'cat collar', 'pet collar', 'puppy collar',
          'dog leash', 'cat leash', 'pet leash', 'dog lead', 'pet lead',
          'dog harness', 'cat harness', 'pet harness',
          'dog necklace', 'pet necklace', 'cat necklace',
          'dog tag', 'pet tag', 'dog id tag',
        ],
        noneOf: ['food', 'treat', 'toy', 'costume'],
      },
      inject: [
        { prefix: '4201', syntheticRank: 0 },
      ],
      whitelist: {
        allowChapters: ['42'],  // OR logic alongside JEWELRY_NECKLACE_INTENT's ch.71
      },
      boosts: [
        { delta: 0.60, chapterMatch: '42' },
      ],
      penalties: [
        { delta: 0.90, chapterMatch: '71' },  // high penalty, not hard deny
        { delta: 0.70, chapterMatch: '61' },
        { delta: 0.70, chapterMatch: '62' },
      ],
    },
  },
];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch I)...`);

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
    console.log(`\nPatch I complete: ${success} applied, ${failed} failed`);
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
