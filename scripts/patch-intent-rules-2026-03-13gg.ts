#!/usr/bin/env ts-node
/**
 * Patch GG — 2026-03-13:
 *
 * Fix 6 rules causing cross-chapter misclassification:
 *
 * 1. AI_CH51_CASHMERE_FIBER: "cashmere" fires for "Wholly of cashmere...Sweaters
 *    pullovers sweatshirts...knitted or crocheted" (ch.61 knitted garments)
 *    → allowChapters:[51] blocks ch.61. noneOf has "sweater" (singular) but not
 *    "sweaters" (plural). Fix: add plural/variant forms to noneOf.
 *
 * 2. AI_CH89_ROWBOAT_PADDLEBOAT: "shell" fires for "Other Other In shell" (peanuts
 *    in shell, ch.12) → allowChapters:[89] (rowing shells/boats) blocks ch.12.
 *    Fix: add noneOf for seed/nut/grain context.
 *
 * 3. AI_CH06_BULBS_CORMS: "tuber" fires for "Truffles Tuber spp." (ch.07 fresh
 *    truffles) → allowChapters:[06] (plant bulbs/corms). "Tuber" is the genus name
 *    for truffles (fungi) and also means plant tubers/bulbs. Fix: add noneOf for
 *    truffle/fungi context.
 *
 * 4. AI_CH03_SHARK_FIN: "head" fires for "Other Head lettuce cabbage lettuce"
 *    (ch.07 vegetables) → allowChapters:[03] blocks ch.07 by splitting surviving set.
 *    "Head lettuce" is a vegetable; "head" in ch.03 context = fish head.
 *    Fix: add noneOf for lettuce/vegetable context.
 *
 * 5. YARN_INTENT: bare "yarn" fires for "Trousers of worsted wool fabric made of
 *    wool yarn having an average fiber diameter of 18.5 microns" (ch.62 woven
 *    garments) → allowChapters:[55,51,52] blocks ch.62. Fix: add noneOf for
 *    finished garment context.
 *
 * 6. AI_CH51_WOOL_FABRIC: "worsted" fires for same query → allowChapters:[51]
 *    blocks ch.62. Fix: add noneOf for garment/diameter context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13gg.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH51_CASHMERE_FIBER — add plural/variant garment noneOf ─────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH51_CASHMERE_FIBER',
      description: 'Cashmere wool fiber → ch.51. ' +
        'Added plural/variant garment forms to noneOf: "sweaters" (plural) and "knitted" ' +
        '(past form) are not matched by "sweater"/"knit" noneOf. "Wholly of cashmere ' +
        'Sweaters pullovers...knitted or crocheted" is ch.61 knitted garments, not ch.51 ' +
        'raw fiber. Cashmere fiber ≠ finished cashmere garments.',
      pattern: {
        anyOf: ['cashmere', 'kashmir'],
        noneOf: [
          'yarn', 'fabric', 'sweater', 'sweaters', 'coat', 'garment', 'garments',
          'knit', 'knitted', 'woven', 'crocheted',
          'pullover', 'pullovers', 'sweatshirt', 'sweatshirts',
          'vest', 'vests', 'waistcoat', 'waistcoats',
          'jackets', 'jacket', 'suits', 'suit',
        ],
      },
      whitelist: { allowChapters: ['51'] },
    },
  },

  // ── 2. Fix AI_CH89_ROWBOAT_PADDLEBOAT — add noneOf for seed/nut context ────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH89_ROWBOAT_PADDLEBOAT',
      description: 'Rowboats, rowing shells, paddle boats → ch.89. ' +
        'Added noneOf for seed/nut context: "shell" fires for "In shell" (peanuts/nuts ' +
        'in shell, ch.12). A rowing "shell" is a lightweight racing boat; "in shell" means ' +
        'nuts/seeds with their hull/husk intact.',
      pattern: {
        anyOf: ['rowboat', 'rowing', 'paddleboat', 'pedal', 'sculling', 'scull', 'shell', 'skiff', 'punt', 'gondola', 'dory'],
        noneOf: [
          // Nut/seed/grain context → ch.12/08/11
          'peanut', 'peanuts', 'nut', 'nuts', 'seed', 'seeds', 'groundnut', 'groundnuts',
          'grain', 'cereal', 'almond', 'almonds', 'walnut', 'walnuts', 'pistachio',
          'hazelnut', 'cashew', 'pecan',
        ],
      },
      whitelist: { allowChapters: ['89'] },
    },
  },

  // ── 3. Fix AI_CH06_BULBS_CORMS — add noneOf for truffle/fungi context ─────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH06_BULBS_CORMS',
      description: 'Plant bulbs, corms, tubers, rhizomes → ch.06. ' +
        'Added noneOf for truffle/fungi context: "tuber" fires for "Truffles Tuber spp." ' +
        '(ch.07 fresh truffles). "Tuber" is the genus name for truffles (underground fungi), ' +
        'not a plant storage organ. Also "spp." (species abbreviation) appears in scientific ' +
        'fungal names. Truffles/mushrooms are ch.07, not ch.06 (planting material).',
      pattern: {
        anyOf: [
          'bulb', 'bulbs', 'corm', 'corms', 'tuber', 'tubers', 'rhizome', 'rhizomes',
          'hyacinth', 'narcissus', 'daffodil', 'crocus', 'gladiolus', 'begonia', 'iris', 'dahlia',
        ],
        noneOf: [
          'cut', 'dried', 'artificial', 'silk',
          // Truffle/fungi context → ch.07
          'truffle', 'truffles', 'fungus', 'fungi', 'mushroom', 'mushrooms',
          'spp',
        ],
      },
      whitelist: { allowChapters: ['06'] },
    },
  },

  // ── 4. Fix AI_CH03_SHARK_FIN — add noneOf for lettuce/vegetable context ────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH03_SHARK_FIN',
      description: 'Fish heads, fins, shark fins, fish offal → ch.03. ' +
        'Added noneOf for lettuce/vegetable context: "head" fires for "Other Head lettuce ' +
        'cabbage lettuce" (ch.07 head lettuce vegetables) → allowChapters:[03] competes ' +
        'with FRESH_VEGETABLE_INTENT allowChapters:[07], resulting in ch.03 winning semantically. ' +
        '"Head lettuce" is a vegetable; "head" in fish context = fish head.',
      pattern: {
        anyOf: ['fin', 'sharkfin', 'maw', 'head', 'tail', 'offal'],
        noneOf: [
          // Vegetable context → ch.07
          'lettuce', 'cabbage', 'vegetable', 'vegetables', 'celery', 'broccoli',
          'carrot', 'corn', 'spinach', 'leek', 'potato', 'onion',
        ],
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 5. Fix YARN_INTENT — add noneOf for finished garment context ──────────────
  {
    priority: 630,
    rule: {
      id: 'YARN_INTENT',
      description: 'Knitting/crochet yarn, textile yarn → ch.55/51/52. ' +
        'Added noneOf for finished garment context: "Trousers of worsted wool fabric made ' +
        'of wool yarn...diameter 18.5 microns" is a ch.62 woven garment. "yarn" in this ' +
        'context describes the yarn used to weave the fabric, not yarn for sale. ' +
        'Finished garments ≠ yarn.',
      pattern: {
        anyOf: ['yarn', 'knitting yarn', 'crochet yarn', 'wool knitting yarn', 'acrylic yarn', 'chunky yarn', 'cotton yarn'],
        noneOf: [
          // Finished garment context → ch.62/61
          'trousers', 'trouser', 'pants', 'suit', 'suits', 'garment', 'garments',
          'jacket', 'jackets', 'coat', 'coats', 'dress', 'dresses',
          // Fabric spec context
          'diameter', 'microns', 'micron', 'fiber diameter', 'average fiber',
        ],
      },
      whitelist: { allowChapters: ['55', '51', '52'] },
    },
  },

  // ── 6. Fix AI_CH51_WOOL_FABRIC — add noneOf for garment/diameter context ───────
  {
    priority: 640,
    rule: {
      id: 'AI_CH51_WOOL_FABRIC',
      description: 'Woven wool fabrics: tweed, flannel, worsted, broadcloth → ch.51. ' +
        'Added noneOf for finished garment/fiber spec context: "Trousers of worsted wool ' +
        'fabric...average fiber diameter of 18.5 microns" (ch.62 woven trousers) has ' +
        '"worsted" but is a garment, not fabric. "diameter"/"microns" describe fiber fineness ' +
        'in garment specs, not wool fabric grades.',
      pattern: {
        anyOf: [
          'tweed', 'flannel', 'worsted', 'woolen', 'woolens',
          'broadcloth', 'melton', 'serge', 'gabardine',
        ],
        noneOf: [
          'coat', 'suit', 'garment', 'sweater', 'blanket', 'carpet',
          'cotton', 'polyester', 'nylon', 'synthetic', 'filament',
          'man-made', 'man made', 'artificial', 'acrylic',
          'poplin', 'numbers', 'plain weave',
          // Finished garment context → ch.62
          'trousers', 'trouser', 'pants', 'jackets', 'jacket', 'dresses', 'dress',
          'diameter', 'microns', 'micron',
        ],
      },
      whitelist: { allowChapters: ['51'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch GG)...`);

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
    console.log(`\nPatch GG complete: ${success} applied, ${failed} failed`);
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
