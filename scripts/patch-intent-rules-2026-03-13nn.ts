#!/usr/bin/env ts-node
/**
 * Patch NN — 2026-03-13:
 *
 * Fix 5 rules that introduced new cross-chapter conflicts after patches KK/LL/MM:
 *
 * 1. INDOOR_PLANT_INTENT: "plant" fires for "Machinery plant or laboratory equipment...
 *    sterilizers" (8419 ch.84). "Plant" = industrial facility/plant, not a living plant.
 *    Fix: add noneOf for laboratory/industrial plant context.
 *
 * 2. ANIMAL_FEED_CH23_INTENT: "pomace" fires for "Crude olive pomace oil" (1510 ch.15).
 *    Pomace = solid grape/fruit residue (ch.23 feed), but olive pomace OIL = extracted
 *    oil from the pomace (ch.15 vegetable oils). Fix: add noneOf for oil context.
 *
 * 3. FRESH_VEGETABLE_INTENT: "vegetable" fires for "Animal vegetable or microbial fats
 *    and oils...chemically modified" (1518 ch.15). "Vegetable fats/oils" describes fats
 *    of vegetable origin (ch.15), not fresh vegetables (ch.07).
 *    Fix: add noneOf for fats/oils context.
 *
 * 4. AI_CH35_STARCH_DEXTRIN: "modified" fires for "...otherwise chemically modified"
 *    in the animal/vegetable fats description (1518 ch.15). "Chemically modified" here
 *    describes fat treatment, not starch modification. Fix: add noneOf for fats/oils context.
 *
 * 5. CRYSTAL_GEMSTONE_INTENT: "quartz" fires for "Silica sands...Quartz sands" (2505
 *    ch.25) and "Quartz...quartzite" (2506 ch.25). Natural mineral-grade quartz and
 *    quartzite are industrial minerals (ch.25), not gemstone crystals (ch.71).
 *    Fix: add noneOf for sand/mineral context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13nn.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix INDOOR_PLANT_INTENT — exclude industrial/laboratory "plant" context
  {
    priority: 640,
    rule: {
      id: 'INDOOR_PLANT_INTENT',
      description: 'Indoor/ornamental plants, succulents, houseplants, bonsai → ch.06. ' +
        'Added noneOf for industrial plant/laboratory context: "Machinery plant or ' +
        'laboratory equipment...sterilizers" (8419 ch.84) has "plant" (= industrial ' +
        'facility/installation) → fires allowChapters:[06]. An industrial plant ≠ ' +
        'a living plant. Also keeps prior preserved food context noneOf from patch LL.',
      pattern: {
        anyOf: [
          'plant', 'plants', 'succulent', 'succulents', 'houseplant', 'houseplants',
          'bonsai', 'seedling', 'herb',
        ],
        noneOf: [
          'factory', 'power', 'industrial', 'manufacturing',
          'stake', 'hanger', 'stained glass', 'stained', 'magnet', 'magnets', 'magnetic',
          'fridge magnet', 'stand', 'shelf',
          // Preserved food context → ch.20 (from patch LL)
          'preserved', 'preserved by sugar', 'preserved by', 'sugar', 'drained',
          'glazed', 'crystallized', 'candied', 'glace', 'in syrup',
          // Industrial plant/laboratory context → ch.84
          'laboratory', 'sterilizer', 'sterilizers', 'boiler', 'boilers',
          'condenser', 'evaporator', 'water heater', 'pasteurizer',
          'equipment', 'machinery plant', 'treatment plant',
        ],
      },
      whitelist: { allowChapters: ['06'] },
    },
  },

  // ── 2. Fix ANIMAL_FEED_CH23_INTENT — exclude oil context (ch.15) ─────────────
  {
    priority: 660,
    rule: {
      id: 'ANIMAL_FEED_CH23_INTENT',
      description: 'Animal feed ingredients: corn gluten meal, acorns, distillers grains → ch.23. ' +
        'Added noneOf for oil context: "Crude olive pomace oil" (1510 ch.15) has "pomace" → ' +
        'fires allowChapters:[23]. Olive pomace OIL is ch.15 (vegetable oils), not ch.23 ' +
        'solid pomace residue (animal feed). When "oil" accompanies "pomace", it\'s ch.15.',
      pattern: {
        anyOf: [
          'corn gluten meal', 'corn gluten feed', 'maize gluten meal',
          'distillers grains', 'distillers dried grains', 'brewers grains', 'brewer grains',
          'draff', 'bagasse', 'oilcake', 'oil cake', 'oil-cake',
          'acorns', 'horse-chestnuts', 'horse chestnuts',
          'marc', 'pomace', 'lees', 'residues from starch',
        ],
        noneOf: [
          // Oil context → ch.15 (pomace oil = vegetable oil, not feed residue)
          'oil', 'crude oil', 'pomace oil', 'olive oil', 'vegetable oil',
          'fixed oil', 'refined oil',
        ],
      },
      whitelist: { allowChapters: ['23'] },
    },
  },

  // ── 3. Fix FRESH_VEGETABLE_INTENT — exclude fats/oils context (ch.15) ────────
  {
    priority: 640,
    rule: {
      id: 'FRESH_VEGETABLE_INTENT',
      description: 'Fresh vegetables, raw produce → ch.07. ' +
        'Added noneOf for fats/oils context: "Animal vegetable or microbial fats and oils ' +
        '...chemically modified" (1518 ch.15) has "vegetable" → fires allowChapters:[07]. ' +
        '"Vegetable fats/oils" = fats of vegetable origin (ch.15), not fresh vegetables.',
      pattern: {
        anyOf: [
          'broccoli', 'carrot', 'carrots', 'potato', 'potatoes', 'onion', 'onions',
          'tomato', 'tomatoes', 'spinach', 'lettuce', 'mushroom', 'mushrooms',
          'cucumber', 'cucumbers', 'corn', 'garlic', 'asparagus', 'zucchini',
          'eggplant', 'celery', 'cabbage', 'cauliflower', 'pumpkin', 'squash',
          'vegetable', 'vegetables', 'produce',
        ],
        noneOf: [
          'machinery', 'machine', 'machines', 'sorting', 'grading', 'harvesting',
          'threshing', 'cleaning', 'processing', 'incubator', 'agricultural machinery',
          'fibers', 'fiber', 'material', 'materials',
          'upper', 'uppers', 'sole', 'soles', 'textile', 'textiles',
          'yarn', 'thread', 'woven', 'knitted',
          // Preserved food context → ch.20
          'preserved by sugar', 'preserved', 'glazed', 'crystallized',
          'gluten', 'gluten meal', 'corn gluten',
          // Fats/oils context → ch.15
          'fats', 'oils', 'fat', 'oil', 'fatty acids', 'fatty acid',
          'lipids', 'microbial fats', 'fractions', 'inedible',
        ],
      },
      whitelist: { allowChapters: ['07'] },
    },
  },

  // ── 4. Fix AI_CH35_STARCH_DEXTRIN — exclude fats/oils modified context ────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH35_STARCH_DEXTRIN',
      description: 'Modified starches, dextrins, adhesives → ch.35. ' +
        'Added noneOf for fats/oils context: "Animal vegetable or microbial fats...otherwise ' +
        'chemically modified" (1518 ch.15) has "modified" token → fires allowChapters:[35]. ' +
        '"Chemically modified fats/oils" = modified fats (ch.15), not starch modification.',
      pattern: {
        anyOf: ['dextrin', 'dextrins', 'starch', 'pregelatinized', 'esterified', 'modified'],
        noneOf: [
          // Fats/oils context → ch.15
          'fats', 'oils', 'fat', 'oil', 'fatty', 'fractions',
          'microbial', 'chemically modified fats', 'polymerized',
          'oxidized', 'sulfurized', 'blown',
        ],
      },
      whitelist: { allowChapters: ['35'], denyChapters: ['11', '17'] },
    },
  },

  // ── 5. Fix CRYSTAL_GEMSTONE_INTENT — exclude sand/mineral quartz context ──────
  {
    priority: 640,
    rule: {
      id: 'CRYSTAL_GEMSTONE_INTENT',
      description: 'Decorative crystals, gemstone specimens → ch.71. ' +
        'Added noneOf for natural mineral context: "Silica sands...Quartz sands" (2505 ch.25) ' +
        'and "Quartz...quartzite" (2506 ch.25) have "quartz" → fires allowChapters:[71]. ' +
        'Natural mineral-grade quartz, quartzite, and silica sands are industrial minerals ' +
        '(ch.25), not decorative gemstone crystals (ch.71).',
      pattern: {
        anyOf: [
          'quartz', 'amethyst', 'obsidian', 'crystal chips', 'tumbled stone', 'tumbled stones',
          'worry stone', 'worry stones', 'crystal specimen', 'mineral specimen',
          'gemstone', 'gemstones', 'crystal sphere', 'crystal tower', 'crystal wand',
          'crystal palm stone', 'crystal pendulum', 'opal chips', 'turquoise chips',
          'jasper', 'agate', 'labradorite', 'selenite', 'fluorite', 'pyrite',
          'lapis lazuli', 'malachite', 'rose quartz', 'clear quartz', 'smoky quartz',
          'black obsidian', 'rainbow moonstone',
        ],
        noneOf: [
          'wine glass', 'crystal glass', 'chandelier', 'growing kit',
          'oscillator', 'watch crystal', 'clock crystal',
          // Natural mineral/industrial quartz context → ch.25
          'sand', 'sands', 'silica', 'quartzite', 'natural sands', 'quartz sands',
          'silica sands', 'quartz sand', 'ore', 'quarry', 'crushed stone',
          'metalbearing', 'metal bearing',
        ],
      },
      whitelist: { allowChapters: ['71'], denyChapters: ['19'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch NN)...`);

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
    console.log(`\nPatch NN complete: ${success} applied, ${failed} failed`);
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
