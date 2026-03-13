#!/usr/bin/env ts-node
/**
 * Patch CC — 2026-03-13:
 *
 * Fix 6 rules + 1 new intent:
 *
 * 1. AI_CH02_SALTED_CURED_MEAT: Re-apply leather/hide preservation context noneOf
 *    (patch Z fix failed to persist). "salted","dried" fire for raw hides query
 *    "fresh or salted dried limed pickled or otherwise preserved" → allowChapters:[02].
 *    LEATHER_HIDES_INTENT denies ch.02 → EMPTY for raw hides (ch.41).
 *
 * 2. AI_CH03_SMOKED_DRIED_SALTED_FISH: Same — re-apply patch Z leather noneOf.
 *
 * 3. VITAMIN_SUPPLEMENT_INTENT: bare "magnesium" fires for "Mixtures of a kind
 *    containing magnesium used as a desulfurization reagent" (ch.38 industrial
 *    chemical) → allowChapters:[30,21] blocks correct ch.38.
 *    Fix: remove bare "magnesium" — "magnesium glycinate" phrase remains in anyOf.
 *
 * 4. AI_CH75_NICKEL_BAR_ROD_WIRE: "nickel" required + "bars"/"rods" fires for
 *    "Containing 8 percent by weight of nickel Other bars and rods" (stainless
 *    steel ch.72) → allowChapters:[75] blocks ch.72. "X percent by weight of nickel"
 *    describes alloy composition (stainless = ch.72), not pure nickel (ch.75).
 *    Fix: add noneOf for "percent by weight" alloy composition context.
 *
 * 5. AI_CH19_WAFFLE_WAFER: "cone" fires for "cone and tapered roller assemblies
 *    Tapered roller bearings" (ch.84) → allowChapters:[19] blocks ch.84.
 *    "Cone" in roller bearing context = tapered bearing cone, not ice cream cone.
 *    Fix: add noneOf for bearing/roller mechanical context.
 *
 * 6. AI_CH88_AIRCRAFT_PARTS: "rotor"/"rotors" fires for "Rotors not further advanced
 *    than cleaned or machined for removal of fins gates sprues and risers" (steam
 *    turbine parts, ch.84) → allowChapters:[88] blocks ch.84.
 *    Steam turbine rotors are ch.84; aircraft rotors are ch.88. Foundry/casting
 *    terms ("fins","gates","sprues","risers") identify industrial machinery context.
 *    Fix: add noneOf for foundry/industrial machinery context.
 *
 * 7. New AGRICULTURAL_MACHINERY_CH84_INTENT: "Harvesting or threshing machinery
 *    including straw or fodder balers grass or hay mowers machines for cleaning
 *    sorting or grading eggs" → got ch.04 (eggs). The word "eggs" pulls semantic
 *    search toward ch.04. A positive allowChapters:[84] rule fixes this.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13cc.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const LEATHER_NONE_OF = [
  'hides', 'hide', 'skins', 'skin', 'leather', 'tanned', 'tanning', 'parchment',
  'limed', 'pickled', 'dehaired', 'pretanned', 'crusting',
];

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Re-apply AI_CH02_SALTED_CURED_MEAT leather noneOf (patch Z regression) ──
  {
    priority: 650,
    rule: {
      id: 'AI_CH02_SALTED_CURED_MEAT',
      description: 'Salted, cured, smoked, dried meat → ch.02. ' +
        'Re-applied noneOf for leather/hide preservation context (patch Z fix did not persist). ' +
        '"salted","dried" appear in raw hides HTS descriptions: "fresh or salted dried limed ' +
        'pickled or otherwise preserved" → fires allowChapters:[02]; LEATHER_HIDES_INTENT denies ' +
        'ch.02 → EMPTY for raw hides (ch.41). Leather preservation ≠ meat preservation.',
      pattern: {
        anyOf: [
          'salted', 'cured', 'smoked', 'dried', 'brine', 'corned',
          'pancetta', 'serrano', 'coppa', 'guanciale', 'salt', 'jerky',
        ],
        noneOf: [
          'beef jerky', 'meat jerky',
          ...LEATHER_NONE_OF,
        ],
      },
      whitelist: { allowChapters: ['02'] },
    },
  },

  // ── 2. Re-apply AI_CH03_SMOKED_DRIED_SALTED_FISH leather noneOf ───────────────
  {
    priority: 650,
    rule: {
      id: 'AI_CH03_SMOKED_DRIED_SALTED_FISH',
      description: 'Smoked, dried, salted, cured fish → ch.03. ' +
        'Re-applied noneOf for leather/hide preservation context (patch Z fix did not persist). ' +
        '"salted","dried","smoked" appear in raw hides HTS descriptions → fires allowChapters:[03]; ' +
        'LEATHER_HIDES_INTENT denies ch.03 → EMPTY for raw hides (ch.41).',
      pattern: {
        anyOf: [
          'smoked', 'dried', 'salted', 'cured', 'kippered', 'bacalao', 'stockfish',
          'salt', 'brine', 'jerky', 'lox', 'gravlax', 'anchovies', 'anchovy',
          'herring', 'sardine', 'mackerel',
        ],
        noneOf: LEATHER_NONE_OF,
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 3. Fix VITAMIN_SUPPLEMENT_INTENT — remove bare "magnesium" ────────────────
  {
    priority: 630,
    rule: {
      id: 'VITAMIN_SUPPLEMENT_INTENT',
      description: 'Vitamins, dietary supplements → ch.30/21. ' +
        'Removed bare "magnesium": fires for "Mixtures of a kind containing magnesium used ' +
        'as a desulfurization reagent" (ch.38 industrial chemical) → allowChapters:[30,21] ' +
        'blocks ch.38. Specific phrases "magnesium glycinate" remain in anyOf.',
      pattern: {
        anyOf: [
          'multivitamin', 'multivitamin tablet', 'daily vitamin',
          'vitamin c', 'vitamin c supplement', 'chewable vitamin c',
          'melatonin', 'melatonin supplement',
          'magnesium glycinate',
          'ashwagandha', 'elderberry', 'elderberry syrup',
          'omega 3', 'fish oil omega 3', 'omega 3 capsules',
        ],
      },
      whitelist: { allowChapters: ['30', '21'] },
    },
  },

  // ── 4. Fix AI_CH75_NICKEL_BAR_ROD_WIRE — add noneOf for alloy context ─────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH75_NICKEL_BAR_ROD_WIRE',
      description: 'Pure nickel bars, rods, wire → ch.75. ' +
        'Added noneOf for alloy composition context: "Containing 8 percent by weight of ' +
        'nickel bars and rods" describes stainless steel (ch.72) where nickel is an alloying ' +
        'element. "X% by weight of nickel" = alloy description; pure nickel products (ch.75) ' +
        'do not describe nickel content as a percentage.',
      pattern: {
        anyOf: ['bar', 'bars', 'rod', 'rods', 'wire', 'profile', 'profiles', 'round', 'hex', 'hexagonal', 'stock'],
        required: ['nickel'],
        noneOf: [
          // Alloy/stainless steel context → ch.72
          'percent', 'percentage', 'by weight', 'weight of', 'weight of nickel',
          'containing', 'alloy', 'stainless', 'steel', 'iron',
        ],
      },
      whitelist: { allowChapters: ['75'] },
    },
  },

  // ── 5. Fix AI_CH19_WAFFLE_WAFER — add noneOf for bearing/roller context ────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH19_WAFFLE_WAFER',
      description: 'Waffles, wafers, cones (food) → ch.19. ' +
        'Added noneOf for roller bearing context: "cone" fires for "cone and tapered roller ' +
        'assemblies Tapered roller bearings" (ch.84 mechanical bearings). A roller bearing ' +
        '"cone" is the inner ring assembly, not an ice cream cone.',
      pattern: {
        anyOf: ['waffle', 'waffles', 'wafer', 'wafers', 'stroopwafel', 'ice cream cone', 'cone', 'pizzelle'],
        noneOf: [
          // Roller bearing context → ch.84
          'bearing', 'bearings', 'roller', 'rollers', 'tapered', 'ball bearing', 'roller bearing',
          'assembly', 'assemblies', 'cone and tapered', 'cup',
          // Other mechanical contexts
          'diameter', 'mm', 'pitch', 'axle', 'shaft',
        ],
      },
      whitelist: { allowChapters: ['19'] },
    },
  },

  // ── 6. Fix AI_CH88_AIRCRAFT_PARTS — add noneOf for foundry/turbine context ─────
  {
    priority: 630,
    rule: {
      id: 'AI_CH88_AIRCRAFT_PARTS',
      description: 'Aircraft parts: propellers, rotors, landing gear → ch.88. ' +
        'Added noneOf for foundry/industrial machinery context: "Rotors not further advanced ' +
        'than cleaned or machined for removal of fins gates sprues and risers" are steam turbine ' +
        'cast rotor blanks (ch.84 parts). "Fins","gates","sprues","risers" are foundry/casting ' +
        'terms for investment casting; aircraft rotors are not described with foundry language. ' +
        'Also exclude steam/turbine/engine context.',
      pattern: {
        anyOf: [
          'propeller', 'propellers', 'rotor', 'rotors',
          'undercarriage', 'landing gear', 'airframe', 'fuselage',
          'aileron', 'rudder', 'flap', 'avionics',
        ],
        noneOf: [
          'drone', 'uav', 'quadcopter',
          // Foundry/casting context → ch.84 (industrial machinery parts)
          'fins', 'gates', 'sprues', 'risers', 'machined for removal',
          'not further advanced', 'finishing machinery',
          // Industrial machinery context
          'steam', 'turbine', 'turbines', 'engine parts',
        ],
      },
      whitelist: { allowChapters: ['88'] },
    },
  },

  // ── 7. New AGRICULTURAL_MACHINERY_CH84_INTENT ─────────────────────────────────
  {
    priority: 650,
    rule: {
      id: 'AGRICULTURAL_MACHINERY_CH84_INTENT',
      description: 'Agricultural machinery: harvesters, threshers, balers, mowers → ch.84. ' +
        '"Harvesting or threshing machinery including straw or fodder balers grass or hay mowers ' +
        'machines for cleaning sorting or grading eggs fruit" → got ch.04 (eggs) because "eggs" ' +
        'in the query semantically pulls toward ch.04. These are machines FOR handling eggs/fruit, ' +
        'not eggs/fruit themselves.',
      pattern: {
        anyOf: [
          'harvesting machinery', 'harvesting or threshing',
          'threshing machinery', 'fodder balers', 'straw balers', 'hay mowers',
          'grass or hay mowers', 'pick-up baler', 'pickup baler',
          'combine harvester', 'grain harvester',
        ],
      },
      whitelist: { allowChapters: ['84'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch CC)...`);

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
    console.log(`\nPatch CC complete: ${success} applied, ${failed} failed`);
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
