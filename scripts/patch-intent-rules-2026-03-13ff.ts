#!/usr/bin/env ts-node
/**
 * Patch FF — 2026-03-13:
 *
 * Fix 4 issues introduced or exposed by patches BB/CC:
 *
 * 1. AI_CH88_AIRPLANE: "civil aircraft" fires for "For use in civil aircraft Cooking
 *    stoves ranges and ovens" (ch.84 industrial ovens) → allowChapters:[88] blocks ch.84.
 *    HTS uses "For use in civil aircraft" as a qualification for reduced duty rates on
 *    many ch.84 items. Fix: add noneOf for cooking/heating appliance context.
 *
 * 2. AI_CH19_WAFFLE_WAFER: "wafers" fires for "boules wafers semiconductor devices"
 *    (ch.84 semiconductor manufacturing equipment) → allowChapters:[19] blocks ch.84.
 *    "Wafers" in semiconductor context = silicon wafers, not food wafers.
 *    Fix: add noneOf for semiconductor/electronics context.
 *
 * 3. AI_CH51_RAW_WOOL: "wool" fires for "Containing 36 percent by weight of wool...
 *    Men's or boys' overcoats carcoats capes cloaks anoraks" (ch.62 woven garments)
 *    → allowChapters:[51] blocks ch.62. "wool" describes fiber content of a garment,
 *    not raw wool fiber itself. Fix: add noneOf for outer-garment vocabulary.
 *
 * 4. PREPARED_CANNED_MEATS_INTENT: "Neither cooked nor in oil Eels Prepared or
 *    preserved fish caviar" → EMPTY. PREPARED_FISH_SEAFOOD_HTS_INTENT denies [02,03,04]
 *    but no allowChapters:[16] fires → all top-N results filtered → EMPTY.
 *    Fix: Add fish/seafood preparation phrases to PREPARED_CANNED_MEATS_INTENT so it
 *    provides positive allowChapters:[16] signal alongside the deny signal.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ff.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH88_AIRPLANE — add noneOf for cooking/heating context ──────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH88_AIRPLANE',
      description: 'Airplanes, civil aircraft, aircraft parts → ch.88. ' +
        'Added noneOf for cooking/heating appliance context: "For use in civil aircraft" ' +
        'is a HTS duty-rate qualification used across many ch.84 industrial equipment items ' +
        '(cooking stoves, ovens, ranges). These are ch.84 items qualified for aircraft use, ' +
        'not ch.88 aircraft themselves.',
      pattern: {
        anyOf: [
          'airplane', 'airplanes', 'aircraft', 'civil aircraft', 'helicopter',
          'helicopters', 'glider', 'gliders', 'aerospace', 'jetliner',
        ],
        noneOf: [
          // Cooking/heating appliance context → ch.84
          'stoves', 'stove', 'ovens', 'oven', 'ranges', 'range',
          'cooking', 'furnace', 'furnaces', 'heating',
          // Other machinery contexts
          'motors', 'motor', 'engines', 'engine', 'compressor', 'pump',
          // Parts/components that belong to other chapters
          'roller', 'bearing', 'bearings',
        ],
      },
      whitelist: { allowChapters: ['88'] },
    },
  },

  // ── 2. Fix AI_CH19_WAFFLE_WAFER — add noneOf for semiconductor context ─────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH19_WAFFLE_WAFER',
      description: 'Waffles, wafers, ice cream cones (food) → ch.19. ' +
        'Added noneOf for semiconductor/electronics context: "wafers" fires for ' +
        '"boules wafers semiconductor devices" (silicon wafers, ch.84 semiconductor ' +
        'manufacturing equipment). Silicon wafers ≠ food wafers.',
      pattern: {
        anyOf: ['waffle', 'waffles', 'wafer', 'wafers', 'stroopwafel', 'ice cream cone', 'cone', 'pizzelle'],
        noneOf: [
          // Roller bearing context → ch.84 (from patch CC)
          'bearing', 'bearings', 'roller', 'rollers', 'tapered', 'ball bearing', 'roller bearing',
          'assembly', 'assemblies', 'cone and tapered', 'cup',
          'diameter', 'mm', 'pitch', 'axle', 'shaft',
          // Semiconductor context → ch.84/85
          'semiconductor', 'boules', 'integrated circuits', 'integrated circuit',
          'electronic', 'electronics', 'flat panel', 'silicon',
        ],
      },
      whitelist: { allowChapters: ['19'] },
    },
  },

  // ── 3. Fix AI_CH51_RAW_WOOL — add noneOf for outer-garment vocabulary ─────────
  {
    priority: 660,
    rule: {
      id: 'AI_CH51_RAW_WOOL',
      description: 'Raw wool, fleece, greasy wool → ch.51. ' +
        'Added noneOf for outer garment context: "Containing X% by weight of wool" in ' +
        'overcoat/jacket HTS descriptions uses "wool" as fiber content description, not raw ' +
        'wool fiber. "overcoats","anoraks","cloaks","windbreakers" are ch.62 woven garments; ' +
        '"overcoats" is not matched by "coat" noneOf (different token). ' +
        'Keeps prior noneOf for mineral/slag wool, hides, and restraints.',
      pattern: {
        anyOf: ['wool', 'fleece', 'greasy', 'shorn', 'raw', 'unwashed'],
        noneOf: [
          'yarn', 'fabric', 'knit', 'woven', 'felt', 'blanket', 'sweater', 'coat', 'carpet',
          'slag', 'mineral', 'rock wool', 'slag wool', 'glass wool', 'ceramic',
          'insulation', 'insulating', 'pipe',
          'hides', 'hide', 'skins', 'skin', 'leather', 'tanned', 'tanning',
          'restraints', 'restraint',
          // Outer garment context → ch.62
          'overcoats', 'overcoat', 'anoraks', 'anorak', 'cloaks', 'cloak',
          'windbreakers', 'windbreaker', 'capes',
          'jackets', 'jacket',
          'padded', 'sleeveless',
        ],
      },
      whitelist: { allowChapters: ['51'] },
    },
  },

  // ── 4. Fix PREPARED_CANNED_MEATS_INTENT — add fish/seafood prep phrases ────────
  {
    priority: 660,
    rule: {
      id: 'PREPARED_CANNED_MEATS_INTENT',
      description: 'Prepared/canned meats and fish, sausages → ch.16. ' +
        'Added fish preparation phrases to fix "Neither cooked nor in oil Eels Prepared ' +
        'or preserved fish caviar" EMPTY: PREPARED_FISH_SEAFOOD_HTS_INTENT denies [02,03,04] ' +
        'but no allowChapters:[16] fired → all top results filtered. ' +
        '"Prepared or preserved fish", "in oil", "neither cooked nor in oil", "caviar" are ' +
        'ch.16 indicators that provide the needed positive allowChapters:[16] signal.',
      pattern: {
        anyOf: [
          // Meat preparation context
          'airtight containers', 'airtight container',
          'sausage', 'sausages', 'frankfurter', 'frankfurters',
          'bologna', 'salami', 'mortadella', 'chorizo',
          'prepared meats', 'prepared meat',
          'canned beef', 'canned meat', 'canned pork',
          'meat preparations', 'meat preparation',
          'homogenized', 'pate', 'pâté',
          // Fish/seafood preparation context → ch.16
          'prepared or preserved fish', 'preserved fish',
          'neither cooked nor in oil',
          'in airtight containers',
          'caviar', 'caviar substitutes',
          'fish eggs',
          'prepared or preserved crustaceans',
          'prepared crustaceans',
          'prepared or preserved molluscs',
        ],
        noneOf: [
          'live', 'carcass', 'carcasses', 'offal',
          'fresh', 'chilled',
        ],
      },
      whitelist: { allowChapters: ['16'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch FF)...`);

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
    console.log(`\nPatch FF complete: ${success} applied, ${failed} failed`);
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
